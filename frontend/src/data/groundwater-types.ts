/** 地下水观测批次领域模型。
 * 井点列表、异常处理、整编待办三处共享同一份批次状态（GwBatchState 是唯一事实来源）。 */

/** 批次状态：观测中 -> 待整编 -> 已整编，只能沿这条状态机单向流转。 */
export type GwBatchStatus = '观测中' | '待整编' | '已整编'

/** 观测记录生命周期：有效 ->（被同井同日更新记录顶替）顶替 /（修复动作）顶替；异常 -> 已修复。 */
export type GwRecordState = '有效' | '异常' | '已修复' | '顶替'

export type GwDepthRecord = {
  id: number
  batchId: string
  wellCode: string
  /** 观测日期。历史数据可能缺失，读取时按批次日期兼容（见 effectiveDate）。 */
  observedDate: string
  depth: number
  observer: string
  note: string
  state: GwRecordState
  createdAt: number
  /** 顶替了哪条记录（同井同日保留最新一份时，被顶替记录留痕）。 */
  supersededId: number | null
}

export type GwBatch = {
  id: string
  batchDate: string
  wellCodes: string[]
  status: GwBatchStatus
  createdAt: number
}

export type GwCompilationTodo = {
  id: number
  batchId: string
  batchDate: string
  wellCount: number
  recordCount: number
  createdAt: number
  compiledAt: number | null
  done: boolean
}

export type GwState = {
  batches: GwBatch[]
  records: GwDepthRecord[]
  todos: GwCompilationTodo[]
  seq: number
}

export type GwBatchView = GwBatch & {
  /** 缺失埋深的井点（最新记录不是「有效/异常」视为未交记录）。 */
  missingWells: string[]
  /** 尚未处理完的异常记录。 */
  openAbnormal: GwDepthRecord[]
  validCount: number
  totalWells: number
  complete: boolean
}
