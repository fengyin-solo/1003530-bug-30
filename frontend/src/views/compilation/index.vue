<template>
  <section class="page" data-module="compilation">
    <header class="page-head">
      <div>
        <h2>数据整编管理</h2>
        <p class="page-desc">维护整编成果，围绕成果编号、整编年份、站点编号、整编类型做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记整编成果</button>
        <button class="btn" type="button" @click="exportRows">导出数据整编清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <section class="gw-todo">
      <h3>地下水观测批次整编待办</h3>
      <p class="page-desc">
        与地下水井点列表、异常处理入口读取同一批次状态：同一批次只显示一次，观测中批次不会提前出现，已整编批次只在已完成区。
      </p>
      <p v-if="gwMessage.text" :class="gwMessage.kind === 'error' ? 'error-text' : 'gw-ok'">{{ gwMessage.text }}</p>
      <table class="data-table">
        <thead>
          <tr><th>批次编号</th><th>批次日期</th><th>井点数</th><th>有效埋深</th><th>批次状态</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="todo in gwTodos" :key="todo.id">
            <td>{{ todo.batchId }}</td>
            <td>{{ todo.batchDate }}</td>
            <td>{{ todo.wellCount }}</td>
            <td>{{ todo.recordCount }}</td>
            <td><em class="gw-tag gw-warn">{{ todo.batchStatus }}</em></td>
            <td>
              <button class="link" type="button" :disabled="todo.batchStatus !== '待整编'" @click="finishTodo(todo.id)">
                确认整编完成
              </button>
            </td>
          </tr>
          <tr v-if="!gwTodos.length">
            <td colspan="6" class="empty-state">暂无待整编的地下水批次；提交后的批次才会进入这里，且不会重复出现。</td>
          </tr>
        </tbody>
      </table>
      <h4>已整编批次</h4>
      <table class="data-table">
        <thead>
          <tr><th>批次编号</th><th>批次日期</th><th>整编时间</th><th>批次状态</th></tr>
        </thead>
        <tbody>
          <tr v-for="todo in gwDone" :key="todo.id">
            <td>{{ todo.batchId }}</td>
            <td>{{ todo.batchDate }}</td>
            <td>{{ todo.compiledAt ? formatTime(todo.compiledAt) : '—' }}</td>
            <td><em class="gw-tag gw-ok">已整编</em></td>
          </tr>
          <tr v-if="!gwDone.length">
            <td colspan="4" class="empty-state">尚无已整编的地下水批次。</td>
          </tr>
        </tbody>
      </table>
    </section>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无数据整编数据，可先登记整编成果</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条数据整编记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  completeCompilation,
  listDoneTodos,
  listPendingTodos,
} from '@/data/groundwater-service'
import type { GwCompilationTodo } from '@/data/groundwater-types'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('compilation')
const columns = ["成果编号", "整编年份", "站点编号", "整编类型", "原始记录数", "整编人", "审核人", "整编状态"]
const actions = ["开始整编", "提交审核", "驳回整编"]
const statuses = ["待整编", "整编中", "待审核", "已刊印", "已驳回"]
const stats = [{"label": "待整编年度", "value": 0}, {"label": "整编中年度", "value": 0}, {"label": "已刊印成果", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '整编成果登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '数据整编列表读取失败'
  }
  gwTodos.value = listPendingTodos()
  gwDone.value = listDoneTodos()
}

const gwTodos = ref<ReturnType<typeof listPendingTodos>>([])
const gwDone = ref<GwCompilationTodo[]>([])
const gwMessage = reactive({ text: '', kind: 'ok' })

function formatTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function finishTodo(id: number) {
  const result = completeCompilation(id)
  gwMessage.text = result.message
  gwMessage.kind = result.ok ? 'ok' : 'error'
  // 完成后刷新：该批次从待办移除、进入已完成区，提交后不会再重建待办。
  reload()
}

onMounted(reload)
</script>

<style scoped>
.gw-todo { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 16px; }
.gw-todo h3 { margin: 0 0 4px; font-size: 15px; }
.gw-todo h4 { margin: 14px 0 6px; font-size: 13px; }
.gw-ok { color: #027a48; font-size: 13px; margin: 4px 0; }
.gw-tag { font-style: normal; font-size: 12px; border-radius: 999px; padding: 1px 10px; }
.gw-warn { background: #fffaeb; color: #b54708; }
.gw-ok { background: #ecfdf3; color: #027a48; }
.link:disabled { color: var(--muted); cursor: not-allowed; }
</style>
