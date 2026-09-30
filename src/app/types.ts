export type WeldStatus = '待检测' | '合格' | '返修中' | '待复检' | '已关闭'
export type DefectLevel = 'Ⅰ级' | 'Ⅱ级' | 'Ⅲ级' | 'Ⅳ级'
export type RevisionType = '资质补录' | '比例调整' | '复检更新'
export type RevisionState = '待复核' | '已通过' | '已驳回' | '冲突'
export type SnapshotState = '有效' | '已失效'

export interface Defect {
  id: string
  position: number
  type: string
  length: number
  level: DefectLevel
  method: string
  report: string
}

export interface Weld {
  id: string
  drawing: string
  component: string
  joint: string
  method: string
  welder: string
  qualification: string
  qualificationValid: boolean
  /** 焊工资质版本（修订链节点）；旧数据升级时按原来有效的焊工资质补齐 */
  qualificationVersion: string
  inspectionRatio: number
  requiredRatio: number
  status: WeldStatus
  x: number
  y: number
  repairs: number
  defects: Defect[]
}

export interface InspectionPlan {
  id: string
  date: string
  method: string
  weldIds: string[]
  inspector: string
  state: '待执行' | '执行中' | '已完成'
}

/** 锁定快照中每条焊缝的固定值：资质版本、检测比例、缺陷、返修记录 */
export interface WeldSnapshot {
  weldId: string
  qualificationVersion: string
  inspectionRatio: number
  requiredRatio: number
  defects: Defect[]
  repairs: number
  status: WeldStatus
}

/** 签字锁定快照：锁定时固定计划内每条焊缝的资质版本、检测比例、缺陷和返修记录 */
export interface LockSnapshot {
  id: string
  /** 锁定请求编号（写入失败后保留，用于幂等重试） */
  requestNo: string
  planId: string
  basedOnVersion: number
  /** 锁定后的数据版本 */
  version: number
  lockedAt: string
  lockedBy: string
  welds: WeldSnapshot[]
  state: SnapshotState
  invalidReason?: string
  invalidatedAt?: string
}

/** 待复核修订：补录 / 复检只生成待复核修订，不改原快照 */
export interface PendingRevision {
  id: string
  /** 请求编号（客户端生成的幂等键；重试不重复追加） */
  requestNo: string
  /** 乐观并发基准版本 */
  basedOnVersion: number
  type: RevisionType
  targetId: string
  targetLabel: string
  reason: string
  changes: string[]
  createdAt: string
  state: RevisionState
}

export interface AuditEvent {
  id: string
  time: string
  actor: string
  action: string
  target: string
  detail: string
}
