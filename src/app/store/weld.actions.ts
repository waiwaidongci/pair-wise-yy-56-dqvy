import { createAction, props } from '@ngrx/store'
import type { InspectionPlan, WeldStatus } from '../types'
import type { ServerState } from '../services/revision-server.service'

export const loadWelds = createAction('[Weld] Load')
export const loadWeldsSuccess = createAction(
  '[Weld API] Load Success',
  props<{ server: ServerState; migratedWelders: string[] }>(),
)
export const selectWeld = createAction('[Weld] Select', props<{ id: string }>())
export const filterStatus = createAction('[Weld] Filter Status', props<{ status: string }>())

/** 锁定前（未锁批次）普通工作流：直接流转，不经修订链 */
export const advanceWeld = createAction('[Weld] Advance', props<{ id: string; status: WeldStatus }>())
export const createPlan = createAction('[Inspection] Create Plan', props<{ plan: InspectionPlan }>())

export const writeStarted = createAction('[Revision] Write Started', props<{ requestId: string; label: string }>())
export const writeSucceeded = createAction(
  '[Revision] Write Succeeded',
  props<{ requestId: string; label: string; message: string; duplicated: boolean; server: ServerState }>(),
)
export const writeConflict = createAction('[Revision] Write Conflict', props<{ requestId: string; message: string }>())
export const writeFailed = createAction('[Revision] Write Failed', props<{ requestId: string; error: string; label: string }>())
export const clearWriteNotice = createAction('[Revision] Clear Notice', props<{ requestId: string }>())
