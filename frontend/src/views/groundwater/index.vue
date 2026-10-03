<template>
  <section class="page" data-module="groundwater">
    <header class="page-head">
      <div>
        <h2>地下水观测管理</h2>
        <p class="page-desc">
          以观测批次为主线：井点列表、异常处理、整编待办共用同一份批次状态；同一井点同一天的多份埋深只保留最新一份，
          被顶替记录留痕但不能各自恢复。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreateBatch">登记观测批次</button>
        <button class="btn" type="button" @click="exportRows">导出批次清单</button>
        <button class="btn ghost" type="button" @click="resetDemo">恢复演示数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">观测中批次</span>
        <strong class="stat-value">{{ stats.observing }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">整编待办</span>
        <strong class="stat-value">{{ stats.pendingTodo }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">未处理异常</span>
        <strong class="stat-value">{{ stats.abnormal }}</strong>
      </article>
    </div>

    <p v-if="message.text" :class="message.kind === 'error' ? 'error-text' : 'ok-text'" class="flash">
      {{ message.text }}
    </p>

    <div class="batch-layout">
      <!-- 批次列表：一个批次只出现一次 -->
      <div class="batch-list">
        <h3>观测批次</h3>
        <button
          v-for="view in batches"
          :key="view.id"
          type="button"
          class="batch-item"
          :class="{ active: view.id === selectedId }"
          @click="selectBatch(view.id)"
        >
          <span class="batch-item-top">
            <strong>{{ view.id }}</strong>
            <em class="badge" :class="statusClass(view.status)">{{ view.status }}</em>
          </span>
          <span class="batch-item-meta">{{ view.batchDate }} · 井点 {{ view.totalWells }} 个</span>
          <span class="batch-item-meta">
            已交有效记录 {{ view.validCount }}/{{ view.totalWells }}
          </span>
          <span v-if="view.status === '观测中'" class="batch-item-meta">
            <em v-if="view.missingWells.length" class="tag danger">缺 {{ view.missingWells.join('、') }}</em>
            <em v-if="view.openAbnormal.length" class="tag warn">异常 {{ view.openAbnormal.length }} 条</em>
            <em v-if="view.complete" class="tag ok">已交齐，可提交</em>
          </span>
        </button>
        <p v-if="!batches.length" class="empty-inline">暂无批次，先登记一个观测批次</p>
      </div>

      <!-- 批次详情：井点列表 + 异常处理入口 -->
      <div class="batch-detail">
        <template v-if="selected">
          <div class="detail-head">
            <div>
              <h3>{{ selected.id }}
                <em class="badge" :class="statusClass(selected.status)">{{ selected.status }}</em>
              </h3>
              <p class="page-desc">
                批次日期 {{ selected.batchDate }} · 井点清单 {{ selected.wellCodes.join('、') }}
              </p>
            </div>
            <div class="detail-actions">
              <button class="btn" type="button" @click="openSave('', false)">补录埋深</button>
              <button
                class="btn primary"
                type="button"
                :disabled="selected.status !== '观测中'"
                @click="submitCurrent"
              >
                提交批次
              </button>
            </div>
          </div>

          <p v-if="selected.status !== '观测中'" class="lock-tip">
            批次已{{ selected.status === '待整编' ? '提交，正在等待整编（同一批次不会重复出现在待办里）' : '整编完成' }}，
            如需改录请新建批次。
          </p>

          <h4>异常处理入口</h4>
          <table v-if="selected.openAbnormal.length" class="data-table">
            <thead>
              <tr><th>井点编号</th><th>观测日期</th><th>异常埋深(米)</th><th>说明</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="record in selected.openAbnormal" :key="record.id">
                <td>{{ record.wellCode }}</td>
                <td>{{ effectiveDate(record, selected) }}</td>
                <td>{{ record.depth }}</td>
                <td>{{ record.note || '—' }}</td>
                <td><button class="link" type="button" @click="openRepair(record)">修复</button></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="empty-inline">无待处理异常。</p>

          <h4>井点列表（读取批次状态）</h4>
          <table class="data-table">
            <thead>
              <tr><th>井点编号</th><th>观测日期</th><th>埋深值(米)</th><th>观测人</th><th>记录状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              <template v-for="group in wellRows" :key="`${group.recordId}-${group.wellCode}`">
                <tr :class="{ missing: isMissing(group), stale: !group.isLatest && !isMissing(group) }">
                  <td>{{ group.wellCode }}</td>
                  <td>{{ group.date }}</td>
                  <td>{{ isMissing(group) ? '缺失' : group.depth }}</td>
                  <td>{{ group.observer || '—' }}</td>
                  <td>
                    <em v-if="isMissing(group)" class="tag danger">未交</em>
                    <em v-else class="tag" :class="recordStateClass(group.state)">{{ stateLabel(group) }}</em>
                  </td>
                  <td class="row-actions">
                    <button
                      v-if="selected.status === '观测中' && isMissing(group)"
                      class="link"
                      type="button"
                      @click="openSave(group.wellCode, false)"
                    >
                      续录
                    </button>
                    <button
                      v-if="selected.status === '观测中' && group.isLatest && group.state === '有效'"
                      class="link"
                      type="button"
                      @click="openSave(group.wellCode, false)"
                    >
                      更新
                    </button>
                    <button
                      v-if="selected.status === '观测中' && group.isLatest && group.state === '异常'"
                      class="link"
                      type="button"
                      @click="openRepairById(group.recordId)"
                    >
                      修复
                    </button>
                    <span v-else-if="!isMissing(group) && !group.isLatest" class="muted-text">
                      {{ group.state === '顶替' ? '被顶替留痕，不可恢复' : '已处理' }}
                    </span>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </template>
        <p v-else class="empty-inline">请选择左侧批次查看井点列表。</p>
      </div>
    </div>

    <!-- 补录/续录/更新 埋深 -->
    <div v-if="saveOpen" class="modal-mask" @click.self="saveOpen = false">
      <form class="modal" @submit.prevent="confirmSave">
        <h3>{{ saveForm.repairOfId ? '异常修复' : saveForm.titleWell ? '续录埋深' : '补录埋深' }}</h3>
        <label class="modal-field">
          <span>井点编号</span>
          <select v-model="saveForm.wellCode" :disabled="Boolean(saveForm.titleWell)">
            <option v-for="well in selected?.wellCodes ?? []" :key="well" :value="well">{{ well }}</option>
          </select>
        </label>
        <label class="modal-field">
          <span>观测日期（留空按批次日期 {{ selected?.batchDate }}）</span>
          <input v-model="saveForm.observedDate" type="date" :max="selected?.batchDate" />
        </label>
        <label class="modal-field">
          <span>埋深值（米）</span>
          <input v-model="saveForm.depth" type="number" step="0.01" min="0.01" required placeholder="如 12.65" />
        </label>
        <label class="modal-field">
          <span>观测人</span>
          <input v-model="saveForm.observer" type="text" placeholder="观测人姓名" />
        </label>
        <label class="modal-field">
          <span>备注</span>
          <input v-model="saveForm.note" type="text" placeholder="可选" />
        </label>
        <label v-if="!saveForm.repairOfId" class="modal-check">
          <input v-model="saveForm.markAbnormal" type="checkbox" />
          <span>该读数存疑，先标记为异常待处理</span>
        </label>
        <p v-if="saveForm.error" class="error-text">{{ saveForm.error }}</p>
        <p class="modal-hint">同一井点同一天保存多份埋深时，只保留最新一份，旧记录自动顶替留痕。</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="saveOpen = false">取消</button>
          <button class="btn primary" type="submit">保存</button>
        </div>
      </form>
    </div>

    <!-- 新建批次 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <form class="modal" @submit.prevent="confirmCreate">
        <h3>登记观测批次</h3>
        <label class="modal-field">
          <span>批次日期</span>
          <input v-model="createForm.batchDate" type="date" required />
        </label>
        <label class="modal-field">
          <span>井点编号（逗号或换行分隔）</span>
          <textarea v-model="createForm.wellText" rows="3" placeholder="J01,J02,J03"></textarea>
        </label>
        <p v-if="createForm.error" class="error-text">{{ createForm.error }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="submit">创建</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createBatch,
  effectiveDate,
  exportGroundwaterCsv,
  getBatchView,
  groundwaterOverview,
  listBatchViews,
  listBatchWells,
  repairRecord,
  resetGroundwater,
  saveRecord,
  submitBatch,
} from '@/data/groundwater-service'
import type { GwBatchStatus, GwBatchView, GwDepthRecord } from '@/data/groundwater-types'

const batches = ref<GwBatchView[]>([])
const selectedId = ref('')
const wellRows = ref<ReturnType<typeof listBatchWells>>([])
const message = reactive({ text: '', kind: 'ok' })

const selected = computed(() => batches.value.find((batch) => batch.id === selectedId.value) ?? null)

const stats = computed(() => {
  const overview = groundwaterOverview()
  return {
    observing: batches.value.filter((batch) => batch.status === '观测中').length,
    pendingTodo: overview.pending - batches.value.filter((batch) => batch.status === '观测中' && !batch.complete).length,
    abnormal: overview.abnormal,
  }
})

function flash(text: string, kind: 'ok' | 'error' = 'ok') {
  message.text = text
  message.kind = kind
}

function reload(preferId = '') {
  batches.value = listBatchViews()
  const target = preferId || selectedId.value || batches.value[0]?.id || ''
  selectedId.value = target
  wellRows.value = target ? listBatchWells(target) : []
}

function selectBatch(id: string) {
  selectedId.value = id
  wellRows.value = listBatchWells(id)
}

function isMissing(group: ReturnType<typeof listBatchWells>[number]): boolean {
  return group.recordId === 0 && Number.isNaN(group.depth)
}

function stateLabel(group: ReturnType<typeof listBatchWells>[number]): string {
  if (group.state === '异常') return '异常待处理'
  if (group.state === '已修复') return '已被修复记录顶替'
  if (group.state === '顶替') return '已被顶替'
  return group.isLatest ? '有效（最新）' : '有效（历史）'
}

function statusClass(status: GwBatchStatus): string {
  if (status === '待整编') return 'badge-warn'
  if (status === '已整编') return 'badge-ok'
  return 'badge-info'
}

function recordStateClass(state: GwDepthRecord['state']): string {
  if (state === '异常') return 'danger'
  if (state === '顶替' || state === '已修复') return 'muted'
  return 'ok'
}

function submitCurrent() {
  if (!selected.value) return
  const result = submitBatch(selected.value.id)
  if (!result.ok) {
    // 失败：已录数据不动，从第一个缺失井点续录；缺失交完后若还有异常则从异常入口修复。
    reload(selected.value.id)
    if (result.missingWells.length) {
      openSave(result.missingWells[0], false)
    }
    const tail = result.abnormalWells.length ? `；另需修复异常井点：${result.abnormalWells.join('、')}` : ''
    flash(`${result.message}（缺失井点：${result.missingWells.join('、') || '无'}${tail}）`, 'error')
    return
  }
  reload(selected.value.id)
  flash(result.message)
}

const saveOpen = ref(false)
const saveForm = reactive({
  wellCode: '',
  titleWell: '',
  observedDate: '',
  depth: '',
  observer: '',
  note: '',
  markAbnormal: false,
  repairOfId: 0,
  error: '',
})

function openSave(wellCode: string, forceAbnormal: boolean) {
  if (!selected.value) return
  saveForm.wellCode = wellCode || selected.value.wellCodes[0] || ''
  saveForm.titleWell = wellCode
  saveForm.observedDate = ''
  saveForm.depth = ''
  saveForm.observer = ''
  saveForm.note = ''
  saveForm.markAbnormal = forceAbnormal
  saveForm.repairOfId = 0
  saveForm.error = ''
  saveOpen.value = true
}

function openRepair(record: GwDepthRecord) {
  openRepairById(record.id)
}

function openRepairById(recordId: number) {
  if (!selected.value) return
  const group = listBatchWells(selected.value.id).find((item) => item.recordId === recordId)
  saveForm.wellCode = group?.wellCode ?? ''
  saveForm.titleWell = group?.wellCode ?? ''
  saveForm.observedDate = group ? group.date : selected.value.batchDate
  saveForm.depth = ''
  saveForm.observer = ''
  saveForm.note = ''
  saveForm.markAbnormal = false
  saveForm.repairOfId = recordId
  saveForm.error = ''
  saveOpen.value = true
}

function confirmSave() {
  if (!selected.value) return
  const depth = Number(saveForm.depth)
  const payload = {
    batchId: selected.value.id,
    wellCode: saveForm.wellCode,
    observedDate: saveForm.observedDate.trim(),
    depth,
    observer: saveForm.observer,
    note: saveForm.note,
  }
  const result = saveForm.repairOfId
    ? repairRecord(saveForm.repairOfId, payload)
    : saveRecord({ ...payload, markAbnormal: saveForm.markAbnormal })
  if (!result.ok) {
    saveForm.error = result.message
    return
  }
  saveOpen.value = false
  reload(selected.value.id)
  // 修复或更新后批次视图重算：未完成标记（缺失/异常）不残留。
  const view = getBatchView(selected.value.id)
  flash(view?.complete ? `${result.message}；本批次已交齐，可提交` : result.message)
}

const createOpen = ref(false)
const createForm = reactive({ batchDate: '', wellText: '', error: '' })

function openCreateBatch() {
  createForm.batchDate = ''
  createForm.wellText = ''
  createForm.error = ''
  createOpen.value = true
}

function confirmCreate() {
  const wellCodes = createForm.wellText.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean)
  const result = createBatch({ batchDate: createForm.batchDate, wellCodes })
  if (!result.ok) {
    createForm.error = result.message
    return
  }
  createOpen.value = false
  reload(result.batchId)
  flash(result.message)
}

function exportRows() {
  const { filename, content } = exportGroundwaterCsv()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function resetDemo() {
  resetGroundwater()
  reload()
  flash('已恢复地下水批次演示数据')
}

onMounted(() => reload())
</script>

<style scoped>
.ok-text { color: #027a48; }
.flash { margin: 0 0 10px; font-size: 13px; }
.batch-layout { display: grid; grid-template-columns: 300px 1fr; gap: 14px; align-items: start; }
.batch-list { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px; }
.batch-list h3 { margin: 0 0 8px; font-size: 14px; }
.batch-item {
  display: flex; flex-direction: column; gap: 4px; width: 100%; text-align: left;
  border: 1px solid var(--border); border-radius: 6px; background: #fff;
  padding: 8px 10px; margin-bottom: 8px; cursor: pointer;
}
.batch-item.active { border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand); }
.batch-item-top { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
.batch-item-meta { font-size: 12px; color: var(--muted); }
.batch-detail { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.detail-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.detail-head h3 { margin: 0 0 4px; font-size: 15px; display: flex; align-items: center; gap: 8px; }
.detail-actions { display: flex; gap: 8px; flex-shrink: 0; }
.batch-detail h4 { margin: 14px 0 6px; font-size: 13px; }
.lock-tip { font-size: 12px; color: #b54708; background: #fffaeb; border: 1px solid #fedf89; border-radius: 6px; padding: 6px 10px; }
.empty-inline { color: var(--muted); font-size: 12px; margin: 6px 0; }
.muted-text { color: var(--muted); font-size: 12px; }
tr.missing { background: #fef3f2; }
tr.stale { color: var(--muted); }
.badge { font-style: normal; font-size: 12px; border-radius: 999px; padding: 1px 10px; }
.badge-info { background: #eff8ff; color: #175cd3; }
.badge-warn { background: #fffaeb; color: #b54708; }
.badge-ok { background: #ecfdf3; color: #027a48; }
.tag { font-style: normal; font-size: 12px; border-radius: 4px; padding: 1px 8px; background: #eef2f7; }
.tag.danger { background: #fef3f2; color: #b42318; }
.tag.warn { background: #fffaeb; color: #b54708; }
.tag.ok { background: #ecfdf3; color: #027a48; }
.tag.muted { background: #f1f5f9; color: var(--muted); }
.modal-mask {
  position: fixed; inset: 0; background: rgba(16, 24, 40, 0.45);
  display: flex; align-items: center; justify-content: center; z-index: 20;
}
.modal { background: #fff; border-radius: 8px; padding: 18px; width: 420px; max-width: calc(100vw - 32px); }
.modal h3 { margin: 0 0 12px; font-size: 15px; }
.modal-field { display: block; margin-bottom: 10px; }
.modal-field span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.modal-field input, .modal-field select, .modal-field textarea {
  width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font: inherit;
}
.modal-check { display: flex; gap: 6px; align-items: center; font-size: 12px; margin-bottom: 8px; }
.modal-hint { font-size: 12px; color: var(--muted); margin: 4px 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
</style>
