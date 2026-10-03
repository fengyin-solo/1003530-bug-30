<template>
  <div class="gw-panel">
    <p class="page-desc">
      以观测批次为单位登记井点埋深：同一井点同一天重复保存埋深时，保留最后保存的一份；
      旧记录观测日期缺失时按批次日期兼容。提交缺井点会留下断点，补齐后从缺失井点续交。
    </p>

    <article v-for="batch in store.batches" :key="batch.id" class="batch-card">
      <header class="batch-head">
        <div>
          <strong>批次 {{ batch.batchNo }}</strong>
          <span class="batch-date">批次日期 {{ batch.batchDate }}</span>
          <span class="status-tag" :class="statusClass(batch.status)">{{ batch.status }}</span>
          <span v-if="batch.failure" class="status-tag failed">提交失败待续交</span>
        </div>
        <div class="row-actions">
          <button
            v-if="batch.status === '采集中' && !batch.failure"
            class="btn primary"
            type="button"
            @click="submit(batch.id)"
          >提交批次</button>
          <button
            v-if="batch.status === '采集中' && batch.failure"
            class="btn primary"
            type="button"
            @click="resume(batch.id)"
          >从缺失井点续交</button>
        </div>
      </header>

      <p v-if="batch.failure" class="batch-alert">
        上次提交缺少井点 {{ batch.failure.missingWells.join('、') }}；已提交井点
        {{ batch.failure.committedWells.join('、') }} 不会重复提交。
      </p>

      <table class="data-table">
        <thead>
          <tr>
            <th>记录编号</th>
            <th>井点编号</th>
            <th>观测日期</th>
            <th>埋深值(米)</th>
            <th>水位标高</th>
            <th>水温</th>
            <th>观测人</th>
            <th>未完成</th>
            <th>异常</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in store.effectiveRows(batch.id)" :key="row.id">
            <td>{{ row.recordNo }}</td>
            <td>{{ row.wellCode }}</td>
            <td>{{ row.observedOn || batch.batchDate }}</td>
            <td>{{ row.depth }}</td>
            <td>{{ row.waterElevation || '—' }}</td>
            <td>{{ row.temperature || '—' }}</td>
            <td>{{ row.observer || '—' }}</td>
            <td>{{ pendingOf(batch, row) ? '待完成' : '—' }}</td>
            <td>{{ row.abnormal ? '异常' : '—' }}</td>
            <td class="row-actions">
              <button
                v-if="canMark(batch)"
                class="link"
                type="button"
                @click="markAbnormal(batch.id, row.id)"
              >标记异常</button>
            </td>
          </tr>
          <tr v-if="!store.effectiveRows(batch.id).length">
            <td colspan="10" class="empty-state">该批次还没有有效观测</td>
          </tr>
        </tbody>
      </table>

      <dl class="batch-summary">
        <span>计划井点 {{ summaryOf(batch).totalWells }}</span>
        <span>已观测 {{ summaryOf(batch).observedWells }}</span>
        <span>有效记录 {{ summaryOf(batch).acceptedWells }}</span>
        <span>异常井点 {{ summaryOf(batch).abnormalWells }}</span>
        <span v-if="summaryOf(batch).missingWells.length">
          缺失井点 {{ summaryOf(batch).missingWells.join('、') }}
        </span>
        <span v-else>无缺失井点</span>
      </dl>

      <form v-if="canEdit(batch)" class="entry-form" @submit.prevent="addObservation(batch.id)">
        <label class="filter-item">
          <span>井点编号</span>
          <select v-model="drafts[batch.id].wellCode">
            <option value="">请选择</option>
            <option v-for="well in batch.plannedWells" :key="well" :value="well">{{ well }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>观测日期（留空按批次日期）</span>
          <input v-model="drafts[batch.id].observedOn" type="date" :placeholder="batch.batchDate" />
        </label>
        <label class="filter-item">
          <span>埋深值(米)</span>
          <input v-model="drafts[batch.id].depth" type="number" step="0.1" required />
        </label>
        <label class="filter-item">
          <span>观测人</span>
          <input v-model="drafts[batch.id].observer" placeholder="观测人" />
        </label>
        <button class="btn" type="submit">保存埋深</button>
      </form>
    </article>

    <footer class="page-foot">
      <button class="btn ghost" type="button" @click="store.reset()">重置为示例批次</button>
      <span v-if="message" class="error-text">{{ message }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'

import { isObservationPending } from '@/data/groundwater/batch-logic'
import type { BatchSummary, GroundwaterBatch, GroundwaterObservation } from '@/data/groundwater/types'
import { useGroundwaterStore } from '@/stores/groundwater'

const store = useGroundwaterStore()
const message = ref('')
function show(text: string) {
  message.value = text
}

// 每个批次一份录入草稿，批次之间互不影响；setup 时先建好，避免首帧取到 undefined。
const drafts = reactive<Record<string, { wellCode: string; observedOn: string; depth: string; observer: string }>>({})
for (const batch of store.batches) {
  drafts[batch.id] = { wellCode: '', observedOn: '', depth: '', observer: '' }
}

function draft(batchId: string) {
  if (!drafts[batchId]) {
    drafts[batchId] = { wellCode: '', observedOn: '', depth: '', observer: '' }
  }
  return drafts[batchId]
}

function summaryOf(batch: GroundwaterBatch): BatchSummary {
  return store.summary(batch.id) ?? {
    totalWells: 0,
    observedWells: 0,
    acceptedWells: 0,
    abnormalWells: 0,
    missingWells: [],
    observationCount: 0,
  }
}

function pendingOf(batch: GroundwaterBatch, row: GroundwaterObservation): boolean {
  return isObservationPending(batch, row)
}

function canEdit(batch: GroundwaterBatch): boolean {
  return batch.status === '采集中' || batch.status === '异常待处理'
}

function canMark(batch: GroundwaterBatch): boolean {
  return canEdit(batch)
}

function statusClass(status: GroundwaterBatch['status']): string {
  return {
    采集中: 'tag-collecting',
    待整编: 'tag-todo',
    异常待处理: 'tag-abnormal',
    整编中: 'tag-compiling',
    已整编: 'tag-done',
  }[status]
}

function addObservation(batchId: string) {
  const form = draft(batchId)
  const depth = Number(form.depth)
  const result = store.saveObservation(batchId, {
    wellCode: form.wellCode,
    depth,
    observedOn: form.observedOn,
    observer: form.observer,
  })
  if (result.ok) {
    form.wellCode = ''
    form.observedOn = ''
    form.depth = ''
    form.observer = ''
  }
  show(result.message)
}

function markAbnormal(batchId: string, observationId: number) {
  show(store.markAbnormal(batchId, observationId).message)
}

function submit(batchId: string) {
  show(store.submit(batchId).message)
}

function resume(batchId: string) {
  show(store.resume(batchId).message)
}
</script>
