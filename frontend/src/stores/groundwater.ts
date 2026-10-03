import { defineStore } from 'pinia'

import {
  compilationTodos,
  effectiveObservations,
  finishCompilation,
  hasActiveAbnormal,
  markAbnormal,
  recoverBatch,
  resumeBatch,
  saveObservation,
  startCompilation,
  submitBatch,
  summarizeBatch,
} from '@/data/groundwater/batch-logic'
import { commitBatches, listBatches, resetBatches } from '@/data/groundwater/store'
import type {
  BatchOpResult,
  BatchSummary,
  GroundwaterBatch,
  GroundwaterObservation,
} from '@/data/groundwater/types'

type SaveInput = {
  wellCode: string
  depth: number
  observedOn?: string
  waterElevation?: string
  temperature?: string
  observer?: string
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 地下水批次唯一数据源：井点列表、异常处理入口、整编待办都走这个 store，
 * 保证读到的是同一批次状态；任何写操作先在副本上完成，再一次性落库。
 */
export const useGroundwaterStore = defineStore('groundwater-batches', {
  state: () => ({
    batches: listBatches() as GroundwaterBatch[],
  }),
  getters: {
    todos: (state): GroundwaterBatch[] => compilationTodos(state.batches),
  },
  actions: {
    effectiveRows(batchId: string): GroundwaterObservation[] {
      const batch = this.batches.find((item) => item.id === batchId)
      return batch ? effectiveObservations(batch) : []
    },

    summary(batchId: string): BatchSummary | null {
      const batch = this.batches.find((item) => item.id === batchId)
      return batch ? summarizeBatch(batch) : null
    },

    hasAbnormal(batchId: string): boolean {
      const batch = this.batches.find((item) => item.id === batchId)
      return batch ? hasActiveAbnormal(batch) : false
    },

    /**
     * 在批次副本上执行领域操作，再一次性落库：
     * - 成功：状态与汇总同次写入，半成品不落库；
     * - 失败：校验类失败不产生变更；缺井点失败只写入续交断点，从缺失井点继续。
     */
    mutate(batchId: string, fn: (batch: GroundwaterBatch) => BatchOpResult): BatchOpResult {
      const index = this.batches.findIndex((item) => item.id === batchId)
      if (index < 0) {
        return { ok: false, message: '没有找到这个观测批次' }
      }
      const draft = clone(this.batches)
      const result = fn(draft[index])
      commitBatches(draft)
      this.batches = draft
      return result
    },

    saveObservation(batchId: string, input: SaveInput): BatchOpResult {
      return this.mutate(batchId, (batch) => saveObservation(batch, input))
    },

    markAbnormal(batchId: string, observationId: number): BatchOpResult {
      return this.mutate(batchId, (batch) => markAbnormal(batch, observationId))
    },

    recover(batchId: string): BatchOpResult {
      return this.mutate(batchId, (batch) => recoverBatch(batch))
    },

    submit(batchId: string): BatchOpResult {
      return this.mutate(batchId, (batch) => submitBatch(batch))
    },

    resume(batchId: string): BatchOpResult {
      return this.mutate(batchId, (batch) => resumeBatch(batch))
    },

    startCompilation(batchId: string): BatchOpResult {
      return this.mutate(batchId, (batch) => startCompilation(batch))
    },

    finishCompilation(batchId: string): BatchOpResult {
      return this.mutate(batchId, (batch) => finishCompilation(batch))
    },

    reset() {
      this.batches = resetBatches()
    },
  },
})
