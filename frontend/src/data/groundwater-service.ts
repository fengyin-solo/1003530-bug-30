import {
  GW_SEED_STATE,
} from './groundwater-seed'
import type {
  GwBatch,
  GwBatchStatus,
  GwBatchView,
  GwCompilationTodo,
  GwDepthRecord,
  GwState,
} from './groundwater-types'

// 批次数据独立存放，与通用清单的 localStorage 互不干扰。
const STORAGE_KEY = 'hydrology-monitor-station:groundwater-batches:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readState(): GwState {
  const fallback = clone(GW_SEED_STATE)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as GwState
    if (!parsed || !Array.isArray(parsed.batches) || !Array.isArray(parsed.records)) {
      throw new Error('bad groundwater state')
    }
    return parsed
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: GwState | null = null

function state(): GwState {
  if (cache === null) {
    cache = readState()
  }
  return cache
}

// 所有写操作都收敛到这一个出口：一次操作一次 localStorage 写入，保证「状态与汇总同次落库」。
function persist(next: GwState): void {
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetGroundwater(): void {
  persist(clone(GW_SEED_STATE))
}

export function storageKey(): string {
  return STORAGE_KEY
}

/** 观测日期兼容：旧记录观测日期缺失时按批次日期计算。 */
export function effectiveDate(record: Pick<GwDepthRecord, 'observedDate'>, batch: Pick<GwBatch, 'batchDate'>): string {
  const value = String(record.observedDate ?? '').trim()
  return value === '' ? batch.batchDate : value
}

/** 仍参与「同井同日」判定的记录：有效记录与待处理异常记录；已顶替、已修复的不再参与，也不能各自恢复。 */
function liveRecords(records: GwDepthRecord[], batchId: string): GwDepthRecord[] {
  return records
    .filter((record) => record.batchId === batchId && (record.state === '有效' || record.state === '异常'))
    .sort((a, b) => a.createdAt - b.createdAt)
}

function findBatch(state: GwState, batchId: string): GwBatch | undefined {
  return state.batches.find((batch) => batch.id === batchId)
}

export function getBatchView(batchId: string): GwBatchView | null {
  const current = state()
  const batch = findBatch(current, batchId)
  if (!batch) {
    return null
  }
  return buildView(current, batch)
}

export function listBatchViews(): GwBatchView[] {
  const current = state()
  return current.batches
    .slice()
    .sort((a, b) => (a.batchDate < b.batchDate ? 1 : -1))
    .map((batch) => buildView(current, batch))
}

function buildView(current: GwState, batch: GwBatch): GwBatchView {
  const live = liveRecords(current.records, batch.id)
  const latestByWell = new Map<string, GwDepthRecord>()
  for (const record of live) {
    latestByWell.set(record.wellCode, record)
  }
  const missingWells = batch.wellCodes.filter((well) => !latestByWell.has(well))
  const openAbnormal = live.filter((record) => record.state === '异常')
  const validCount = [...latestByWell.values()].filter((record) => record.state === '有效').length
  const complete = missingWells.length === 0 && openAbnormal.length === 0
  return {
    ...batch,
    missingWells,
    openAbnormal,
    validCount,
    totalWells: batch.wellCodes.length,
    complete,
  }
}

export type BatchRecordGroup = {
  wellCode: string
  date: string
  depth: number
  observer: string
  note: string
  state: GwDepthRecord['state']
  recordId: number
  isLatest: boolean
}

/** 井点列表读取的就是批次状态：按批次日期补齐缺失井点，按最新记录判定交没交。 */
export function listBatchWells(batchId: string): BatchRecordGroup[] {
  const current = state()
  const batch = findBatch(current, batchId)
  if (!batch) {
    return []
  }
  const live = liveRecords(current.records, batchId)
  const history = current.records
    .filter((record) => record.batchId === batchId && record.state !== '有效' && record.state !== '异常')
    .sort((a, b) => b.createdAt - a.createdAt)
  const groups: BatchRecordGroup[] = []
  for (const well of batch.wellCodes) {
    const records = live.filter((record) => record.wellCode === well)
    const latest = records[records.length - 1]
    if (latest) {
      groups.push(toGroup(latest, true, batch))
      for (const record of records.slice(0, -1)) {
        groups.push(toGroup(record, false, batch))
      }
    } else {
      // 缺失井点：用批次日期兼容占位，异常处理和续录都从这里接着走。
      groups.push({
        wellCode: well,
        date: batch.batchDate,
        depth: NaN,
        observer: '',
        note: '',
        state: '有效',
        recordId: 0,
        isLatest: false,
      })
    }
  }
  for (const record of history) {
    groups.push(toGroup(record, false, batch))
  }
  return groups
}

function toGroup(record: GwDepthRecord, isLatest: boolean, batch: GwBatch): BatchRecordGroup {
  return {
    wellCode: record.wellCode,
    date: effectiveDate(record, batch),
    depth: record.depth,
    observer: record.observer,
    note: record.note,
    state: record.state,
    recordId: record.id,
    isLatest,
  }
}

export type SaveRecordInput = {
  batchId: string
  wellCode: string
  observedDate: string
  depth: number
  observer: string
  note: string
  markAbnormal: boolean
}

export type MutationResult = {
  ok: boolean
  message: string
  recordId?: number
}

/** 登记/续录埋深。同井同日多份埋深只保留最新一份：旧记录置「顶替」留痕，不能各自恢复。 */
export function saveRecord(input: SaveRecordInput): MutationResult {
  const current = state()
  const batch = findBatch(current, input.batchId)
  if (!batch) {
    return { ok: false, message: '批次不存在' }
  }
  if (!batch.wellCodes.includes(input.wellCode)) {
    return { ok: false, message: `井点 ${input.wellCode} 不在本批次井点清单内` }
  }
  if (!Number.isFinite(input.depth) || input.depth <= 0) {
    return { ok: false, message: '埋深值必须是大于 0 的数字（米）' }
  }
  const date = String(input.observedDate ?? '').trim() || batch.batchDate
  const next: GwState = clone(current)
  const nextBatch = findBatch(next, input.batchId) as GwBatch
  const sameKey = next.records
    .filter((record) => record.batchId === batch.id && record.wellCode === input.wellCode
      && (record.state === '有效' || record.state === '异常')
      && effectiveDate(record, nextBatch) === date)
    .sort((a, b) => a.createdAt - b.createdAt)
  const previous = sameKey[sameKey.length - 1]
  const id = next.seq + 1
  next.seq = id
  const created: GwDepthRecord = {
    id,
    batchId: batch.id,
    wellCode: input.wellCode,
    observedDate: date,
    depth: Number(input.depth.toFixed(2)),
    observer: input.observer.trim(),
    note: input.note.trim(),
    state: input.markAbnormal ? '异常' : '有效',
    createdAt: Date.now() + id,
    supersededId: previous ? previous.id : null,
  }
  next.records.push(created)
  if (previous) {
    // 同井同日保留最新一份：旧记录只留痕，不再有效，也不允许从旧记录恢复批次。
    previous.state = '顶替'
  }
  persist(next)
  const verb = input.markAbnormal ? '已标记异常' : previous ? '已更新，旧记录顶替留痕' : '已登记'
  return { ok: true, message: `井点 ${input.wellCode} ${date} 埋深 ${verb}`, recordId: id }
}

/** 异常处理入口：补录一份正确埋深，异常记录置「已修复」；未完成标记由批次视图重算，不残留。 */
export function repairRecord(recordId: number, input: Omit<SaveRecordInput, 'markAbnormal'>): MutationResult {
  const current = state()
  const target = current.records.find((record) => record.id === recordId)
  if (!target) {
    return { ok: false, message: '异常记录不存在' }
  }
  if (target.state !== '异常') {
    // 已顶替/已修复的重复记录不允许各自恢复。
    return { ok: false, message: '只有待处理的异常记录可以修复，重复记录不能各自恢复' }
  }
  const saveResult = saveRecord({ ...input, markAbnormal: false })
  if (!saveResult.ok) {
    return saveResult
  }
  const next = clone(state())
  const abnormal = next.records.find((record) => record.id === recordId)
  const fresh = next.records.find((record) => record.id === saveResult.recordId)
  if (abnormal) {
    abnormal.state = '已修复'
  }
  if (fresh && abnormal) {
    fresh.supersededId = abnormal.id
  }
  persist(next)
  return { ok: true, message: `井点 ${input.wellCode} 异常已处理，已按新埋深恢复`, recordId: saveResult.recordId }
}

export type SubmitResult = {
  ok: boolean
  message: string
  missingWells: string[]
  abnormalWells: string[]
}

/** 提交批次：观测中 -> 待整编。失败不动数据，从缺失井点续录；成功时批次状态与整编待办同次落库。 */
export function submitBatch(batchId: string): SubmitResult {
  const current = state()
  const batch = findBatch(current, batchId)
  if (!batch) {
    return { ok: false, message: '批次不存在', missingWells: [], abnormalWells: [] }
  }
  if (batch.status !== '观测中') {
    // 已提交的批次不能重复提交：待办不会重复出现，也不会被当作已完成。
    return {
      ok: false,
      message: `批次已是「${batch.status}」，不能重复提交`,
      missingWells: [],
      abnormalWells: [],
    }
  }
  const view = buildView(current, batch)
  if (!view.complete) {
    // 失败不写库：已录数据原样保留，调用方按缺失井点继续。
    const abnormalWells = [...new Set(view.openAbnormal.map((record) => record.wellCode))]
    return {
      ok: false,
      message: '批次尚未交齐：先补齐缺失井点并处理完异常再提交',
      missingWells: view.missingWells,
      abnormalWells,
    }
  }
  const next: GwState = clone(current)
  const nextBatch = findBatch(next, batchId) as GwBatch
  nextBatch.status = '待整编'
  // 同一批次只允许一条待办：幂等保护，提交后不重建。
  if (!next.todos.some((todo) => todo.batchId === batchId)) {
    const todoId = (next.todos.reduce((max, todo) => Math.max(max, todo.id), 0) + 1)
    const todo: GwCompilationTodo = {
      id: todoId,
      batchId,
      batchDate: nextBatch.batchDate,
      wellCount: nextBatch.wellCodes.length,
      recordCount: liveRecords(next.records, batchId).filter((record) => record.state === '有效').length,
      createdAt: Date.now(),
      compiledAt: null,
      done: false,
    }
    next.todos.push(todo)
  }
  // 成功与汇总同次落库。
  persist(next)
  return { ok: true, message: `批次 ${batchId} 已提交，整编待办已生成`, missingWells: [], abnormalWells: [] }
}

/** 整编待办读取同一批次状态：只出「待整编」批次，按批次去重；已整编批次落进已完成区，不在待办重复显示。 */
export function listPendingTodos(): (GwCompilationTodo & { batchStatus: GwBatchStatus })[] {
  const current = state()
  return current.todos
    .filter((todo) => !todo.done)
    .map((todo) => {
      const batch = findBatch(current, todo.batchId)
      return { ...todo, batchStatus: batch ? batch.status : '观测中' }
    })
    // 状态不是待整编（理论上不会出现）不允许显示成待办，更不能显示成已完成以外的态。
    .filter((todo) => todo.batchStatus === '待整编')
    .sort((a, b) => (a.batchDate < b.batchDate ? 1 : -1))
}

export function listDoneTodos(): GwCompilationTodo[] {
  return state().todos
    .filter((todo) => todo.done)
    .sort((a, b) => (b.compiledAt ?? 0) - (a.compiledAt ?? 0))
}

/** 完成整编：待整编 -> 已整编，待办与批次状态同次落库；提交后不重建待办。 */
export function completeCompilation(todoId: number): MutationResult {
  const current = state()
  const todo = current.todos.find((item) => item.id === todoId)
  if (!todo) {
    return { ok: false, message: '整编待办不存在' }
  }
  if (todo.done) {
    return { ok: false, message: '该待办已整编，不能重复操作' }
  }
  const batch = findBatch(current, todo.batchId)
  if (!batch) {
    return { ok: false, message: '对应批次不存在' }
  }
  if (batch.status !== '待整编') {
    return { ok: false, message: `批次当前为「${batch.status}」，不能整编` }
  }
  const next: GwState = clone(current)
  const nextBatch = findBatch(next, todo.batchId) as GwBatch
  const nextTodo = next.todos.find((item) => item.id === todoId) as GwCompilationTodo
  nextBatch.status = '已整编'
  nextTodo.done = true
  nextTodo.compiledAt = Date.now()
  persist(next)
  return { ok: true, message: `批次 ${batch.id} 整编完成` }
}

export type CreateBatchInput = {
  batchDate: string
  wellCodes: string[]
}

export function createBatch(input: CreateBatchInput): MutationResult & { batchId?: string } {
  const date = String(input.batchDate ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: '批次日期格式应为 YYYY-MM-DD' }
  }
  const wells = [...new Set(input.wellCodes.map((well) => well.trim()).filter(Boolean))]
  if (wells.length === 0) {
    return { ok: false, message: '至少登记一个井点编号' }
  }
  const current = state()
  if (current.batches.some((batch) => batch.batchDate === date)) {
    return { ok: false, message: `${date} 已存在观测批次，一天只建一个批次` }
  }
  const id = `GW-B${date.replace(/-/g, '')}`
  const next: GwState = clone(current)
  const batch: GwBatch = { id, batchDate: date, wellCodes: wells, status: '观测中', createdAt: Date.now() }
  next.batches.push(batch)
  persist(next)
  return { ok: true, message: `批次 ${id} 已创建`, batchId: id }
}

/** 看板指标：地下水的待处理/异常量从批次状态取，不看通用清单。 */
export function groundwaterOverview(): { created: number; pending: number; abnormal: number } {
  const current = state()
  const views = current.batches.map((batch) => buildView(current, batch))
  return {
    created: current.records.filter((record) => record.state === '有效' || record.state === '异常').length,
    pending: current.todos.filter((todo) => !todo.done).length
      + views.filter((view) => view.status === '观测中' && !view.complete).length,
    abnormal: views.reduce((sum, view) => sum + view.openAbnormal.length, 0),
  }
}

export function exportGroundwaterCsv(): { filename: string; content: string } {
  const current = state()
  const header = ['批次编号', '批次日期', '井点编号', '观测日期', '埋深值(米)', '观测人', '记录状态']
  const lines = [header.join(',')]
  for (const batch of current.batches) {
    for (const record of liveRecords(current.records, batch.id)) {
      lines.push([
        batch.id,
        batch.batchDate,
        record.wellCode,
        effectiveDate(record, batch),
        record.depth,
        record.observer,
        record.state === '异常' ? '异常待处理' : '有效',
      ].join(','))
    }
  }
  return { filename: '地下水观测-批次清单.csv', content: `﻿${lines.join('\n')}` }
}
