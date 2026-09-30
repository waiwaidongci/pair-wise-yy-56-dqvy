import { createAction, props } from '@ngrx/store'
import type { InspectionPlan, Weld, WeldStatus } from '../types'

export const loadWelds = createAction('[Weld] Load')
export const loadWeldsSuccess = createAction('[Weld API] Load Success', props<{ welds: Weld[]; plans: InspectionPlan[] }>())
export const selectWeld = createAction('[Weld] Select', props<{ id: string }>())
export const filterStatus = createAction('[Weld] Filter Status', props<{ status: string }>())
export const advanceWeld = createAction('[Weld] Advance', props<{ id: string; status: WeldStatus }>())
export const createPlan = createAction('[Inspection] Create Plan', props<{ plan: InspectionPlan }>())
export const lockBaseline = createAction('[Approval] Lock Baseline')

// ---- 修订链：补录 / 调整 / 复检只生成待复核修订，不改原快照 ----
export const supplementQualification = createAction(
  '[Revision] Supplement Qualification',
  props<{ weldId: string; certificateNo: string; validTo: string; requestNo?: string }>(),
)
export const adjustRatio = createAction(
  '[Revision] Adjust Ratio',
  props<{ weldId: string; ratio: number; reason?: string; requestNo?: string }>(),
)
export const updateReinspection = createAction(
  '[Revision] Update Reinspection',
  props<{ weldId: string; status: WeldStatus; reason?: string; requestNo?: string }>(),
)

// ---- 乐观并发：两位审核人同时保存同一批次，只成立一次 ----
export const saveBatch = createAction(
  '[Revision] Save Batch',
  props<{ requestNo: string; basedOnVersion: number; actor: string }>(),
)

// ---- 写入失败：保留原快照与请求编号，重试不重复追加 ----
export const failWrite = createAction(
  '[Revision] Fail Write',
  props<{ requestNo: string; reason: string; targetId: string; summary: string }>(),
)
export const clearWriteError = createAction('[Revision] Clear Write Error')

// ---- 复核：通过后重新锁定生成新快照；驳回保留待复核状态 ----
export const approveRevision = createAction('[Revision] Approve', props<{ requestNo: string }>())
export const rejectRevision = createAction('[Revision] Reject', props<{ requestNo: string }>())
