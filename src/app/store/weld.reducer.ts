import { createReducer, on } from '@ngrx/store'
import type { AuditEvent, InspectionPlan, LockSnapshot, PendingRevision, Weld } from '../types'
import * as A from './weld.actions'

export interface WeldState {
  welds: Weld[]
  plans: InspectionPlan[]
  selectedId: string
  statusFilter: string
  locked: boolean
  version: number
  audit: AuditEvent[]
  /** 当前锁定快照（锁定时固定，补录/复检不改原快照，仅置为已失效） */
  lockSnapshot: LockSnapshot | null
  /** 待复核修订链 */
  revisions: PendingRevision[]
  /** 最近一次请求编号（写入失败后保留，用于幂等重试） */
  lastRequestNo: string
  /** 写入失败原因（保留原快照与请求编号） */
  writeError: string | null
  /** 后到者版本冲突标记 */
  conflict: boolean
  /** 重复请求被幂等忽略标记 */
  idempotentHit: boolean
}

const audit: AuditEvent[] = [
  { id: 'AE-1', time: '16:38', actor: '赵岚', action: '提交复检', target: 'W-104', detail: '返修后 UT 复检合格，等待审核签字' },
  { id: 'AE-2', time: '15:12', actor: '陈锋', action: '录入缺陷', target: 'W-107', detail: '翼缘板端部夹渣，长度 12mm，Ⅱ级' },
  { id: 'AE-3', time: '14:20', actor: '系统', action: '资质预警', target: 'W-109', detail: '焊工证书 2026-10-01 到期，不得列入后续检测计划' },
]

export const initialState: WeldState = {
  welds: [],
  plans: [],
  selectedId: '',
  statusFilter: '全部',
  locked: false,
  version: 12,
  audit,
  lockSnapshot: null,
  revisions: [],
  lastRequestNo: '',
  writeError: null,
  conflict: false,
  idempotentHit: false,
}

