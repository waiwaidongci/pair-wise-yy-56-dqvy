export type WeldStatus = '待检测' | '合格' | '返修中' | '待复检' | '已关闭'
export type DefectLevel = 'Ⅰ级' | 'Ⅱ级' | 'Ⅲ级' | 'Ⅳ级'

export interface Defect {
  id: string
  position: number
  type: string
  length: number
  level: DefectLevel
  method: string
  report: string
}

export interface RepairRecord {
  id: string
  round: number
  date: string
  result: string
}

/** 焊工资质版本：资质补录只产生新版本，旧版本永久保留在快照中 */
export interface QualificationVersion {
  id: string
  welder: string
  standard: string
  expiry: string
  /** 以焊接完成时点判断该版本当时是否有效（历史补录同样按此回填） */
  validAtWeldTime: boolean
  source: '当前台账' | '历史台账补录'
}

export interface Weld {
  id: string
  drawing: string
  component: string
  joint: string
  method: string
  welder: string
  /** 工作数据当前指向的资质版本；锁定快照内固化具体版本对象 */
  qualificationId: string | null
  inspectionRatio: number
  requiredRatio: number
  status: WeldStatus
  x: number
  y: number
  repairs: number
  defects: Defect[]
  repairRecords: RepairRecord[]
  /** 最近一次待复核修订（仅展示用） */
  pendingRevisionId?: string | null
  /** 当前有效修订中该焊缝被失效/取代时的原因（仅展示用） */
  invalidReason?: string | null
}

export interface InspectionPlan {
  id: string
  date: string
  method: string
  weldIds: string[]
  inspector: string
  state: '待执行' | '执行中' | '已完成'
  /** 计划所属检测批次，修订链按批次组织 */
  batchId: string
  /** 计划被锁定进的修订；后续调整只生成待复核修订 */
  lockedInRevisionId?: string | null
  invalidReason?: string | null
}

/** 修订类型：锁定基线、焊工资质补录、检测比例调整、复检结果更新 */
export type RevisionType = '锁定基线' | '焊工资质补录' | '检测比例调整' | '复检结果更新'
export type RevisionStatus = '待复核' | '有效' | '已失效'
/** 失效原因：后到修订作废的是“原锁定结论”，而非原快照本身 */
export type InvalidReason = '焊工资质补录' | '检测比例调整' | '复检结果更新' | '复核退回' | '被新修订取代'
export type BatchStatus = '修订待复核' | '原锁定已失效' | '已签字锁定' | '未锁定'

/** 锁定时按“计划内每条焊缝”固化的不可变条目 */
export interface RevisionEntry {
  weldId: string
  drawing: string
  component: string
  method: string
  welder: string
  qualification: QualificationVersion
  inspectionRatio: number
  requiredRatio: number
  status: WeldStatus
  defects: Defect[]
  repairRecords: RepairRecord[]
}

export interface RevisionChange {
  field: string
  label: string
  weldId: string
  before: string
  after: string
}

export interface Revision {
  id: string
  serial: number
  batchId: string
  type: RevisionType
  status: RevisionStatus
  parentId: string | null
  time: string
  actor: string
  reason: string
  requestId: string
  /** 关联检测计划 */
  planIds: string[]
  /** 计划内每条焊缝的资质版本、检测比例、缺陷与返修记录固化值 */
  entries: RevisionEntry[]
  changes: RevisionChange[]
  invalidReason: InvalidReason | null
  invalidatedById: string | null
  reviewer: string | null
  reviewedTime: string | null
  reviewNote: string | null
}

export interface AuditEvent {
  id: string
  time: string
  actor: string
  action: string
  target: string
  detail: string
}

/** GraphQL/历史台账返回的旧结构（无资质版本与返修记录） */
export interface LegacyDefect {
  id: string
  position: number
  type: string
  length: number
  level: DefectLevel
  method: string
  report: string
}

export interface LegacyWeld {
  id: string
  drawing: string
  component: string
  joint: string
  method: string
  welder: string
  qualification: string
  qualificationValid: boolean
  inspectionRatio: number
  requiredRatio: number
  status: WeldStatus
  x: number
  y: number
  repairs: number
  defects: LegacyDefect[]
}

export interface LegacyPlan {
  id: string
  date: string
  method: string
  weldIds: string[]
  inspector: string
  state: '待执行' | '执行中' | '已完成'
}
