import type {
  BatchOpResult,
  BatchStatus,
  BatchSummary,
  FailureMarker,
  GroundwaterBatch,
  GroundwaterObservation,
} from './types'

/** 最终（成功）状态，处于该状态的批次/记录都不得再带未完成标记。 */
export const FINAL_STATUS: BatchStatus = '已整编'
export const TODO_STATUS: BatchStatus = '待整编'

/** 旧观测日期缺失时按批次日期兼容。 */
export function effectiveObservedOn(
  observedOn: string | undefined,
  batchDate: string,
): string {
  const value = (observedOn ?? '').trim()
  return value === '' ? batchDate : value
}

export function isObservationPending(batch: GroundwaterBatch, row: GroundwaterObservation): boolean {
  // 已整编批次里的记录一律视为完成，未完成标记不得残留。
  if (batch.status === FINAL_STATUS) {
    return false
  }
  // 异常待处理批次里，异常记录仍挂起等待批次级恢复；非异常记录不挂起。
  if (batch.status === '异常待处理') {
    return row.abnormal
  }
  // 采集中（含提交失败待续交）：尚未成功提交，记录仍挂起。
  // 待整编：已提交，等待整编动作，不再作为未完成观测。
  return batch.status === '采集中'
}

/**
 * 同一批次去重后的有效观测：同一井点同一天保存多份埋深时，
 * 保留后保存的一份（savedAt 更大；相同则 id 更大），旧份不再展示。
 */
export function effectiveObservations(batch: GroundwaterBatch): GroundwaterObservation[] {
  const picked = new Map<string, GroundwaterObservation>()
  const normalized = batch.observations.map((row) => ({
    ...row,
    observedOn: effectiveObservedOn(row.observedOn, batch.batchDate),
  }))
  for (const row of normalized) {
    const key = `${row.wellCode}__${row.observedOn}`
    const prev = picked.get(key)
    if (!prev || row.savedAt > prev.savedAt || (row.savedAt === prev.savedAt && row.id > prev.id)) {
      picked.set(key, row)
    }
  }
  return [...picked.values()].sort((a, b) => a.wellCode.localeCompare(b.wellCode))
}

export function summarizeBatch(batch: GroundwaterBatch): BatchSummary {
  const rows = effectiveObservations(batch)
  const observedWells = [...new Set(rows.map((row) => row.wellCode))]
  const abnormalWells = [...new Set(rows.filter((row) => row.abnormal).map((row) => row.wellCode))]
  const missingWells = batch.plannedWells.filter((well) => !observedWells.includes(well))
  return {
    totalWells: batch.plannedWells.length,
    observedWells: observedWells.length,
    acceptedWells: rows.length,
    abnormalWells: abnormalWells.length,
    missingWells,
    observationCount: batch.observations.length,
  }
}

/** 异常标记是否存在（去重后的有效观测里仍有异常，才算数，避免旧份幽灵异常）。 */
export function hasActiveAbnormal(batch: GroundwaterBatch): boolean {
  return effectiveObservations(batch).some((row) => row.abnormal)
}

function nextId(rows: GroundwaterObservation[]): number {
  return rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
}

/**
 * 保存一份埋深观测。同一井点同一天再次保存即覆盖（后保存为准），
 * 底层保留历史份以支撑覆盖判定，但有效观测只暴露最新份。
 */
