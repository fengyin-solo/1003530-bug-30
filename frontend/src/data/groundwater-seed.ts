import type { GwState } from './groundwater-types'

// 地下水批次示例：
// 1) GW-B20260928 观测中，J03 缺埋深、J02 有未处理异常（且存在被顶替的历史埋深）；
// 2) GW-B20260927 已提交待整编（整编页待办读取同一批次状态）；
// 3) GW-B20260926 已整编（不出现在待办，只在已完成区显示）。
// 另：id=2 的历史记录观测日期缺失，读取时按批次日期 2026-09-28 兼容。
export const GW_SEED_STATE: GwState = {
  batches: [
    { id: 'GW-B20260926', batchDate: '2026-09-26', wellCodes: ['J01', 'J02'], status: '已整编', createdAt: 1780000000000 },
    { id: 'GW-B20260927', batchDate: '2026-09-27', wellCodes: ['J01', 'J02', 'J03'], status: '待整编', createdAt: 1780000000001 },
    { id: 'GW-B20260928', batchDate: '2026-09-28', wellCodes: ['J01', 'J02', 'J03'], status: '观测中', createdAt: 1780000000002 },
  ],
  records: [
    // 已整编批次
    {
      id: 1, batchId: 'GW-B20260926', wellCode: 'J01', observedDate: '2026-09-26',
      depth: 12.4, observer: '王立群', note: '', state: '有效', createdAt: 1780000010000, supersededId: null,
    },
    {
      id: 2, batchId: 'GW-B20260926', wellCode: 'J02', observedDate: '2026-09-26',
      depth: 8.7, observer: '李文静', note: '', state: '有效', createdAt: 1780000010001, supersededId: null,
    },
    // 待整编批次
    {
      id: 3, batchId: 'GW-B20260927', wellCode: 'J01', observedDate: '2026-09-27',
      depth: 12.6, observer: '王立群', note: '', state: '有效', createdAt: 1780000020000, supersededId: null,
    },
    {
      id: 4, batchId: 'GW-B20260927', wellCode: 'J02', observedDate: '2026-09-27',
      depth: 8.9, observer: '李文静', note: '', state: '有效', createdAt: 1780000020001, supersededId: null,
    },
    {
      id: 5, batchId: 'GW-B20260927', wellCode: 'J03', observedDate: '2026-09-27',
      depth: 15.2, observer: '赵鹏', note: '', state: '有效', createdAt: 1780000020002, supersededId: null,
    },
    // 观测中批次：J01 正常
    {
      id: 6, batchId: 'GW-B20260928', wellCode: 'J01', observedDate: '2026-09-28',
      depth: 12.7, observer: '王立群', note: '', state: '有效', createdAt: 1780000030000, supersededId: null,
    },
    // J02：历史旧记录（观测日期缺失，按批次日期兼容），已被新埋深顶替
    {
      id: 7, batchId: 'GW-B20260928', wellCode: 'J02', observedDate: '',
      depth: 9.9, observer: '李文静', note: '初测，日期漏填', state: '顶替', createdAt: 1780000030001, supersededId: null,
    },
    // J02：当前异常记录待处理（它顶替了 id=7）
    {
      id: 8, batchId: 'GW-B20260928', wellCode: 'J02', observedDate: '2026-09-28',
      depth: 31.5, observer: '李文静', note: '埋深突变，疑似读数错误', state: '异常',
      createdAt: 1780000030002, supersededId: 7,
    },
    // J03 缺失：无记录
  ],
  todos: [
    {
      id: 1, batchId: 'GW-B20260926', batchDate: '2026-09-26', wellCount: 2, recordCount: 2,
      createdAt: 1780000040000, compiledAt: 1780000050000, done: true,
    },
    {
      id: 2, batchId: 'GW-B20260927', batchDate: '2026-09-27', wellCount: 3, recordCount: 3,
      createdAt: 1780000040001, compiledAt: null, done: false,
    },
  ],
  seq: 8,
}
