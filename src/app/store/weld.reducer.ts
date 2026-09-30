import { createReducer, on } from '@ngrx/store'
import type { AuditEvent, InspectionPlan, QualificationVersion, Revision, Weld } from '../types'
import type { ServerState } from '../services/revision-server.service'
import * as A from './weld.actions'

export interface WriteNotice {
  requestId: string
  label: string
  kind: 'success' | 'conflict' | 'failure' | 'pending'
  message: string
  /** 失败后保留请求编号：重试按钮沿用同一 requestId，保证不重复追加 */
  retryable: boolean
}

export interface WeldState {
  batchId: string
  welds: Weld[]
  plans: InspectionPlan[]
  qualifications: QualificationVersion[]
  revisions: Revision[]
  selectedId: string
  statusFilter: string
  audit: AuditEvent[]
  stateVersion: number
  migratedWelders: string[]
  notice: WriteNotice | null
}

const seedAudit: AuditEvent[] = [
  { id: 'AE-1', time: '16:38', actor: '赵岚', action: '提交复检', target: 'W-104', detail: '返修后 UT 复检合格，等待审核签字' },
  { id: 'AE-2', time: '15:12', actor: '陈锋', action: '录入缺陷', target: 'W-107', detail: '翼缘板端部夹渣，长度 12mm，Ⅱ级' },
  { id: 'AE-3', time: '14:20', actor: '系统', action: '资质预警', target: 'W-109', detail: '焊工证书 2026-10-01 到期，不得列入后续检测计划' },
]

export const initialState: WeldState = {
  batchId: '',
  welds: [],
  plans: [],
  qualifications: [],
  revisions: [],
  selectedId: '',
  statusFilter: '全部',
  audit: seedAudit,
  stateVersion: 1,
  migratedWelders: [],
  notice: null,
}

function adoptServer(state: WeldState, server: ServerState): WeldState {
  return {
    ...state,
    batchId: server.batchId,
    welds: server.welds,
    plans: server.plans,
    qualifications: server.qualifications,
    revisions: server.revisions,
    audit: server.audit,
    stateVersion: server.stateVersion,
  }
}

function makeNotice(notice: WriteNotice): WriteNotice {
  return notice
}

export const weldReducer = createReducer(
  initialState,
  on(A.loadWeldsSuccess, (state, { server, migratedWelders }) => ({
    ...adoptServer(state, server),
    selectedId: state.selectedId || server.welds[0]?.id || '',
    migratedWelders,
    notice: migratedWelders.length
      ? makeNotice({ requestId: 'migration', label: '旧数据升级', kind: 'success', message: `已按焊接时点有效资质为 ${migratedWelders.join('、')} 补齐资质版本，并展开返修记录`, retryable: false })
      : state.notice,
  })),
  on(A.selectWeld, (state, { id }) => ({ ...state, selectedId: id })),
  on(A.filterStatus, (state, { status }) => ({ ...state, statusFilter: status })),
  on(A.advanceWeld, (state, { id, status }) => ({
    ...state,
    welds: state.welds.map((weld) => (weld.id === id ? { ...weld, status } : weld)),
    audit: [
      { id: `AE-${Date.now()}`, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }), actor: '当前审核人', action: '状态流转', target: id, detail: `锁定前工作版本直接变更为 ${status}` },
      ...state.audit,
    ],
  })),
  on(A.createPlan, (state, { plan }) => ({
    ...state,
    plans: [plan, ...state.plans],
    audit: [{ id: `AE-${Date.now()}`, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }), actor: '当前审核人', action: '新增计划', target: plan.id, detail: `检测计划纳入批次 ${plan.batchId}，待锁定时固化快照` }, ...state.audit],
  })),
  on(A.writeStarted, (state, { requestId, label }) => ({
    ...state,
    notice: makeNotice({ requestId, label, kind: 'pending', message: `正在写入（${requestId}）…`, retryable: false }),
  })),
  on(A.writeSucceeded, (state, { requestId, label, message, duplicated, server }) => ({
    ...adoptServer(state, server),
    notice: makeNotice({ requestId, label, kind: 'success', message: duplicated ? `${message}（请求编号重复，直接返回首次结果，未重复追加）` : message, retryable: false }),
  })),
  on(A.writeConflict, (state, { requestId, message }) => ({
    ...state,
    notice: makeNotice({ requestId, label: '版本冲突', kind: 'conflict', message, retryable: false }),
  })),
  on(A.writeFailed, (state, { requestId, error, label }) => ({
    ...state,
    notice: makeNotice({ requestId, label, kind: 'failure', message: error, retryable: true }),
  })),
  on(A.clearWriteNotice, (state, { requestId }) => (state.notice?.requestId === requestId ? { ...state, notice: null } : state)),
)