export function saveObservation(
  batch: GroundwaterBatch,
  input: {
    wellCode: string
    depth: number
    observedOn?: string
    waterElevation?: string
    temperature?: string
    observer?: string
  },
  now: number = Date.now(),
): BatchOpResult {
  const wellCode = input.wellCode.trim()
  if (!wellCode) {
    return { ok: false, message: '井点编号不能为空' }
  }
  if (!Number.isFinite(input.depth)) {
    return { ok: false, message: '埋深值必须是数字' }
  }
  if (batch.status === '整编中' || batch.status === FINAL_STATUS) {
    return { ok: false, message: `批次已${batch.status}，不能再补录观测` }
  }
  if (!batch.plannedWells.includes(wellCode)) {
    return { ok: false, message: `井点 ${wellCode} 不在本批次计划内` }
  }

  const observedOn =
    (input.observedOn ?? '').trim() === ''
      ? batch.batchDate
      : (input.observedOn as string).trim()
  const duplicateKey = `${wellCode}__${observedOn}`
  const existing = effectiveObservations(batch).find(
    (row) => `${row.wellCode}__${row.observedOn}` === duplicateKey,
  )

  if (existing) {
    // 后保存覆盖：保留同一条记录（id/编号不变），更新埋深等内容，异常标记随重录清除。
    const index = batch.observations.findIndex((row) => row.id === existing.id)
    batch.observations[index] = {
      ...existing,
      depth: input.depth,
      waterElevation: input.waterElevation?.trim() ?? existing.waterElevation,
      temperature: input.temperature?.trim() ?? existing.temperature,
      observer: input.observer?.trim() ?? existing.observer,
      abnormal: false,
      savedAt: now,
    }
  } else {
    const id = nextId(batch.observations)
    batch.observations.push({
      id,
      recordNo: `${batch.batchNo}-O${String(id).padStart(2, '0')}`,
      wellCode,
      observedOn,
      depth: input.depth,
      waterElevation: input.waterElevation?.trim() ?? '',
      temperature: input.temperature?.trim() ?? '',
      observer: input.observer?.trim() ?? '',
      abnormal: false,
      savedAt: now,
    })
  }

  // 修复/补录后重算批次状态：异常清空的从异常态回到采集中，但不直接变成已完成。
  if (batch.status === '异常待处理' && !hasActiveAbnormal(batch)) {
    batch.status = '采集中'
  }
  // 失败断点只在显式续交成功时清除；补齐缺失井点后断点保留，续交入口不能消失。
  if (batch.failure) {
    batch.failure = { ...batch.failure, missingWells: summarizeBatch(batch).missingWells }
  }
  batch.updatedAt = now
  return {
    ok: true,
    message: existing
      ? `井点 ${wellCode} 于 ${observedOn} 已有埋深记录，已按最新保存的 ${input.depth} 米覆盖`
      : `井点 ${wellCode} 的埋深 ${input.depth} 米已保存`,
  }
}

/** 异常处理入口：把某条有效观测标记异常，批次整体进入「异常待处理」。 */
export function markAbnormal(
  batch: GroundwaterBatch,
  observationId: number,
  now: number = Date.now(),
): BatchOpResult {
  if (batch.status === '整编中' || batch.status === FINAL_STATUS) {
    return { ok: false, message: `批次已${batch.status}，不能再标记异常` }
  }
  const index = batch.observations.findIndex((row) => row.id === observationId)
  if (index < 0) {
    return { ok: false, message: '没有找到这条观测记录' }
  }
  if (batch.observations[index].abnormal) {
    return { ok: false, message: '该观测已是异常态，不用重复标记' }
  }
  batch.observations[index] = { ...batch.observations[index], abnormal: true }
  batch.status = '异常待处理'
  batch.updatedAt = now
  return { ok: true, message: '已标记异常，批次进入异常待处理，恢复需在批次上统一进行' }
}

/**
 * 异常恢复：同一批次只能一次性整体恢复，不允许某条重复记录各自恢复。
 * 恢复后回到「采集中」（未完成），绝不能直接变成已完成。
 */
export function recoverBatch(batch: GroundwaterBatch, now: number = Date.now()): BatchOpResult {
  if (batch.status !== '异常待处理') {
    return { ok: false, message: '批次当前不在异常待处理状态，无需恢复' }
  }
  batch.observations = batch.observations.map((row) => ({ ...row, abnormal: false }))
  batch.status = '采集中'
  batch.updatedAt = now
  return { ok: true, message: '批次已统一恢复，未完成标记清除，回到采集中等待提交' }
}

