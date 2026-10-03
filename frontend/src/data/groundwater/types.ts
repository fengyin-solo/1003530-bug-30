/** 地下水观测批次领域的公共类型。 */

/** 批次状态：井点列表、异常处理入口、整编待办三处读取同一状态。 */
export type BatchStatus = '采集中' | '待整编' | '异常待处理' | '整编中' | '已整编'

/** 提交过程的瞬时标记：只记录失败及断点，成功后随状态同次清除，不允许残留。 */
export type FailureMarker = {
  reason: 'missing_wells'
  missingWells: string[]
  /** 已提交过的井点：恢复时从缺失井点继续，这些井点不重复提交。 */
  committedWells: string[]
  at: number
} | null

export type GroundwaterObservation = {
  /** 行主键。 */
  id: number
  /** 观测记录编号。 */
  recordNo: string
  wellCode: string
  /** 观测日期：旧数据可能缺失，读取时按批次日期兼容补齐，不回写旧值以外的派生字段。 */
  observedOn: string
  /** 埋深值（米）。同一井点同一天保存多份时以后保存的为准。 */
  depth: number
  waterElevation: string
  temperature: string
  observer: string
  /** 异常值（可被批次级恢复一次性清掉），恢复必须走批次，不能单条自行恢复。 */
  abnormal: boolean
  /** 提交进批次的先后顺序，用于「后保存覆盖先保存」的判定。 */
  savedAt: number
}

export type GroundwaterBatch = {
  id: string
  /** 批次编号。 */
  batchNo: string
  /** 批次日期：旧观测日期缺失时的兼容兜底日期。 */
  batchDate: string
  /** 本批次计划观测的井点；提交时缺一个都不算成功。 */
  plannedWells: string[]
  status: BatchStatus
  observations: GroundwaterObservation[]
  failure: FailureMarker
  /** 成功提交时间：与汇总同次落库。 */
  submittedAt: number | null
  /** 成功提交时与状态同次落库的汇总；重复提交不会重建。 */
  summary: BatchSummary | null
  updatedAt: number
}

export type BatchSummary = {
  totalWells: number
  observedWells: number
  /** 去重后实际参与提交的井点数。 */
  acceptedWells: number
  abnormalWells: number
  missingWells: string[]
  observationCount: number
}

/** 写操作的统一结果。 */
export type BatchOpResult = {
  ok: boolean
  message: string
}