/** 客户端生成的幂等请求编号 */
export function genRequestNo(): string {
  return `REQ-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** 旧数据升级：按原来有效的焊工资质补齐资质版本（QV-YYYY-MM） */
function deriveQualificationVersion(weld: Weld): string {
  const match = /·\s*(\d{4}-\d{2})/.exec(weld.qualification)
  return match ? `QV-${match[1]}` : `QV-${weld.welder}-${weld.id}`
}

function nowTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

interface RevisionDraft {
  requestNo: string
  type: PendingRevision['type']
  targetId: string
  targetLabel: string
  reason: string
  changes: string[]
  mutate: (weld: Weld) => Weld
}

/**
 * 修订链统一入口：
 * - 幂等：同一请求编号只追加一次（重试不重复追加记录）
 * - 锁定后：生成待复核修订，原快照内容不变，仅置为已失效并退回复核
 * - 未锁定：直接作用于工作副本并累计版本
 */
function applyRevisionDraft(state: WeldState, draft: RevisionDraft): WeldState {
  // 幂等：请求编号已处理过，直接忽略，不重复追加
  if (state.revisions.some((r) => r.requestNo === draft.requestNo)) {
    return { ...state, lastRequestNo: draft.requestNo, idempotentHit: true }
  }
  const revision: PendingRevision = {
    id: `REV-${state.revisions.length + 1}`,
    requestNo: draft.requestNo,
    basedOnVersion: state.version,
    type: draft.type,
    targetId: draft.targetId,
    targetLabel: draft.targetLabel,
    reason: draft.reason,
    changes: draft.changes,
    createdAt: nowTime(),
    state: '待复核',
  }
  const wasLocked = state.locked && state.lockSnapshot?.state === '有效'
  const welds = state.welds.map((w) => (w.id === draft.targetId ? draft.mutate(w) : w))
  const invalidated = wasLocked
    ? {
        ...state.lockSnapshot!,
        state: '已失效' as const,
        invalidReason: `${draft.type}：${draft.targetLabel} ${draft.reason}`,
        invalidatedAt: revision.createdAt,
      }
    : state.lockSnapshot
  return {
    ...state,
    welds,
    version: state.version + 1,
    revisions: [revision, ...state.revisions],
    lastRequestNo: draft.requestNo,
    writeError: null,
    conflict: false,
    idempotentHit: false,
    lockSnapshot: invalidated,
    audit: [
      {
        id: `AE-${Date.now()}`,
        time: revision.createdAt,
        actor: '当前审核人',
        action: draft.type,
        target: draft.targetId,
        detail: `${draft.changes.join('；')}。生成待复核修订 ${revision.id}（请求编号 ${draft.requestNo}）` +
          (wasLocked ? '；原锁定结论失效，退回复核' : ''),
      },
      ...state.audit,
    ],
  }
}

export const weldReducer = createReducer(
  initialState,

  on(A.loadWeldsSuccess, (state, { welds, plans }) => {
    // 旧数据升级：缺少资质版本的焊缝，按原来有效的焊工资质补齐版本
    const migrated = welds.some((w) => w.qualificationVersion == null)
    const upgraded = welds.map((w) => ({
      ...w,
      qualificationVersion: w.qualificationVersion ?? deriveQualificationVersion(w),
    }))
    return {
      ...state,
      welds: upgraded,
      plans,
      selectedId: state.selectedId || upgraded[0]?.id || '',
      audit: migrated
        ? [
            { id: `AE-${Date.now()}`, time: '刚刚', actor: '系统', action: '旧数据升级', target: '资质版本补齐', detail: '按原来有效的焊工资质补齐资质版本（QV），纳入修订链管理' },
            ...state.audit,
          ]
        : state.audit,
    }
  }),

  on(A.selectWeld, (state, { id }) => ({ ...state, selectedId: id })),

  on(A.filterStatus, (state, { status }) => ({ ...state, statusFilter: status })),

  on(A.advanceWeld, (state, { id, status }) => ({
    ...state,
    version: state.version + 1,
    welds: state.welds.map((weld) => (weld.id === id ? { ...weld, status } : weld)),
    audit: [
      { id: `AE-${Date.now()}`, time: nowTime(), actor: '当前审核人', action: '状态流转', target: id, detail: `状态变更为 ${status}` },
      ...state.audit,
    ],
  })),

  on(A.createPlan, (state, { plan }) => ({ ...state, plans: [plan, ...state.plans], version: state.version + 1 })),

  on(A.lockBaseline, (state) => {
    if (state.locked && state.lockSnapshot?.state === '有效') return state
    const requestNo = genRequestNo()
    const snapshot: LockSnapshot = {
      id: `LS-${state.version + 1}`,
      requestNo,
      planId: state.plans[0]?.id ?? '',
      basedOnVersion: state.version,
      version: state.version + 1,
      lockedAt: nowTime(),
      lockedBy: '质量负责人',
      welds: state.welds.map((w) => ({
        weldId: w.id,
        qualificationVersion: w.qualificationVersion,
        inspectionRatio: w.inspectionRatio,
        requiredRatio: w.requiredRatio,
        defects: w.defects.map((d) => ({ ...d })),
        repairs: w.repairs,
        status: w.status,
      })),
      state: '有效',
    }
    return {
      ...state,
      locked: true,
      version: state.version + 1,
      lockSnapshot: snapshot,
      lastRequestNo: requestNo,
      writeError: null,
      conflict: false,
      audit: [
        {
          id: `AE-${Date.now()}`,
          time: snapshot.lockedAt,
          actor: '质量负责人',
          action: '签字锁定',
          target: '检测批次',
          detail: `锁定快照 ${snapshot.id}（请求编号 ${requestNo}）：固定 ${snapshot.welds.length} 条焊缝的资质版本、检测比例、缺陷与返修记录`,
        },
        ...state.audit,
      ],
    }
  }),

  on(A.supplementQualification, (state, { weldId, certificateNo, validTo, requestNo }) => {
    const weld = state.welds.find((w) => w.id === weldId)
    if (!weld) return state
    const versionTag = validTo.slice(0, 7)
    return applyRevisionDraft(state, {
      requestNo: requestNo || genRequestNo(),
      type: '资质补录',
      targetId: weldId,
      targetLabel: `${weld.welder}（${weld.id}）`,
      reason: `补录焊工资质证书 ${certificateNo}，有效期至 ${validTo}`,
      changes: [`资质版本 ${weld.qualificationVersion} → QV-${versionTag}`, `证书编号 ${certificateNo}`],
      mutate: (w) => ({
        ...w,
        qualification: `GB/T 9448 · ${versionTag}`,
        qualificationValid: true,
        qualificationVersion: `QV-${versionTag}`,
      }),
    })
  }),

  on(A.adjustRatio, (state, { weldId, ratio, reason, requestNo }) => {
    const weld = state.welds.find((w) => w.id === weldId)
    if (!weld) return state
    return applyRevisionDraft(state, {
      requestNo: requestNo || genRequestNo(),
      type: '比例调整',
      targetId: weldId,
      targetLabel: weldId,
      reason: reason || `检测比例由 ${weld.inspectionRatio}% 调整为 ${ratio}%`,
      changes: [`检测比例 ${weld.inspectionRatio}% → ${ratio}%`],
      mutate: (w) => ({ ...w, inspectionRatio: ratio }),
    })
  }),

  on(A.updateReinspection, (state, { weldId, status, reason, requestNo }) => {
    const weld = state.welds.find((w) => w.id === weldId)
    if (!weld) return state
    return applyRevisionDraft(state, {
      requestNo: requestNo || genRequestNo(),
      type: '复检更新',
      targetId: weldId,
      targetLabel: weldId,
      reason: reason || `复检结果更新为 ${status}`,
      changes: [`状态 ${weld.status} → ${status}`],
      mutate: (w) => ({ ...w, status }),
    })
  }),

  // 乐观并发：两位审核人同时保存同一批次，只成立一次；后到者看到版本冲突
  on(A.saveBatch, (state, { requestNo, basedOnVersion, actor }) => {
    if (state.lastRequestNo === requestNo || state.revisions.some((r) => r.requestNo === requestNo)) {
      return { ...state, idempotentHit: true, lastRequestNo: requestNo }
    }
    if (basedOnVersion !== state.version) {
      return {
        ...state,
        conflict: true,
        lastRequestNo: requestNo,
        audit: [
          {
            id: `AE-${Date.now()}`,
            time: nowTime(),
            actor,
            action: '版本冲突',
            target: '检测批次保存',
            detail: `请求编号 ${requestNo} 基于过期版本 v${basedOnVersion}，当前版本 v${state.version}；后到者保存不成立`,
          },
          ...state.audit,
        ],
      }
    }
    return {
      ...state,
      version: state.version + 1,
      conflict: false,
      lastRequestNo: requestNo,
      audit: [
        {
          id: `AE-${Date.now()}`,
          time: nowTime(),
          actor,
          action: '批次保存',
          target: '检测批次',
          detail: `请求编号 ${requestNo} 保存成立，版本 v${basedOnVersion} → v${state.version + 1}`,
        },
        ...state.audit,
      ],
    }
  }),

  // 写入失败：保留原快照与请求编号，不追加修订
  on(A.failWrite, (state, { requestNo, reason, targetId, summary }) => ({
    ...state,
    writeError: `写入失败（请求编号 ${requestNo}）：${reason}。原锁定快照已保留，重试不重复追加记录。`,
    lastRequestNo: requestNo,
    audit: [
      {
        id: `AE-${Date.now()}`,
        time: nowTime(),
        actor: '当前审核人',
        action: '写入失败',
        target: targetId,
        detail: `请求编号 ${requestNo} 写入失败：${summary}；原快照保留，未追加修订`,
      },
      ...state.audit,
    ],
  })),

  on(A.clearWriteError, (state) => ({ ...state, writeError: null })),

  // 复核通过：标记修订通过；全部通过后按当前工作副本重新锁定生成新快照
  on(A.approveRevision, (state, { requestNo }) => {
    const revision = state.revisions.find((r) => r.requestNo === requestNo)
    if (!revision || revision.state !== '待复核') return state
    const revisions = state.revisions.map((r) => (r.requestNo === requestNo ? { ...r, state: '已通过' as const } : r))
    const allApproved = revisions.every((r) => r.state === '已通过' || r.state === '已驳回')
    const stillPending = revisions.some((r) => r.state === '待复核')
    let lockSnapshot = state.lockSnapshot
    let version = state.version
    let locked = state.locked
    if (!stillPending) {
      // 复核完成，重新锁定生成新的有效快照
      version = state.version + 1
      locked = true
      lockSnapshot = {
        id: `LS-${version}`,
        requestNo: genRequestNo(),
        planId: state.plans[0]?.id ?? '',
        basedOnVersion: version - 1,
        version,
        lockedAt: nowTime(),
        lockedBy: '质量负责人',
        welds: state.welds.map((w) => ({
          weldId: w.id,
          qualificationVersion: w.qualificationVersion,
          inspectionRatio: w.inspectionRatio,
          requiredRatio: w.requiredRatio,
          defects: w.defects.map((d) => ({ ...d })),
          repairs: w.repairs,
          status: w.status,
        })),
        state: '有效',
      }
    }
    return {
      ...state,
      revisions,
      lockSnapshot,
      version,
      locked,
      conflict: false,
      audit: [
        {
          id: `AE-${Date.now()}`,
          time: nowTime(),
          actor: '质量负责人',
          action: '复核通过',
          target: revision.targetId,
          detail: `修订 ${revision.id}（请求编号 ${requestNo}）复核通过` + (allApproved ? '；全部修订已复核，重新锁定生成新快照' : ''),
        },
        ...state.audit,
      ],
    }
  }),

  on(A.rejectRevision, (state, { requestNo }) => {
    const revision = state.revisions.find((r) => r.requestNo === requestNo)
    if (!revision || revision.state !== '待复核') return state
    return {
      ...state,
      revisions: state.revisions.map((r) => (r.requestNo === requestNo ? { ...r, state: '已驳回' as const } : r)),
      audit: [
        {
          id: `AE-${Date.now()}`,
          time: nowTime(),
          actor: '质量负责人',
          action: '复核驳回',
          target: revision.targetId,
          detail: `修订 ${revision.id}（请求编号 ${requestNo}）复核驳回，保持退回复核状态`,
        },
        ...state.audit,
      ],
    }
  })
)
