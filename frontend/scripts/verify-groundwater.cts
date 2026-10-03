import assert from 'node:assert'

import { GROUNDWATER_SEED_BATCHES } from '../src/data/groundwater/seed'
import {
  compilationTodos,
  effectiveObservedOn,
  effectiveObservations,
  finishCompilation,
  isObservationPending,
  markAbnormal,
  recoverBatch,
  resumeBatch,
  saveObservation,
  startCompilation,
  submitBatch,
  summarizeBatch,
} from '../src/data/groundwater/batch-logic'
import type { GroundwaterBatch } from '../src/data/groundwater/types'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

function cloneSeed(): GroundwaterBatch[] {
  return JSON.parse(JSON.stringify(GROUNDWATER_SEED_BATCHES)) as GroundwaterBatch[]
}
function find(batches: GroundwaterBatch[], no: string) {
  const batch = batches.find((item) => item.batchNo === no)
  assert.ok(batch, `缺少批次 ${no}`)
  return batch
}

// 1. 同一井点同一天保存多份埋深：保留后保存的一份。
check('同井同天多份埋深只保留最新份', () => {
  const batch = find(cloneSeed(), 'B-20260901')
  const rows = effectiveObservations(batch)
  const gw3 = rows.filter((row) => row.wellCode === 'GW-03')
  assert.equal(gw3.length, 1, 'GW-03 只应有一条有效观测')
  assert.equal(gw3[0].depth, 15.4, '应保留后保存的 15.4')
  assert.equal(rows.length, 3, '三个井点各一条')
})

// 2. 旧观测日期缺失按批次日期兼容。
check('旧观测日期缺失按批次日期兼容', () => {
  const batch = find(cloneSeed(), 'B-20260901')
  const row = batch.observations.find((r) => r.id === 2)!
  assert.equal(row.observedOn, '', '种子里确实缺失')
  assert.equal(effectiveObservedOn(row.observedOn, batch.batchDate), '2026-09-01')
  const eff = effectiveObservations(batch).find((r) => r.id === 2)!
  assert.equal(eff.observedOn, '2026-09-01')
})

check('同井同天再保存覆盖且不新增行', () => {
  const batch = find(cloneSeed(), 'B-20260901')
  const before = effectiveObservations(batch).length
  const result = saveObservation(batch, { wellCode: 'GW-01', depth: 99.9, observedOn: '2026-09-01' }, 1800000000000)
  assert.ok(result.ok, result.message)
  const rows = effectiveObservations(batch)
  assert.equal(rows.length, before, '去重后行数不增加')
  assert.equal(rows.find((r) => r.wellCode === 'GW-01')!.depth, 99.9)
})

check('缺观测日期的新录入按批次日期落位并与旧缺失份去重', () => {
  const batch = find(cloneSeed(), 'B-20260901')
  // GW-02 旧份日期缺失（=批次日期），再补一份不带日期的埋深应覆盖。
  const result = saveObservation(batch, { wellCode: 'GW-02', depth: 7.7 }, 1800000000000)
  assert.ok(result.ok, result.message)
  const rows = effectiveObservations(batch).filter((r) => r.wellCode === 'GW-02')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].depth, 7.7)
  assert.equal(rows[0].observedOn, '2026-09-01')
})

// 3. 修复后未完成标记不残留 / 不显示成已完成 / 恢复走批次。
check('异常批次只能整批恢复，恢复后回到采集中而非已完成', () => {
  const batch = find(cloneSeed(), 'B-20260831')
  assert.equal(batch.status, '异常待处理')
  // 不提供任何单条恢复路径：单条记录 abnormal 只能随批次清除。
  const result = recoverBatch(batch)
  assert.ok(result.ok)
  assert.equal(batch.status, '采集中', '恢复后必须是未完成的采集中')
  assert.ok(batch.observations.every((row) => !row.abnormal), '异常标记全部清除')
  assert.equal(batch.failure, null, '无失败标记残留')
})

check('异常未恢复时提交被拒绝', () => {
  const batch = find(cloneSeed(), 'B-20260831')
  const result = submitBatch(batch)
  assert.ok(!result.ok)
  assert.match(result.message, /异常/)
  assert.equal(batch.status, '异常待处理')
})

check('异常批次重录异常井点可清除异常且不冒充已完成', () => {
  const batch = find(cloneSeed(), 'B-20260831')
  const result = saveObservation(batch, { wellCode: 'GW-01', depth: 12.95, observedOn: '2026-08-31' }, 1800000000000)
  assert.ok(result.ok, result.message)
  assert.equal(batch.status, '采集中', '异常修复后回采集中，不是已整编')
  assert.ok(!batch.observations.some((r) => r.abnormal))
})

// 4. 提交缺井点失败：断点 + 从缺失井点继续 + 成功与汇总同次落库。
check('提交缺井点失败并记录断点，不产生待办与汇总', () => {
  const batch = find(cloneSeed(), 'B-20260902')
  assert.ok(batch.failure, '种子本身带历史失败断点')
  const result = submitBatch(batch, 1800000100000)
  assert.ok(!result.ok)
  assert.match(result.message, /GW-04/)
  assert.equal(batch.status, '采集中')
  assert.deepEqual(batch.failure!.missingWells, ['GW-04'])
  assert.deepEqual(batch.failure.committedWells, ['GW-01', 'GW-02'])
  assert.equal(batch.submittedAt, null)
  assert.equal(batch.summary, null)
  assert.equal(compilationTodos([batch]).length, 0, '失败批次不进待办')
})

