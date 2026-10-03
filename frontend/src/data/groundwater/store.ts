import { GROUNDWATER_SEED_BATCHES } from './seed'
import type { GroundwaterBatch } from './types'

// 地下水批次单独存一份：与通用条目存储隔离，三个入口读同一份批次状态。
const STORAGE_KEY = 'hydrology-monitor-station:groundwater-batches'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): GroundwaterBatch[] {
  const fallback = clone(GROUNDWATER_SEED_BATCHES)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as GroundwaterBatch[]
    if (!Array.isArray(parsed)) {
      throw new Error('bad shape')
    }
    return parsed
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: GroundwaterBatch[] | null = null

export function listBatches(): GroundwaterBatch[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

/** 一次性落库：状态流转与汇总必须通过同一次写入提交，避免半成品状态。 */
export function commitBatches(next: GroundwaterBatch[]): void {
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetBatches(): GroundwaterBatch[] {
  const fresh = clone(GROUNDWATER_SEED_BATCHES)
  commitBatches(fresh)
  return fresh
}

export function groundwaterStorageKey(): string {
  return STORAGE_KEY
}