/**
 * 提交批次：
 * - 幂等：已提交（待整编/整编中/已整编）的批次不重建待办、不重算汇总；
 * - 有未处理异常：拒绝；
 * - 缺井点：失败，记录断点（已提交井点 + 缺失井点），不产生待办、不写汇总；
 * - 成功：状态、待办、汇总在同一次写入里落库。
 */
export function submitBatch(batch: GroundwaterBatch, now: number = Date.now()): BatchOpResult {
  if (batch.status === TODO_STATUS || batch.status === '整编中' || batch.status === FINAL_STATUS) {
    return { ok: false, message: '批次已提交，待办不会重复创建' }
  }
  if (hasActiveAbnormal(batch)) {
    return { ok: false, message: '批次存在未处理异常，请先在异常处理入口统一恢复' }
  }

  const summary = summarizeBatch(batch)
  if (summary.missingWells.length > 0) {
    // 失败：保留断点，已覆盖到的井点进 committedWells，恢复时从缺失井点继续。
    const observed = new Set(effectiveObservations(batch).map((row) => row.wellCode))
    batch.failure = {
      reason: 'missing_wells',
      missingWells: summary.missingWells,
      committedWells: [...observed],
      at: now,
    }
    batch.updatedAt = now
    return {
      ok: false,
      message: `提交失败：缺少井点 ${summary.missingWells.join('、')} 的观测，补齐后可从缺失井点续交`,
    }
  }

  // 成功：状态与汇总同次落库，失败标记一并清除，不残留。
  batch.status = TODO_STATUS
  batch.failure = null
  batch.submittedAt = now
  batch.summary = summary
  batch.updatedAt = now
  return {
    ok: true,
    message: `提交成功：${summary.acceptedWells} 个井点、${summary.observationCount} 份观测（含覆盖），已进入整编待办`,
  }
}

/** 续交失败批次：已提交井点记录在断点里，本次只校验/提交缺失井点，全部补齐才成功。 */
export function resumeBatch(batch: GroundwaterBatch, now: number = Date.now()): BatchOpResult {
  if (!batch.failure) {
    return { ok: false, message: '批次没有待续交的失败断点' }
  }
  if (batch.status !== '采集中') {
    return { ok: false, message: '批次不在采集中，不能续交' }
  }
  // 重新提交时，committedWells 里的井点不要求重复提交；缺失井点补齐后即整批成功。
  const missing = summarizeBatch(batch).missingWells
  if (missing.length === 0) {
    return submitBatch(batch, now)
  }
  return {
    ok: false,
    message: `仍缺井点 ${missing.join('、')}，请继续从这些井点补齐后续交`,
  }
}

/** 整编待办开始整编。 */
export function startCompilation(batch: GroundwaterBatch, now: number = Date.now()): BatchOpResult {
  if (batch.status !== TODO_STATUS) {
    return { ok: false, message: '只有待整编批次可以开始整编' }
  }
  batch.status = '整编中'
  batch.updatedAt = now
  return { ok: true, message: '批次已开始整编，待办关闭' }
}

/** 完成整编：最终态，未完成标记一律清除。 */
export function finishCompilation(batch: GroundwaterBatch, now: number = Date.now()): BatchOpResult {
  if (batch.status !== '整编中') {
    return { ok: false, message: '只有整编中的批次可以完成整编' }
  }
  batch.status = FINAL_STATUS
  batch.failure = null
  batch.updatedAt = now
  return { ok: true, message: '批次整编完成' }
}

/** 整编待办：同一批次只出现一次；采集中（含失败）、异常、整编中、已整编都不进待办。 */
export function compilationTodos(batches: GroundwaterBatch[]): GroundwaterBatch[] {
  const seen = new Set<string>()
  return batches.filter((batch) => {
    if (batch.status !== TODO_STATUS || seen.has(batch.id)) {
      return false
    }
    seen.add(batch.id)
    return true
  })
}