check('补齐缺失井点后续交成功，状态与汇总同次产生且断点清除', () => {
  const batch = find(cloneSeed(), 'B-20260902')
  // 已提交的 GW-01/GW-02 不要求重复提交，只补缺失的 GW-04。
  const saved = saveObservation(batch, { wellCode: 'GW-04', depth: 6.2, observedOn: '2026-09-02' }, 1800000200000)
  assert.ok(saved.ok, saved.message)
  assert.ok(batch.failure, '补齐缺失井点后断点必须保留，续交入口不能消失')
  assert.equal(batch.status, '采集中', '未显式续交前仍是采集中')
  assert.equal(compilationTodos([batch]).length, 0, '续交成功前不进待办')
  const resumeResult = resumeBatch(batch, 1800000300000)
  assert.ok(resumeResult.ok, resumeResult.message)
  assert.equal(batch.status, '待整编')
  assert.equal(batch.failure, null, '成功后失败标记不得残留')
  assert.ok(batch.submittedAt === 1800000300000, '提交时间落库')
  assert.ok(batch.summary, '汇总与成功同次落库')
  assert.equal(batch.summary!.acceptedWells, 3)
  assert.deepEqual(batch.summary.missingWells, [])
  assert.equal(compilationTodos([batch]).length, 1)
})

check('未补齐就续交仍然失败并停在缺失井点', () => {
  const batch = find(cloneSeed(), 'B-20260902')
  const result = resumeBatch(batch)
  assert.ok(!result.ok)
  assert.match(result.message, /GW-04/)
  assert.equal(batch.status, '采集中')
  assert.ok(batch.failure)
})

// 5. 提交后不重建待办；同一批次不重复显示；已整编不带未完成标记。
check('已提交批次重复提交不重建待办、不重算汇总', () => {
  const batch = find(cloneSeed(), 'B-20260828')
  const summarySnapshot = JSON.stringify(batch.summary)
  const submittedSnapshot = batch.submittedAt
  const result = submitBatch(batch, 1900000000000)
  assert.ok(!result.ok)
  assert.match(result.message, /重复|已提交/)
  assert.equal(batch.submittedAt, submittedSnapshot)
  assert.equal(JSON.stringify(batch.summary), summarySnapshot)
})

check('整编待办同一批次只显示一次，整编中/已整编/采集中/异常均不显示', () => {
  const batches = cloneSeed()
  const todos = compilationTodos(batches)
  const ids = todos.map((b) => b.id)
  assert.equal(new Set(ids).size, ids.length, '无重复批次')
  assert.deepEqual(ids, ['gw-batch-20260828'], '只有待整编批次进入待办')
})

check('已整编批次所有记录都不挂未完成标记', () => {
  const batch = find(cloneSeed(), 'B-20260810')
  assert.equal(batch.status, '已整编')
  assert.equal(batch.failure, null)
  for (const row of effectiveObservations(batch)) {
    assert.equal(isObservationPending(batch, row), false)
  }
})

check('整编流转：开始整编离开待办，完成整编清除全部未完成标记', () => {
  const batches = cloneSeed()
  const batch = find(batches, 'B-20260828')
  assert.ok(startCompilation(batch).ok)
  assert.equal(compilationTodos(batches).length, 0, '开始整编即离开待办')
  assert.ok(finishCompilation(batch).ok)
  assert.equal(batch.status, '已整编')
  assert.equal(batch.failure, null)
  for (const row of effectiveObservations(batch)) {
    assert.equal(isObservationPending(batch, row), false)
  }
})

// 6. 全新批次完整走一遍：缺井失败 → 补齐 → 成功 → 整编完成，汇总数字正确。
check('端到端：失败-续交-整编', () => {
  const fresh: GroundwaterBatch = {
    id: 'x', batchNo: 'B-X', batchDate: '2026-10-03', plannedWells: ['A', 'B'],
    status: '采集中', observations: [], failure: null, submittedAt: null, summary: null, updatedAt: 1,
  }
  assert.ok(saveObservation(fresh, { wellCode: 'A', depth: 1.1 }).ok)
  assert.ok(!submitBatch(fresh).ok, '缺 B 应失败')
  assert.deepEqual(fresh.failure!.missingWells, ['B'])
  assert.ok(saveObservation(fresh, { wellCode: 'B', depth: 2.2 }).ok)
  assert.ok(resumeBatch(fresh).ok)
  assert.equal(fresh.status, '待整编')
  assert.equal(summarizeBatch(fresh).acceptedWells, 2)
  assert.ok(startCompilation(fresh).ok)
  assert.ok(finishCompilation(fresh).ok)
  assert.equal(fresh.failure, null)
})

console.log(`\n全部 ${passed} 项断言通过`)
