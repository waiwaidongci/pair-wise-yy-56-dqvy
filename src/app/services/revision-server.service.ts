import { Injectable } from '@angular/core'
import type {
  AuditEvent,
  InspectionPlan,
  InvalidReason,
  QualificationVersion,
  Revision,
  RevisionEntry,
  Weld,
  WeldStatus,
} from '../types'

export interface ServerState {
  batchId: string
  welds: Weld[]
  plans: InspectionPlan[]
  qualifications: QualificationVersion[]
  revisions: Revision[]
  audit: AuditEvent[]
  stateVersion: number
}

export interface RevisionResult {
  ok: boolean
  conflict?: string
  error?: string
  requestId: string
  revision?: Revision
  qualifications?: QualificationVersion[]
  stateVersion: number
  duplicated?: boolean
}

export interface ProposeRequest {
  batchId: string
  requestId: string
  expectedVersion: number
  actor: string
  type: Exclude<Revision['type'], '锁定基线'>
  reason: string
  weldIds: string[]
  qualification?: { welder: string; standard: string; expiry: string; validAtWeldTime: boolean }
  ratio?: number
  recheckStatus?: WeldStatus
  recheckNote?: string
}

const now = () => new Date().toLocaleString('zh-CN', { hour12: false })
const revId = (serial: number) => `REV-${String(serial).padStart(3, '0')}`

/**
 * 模拟服务端的权威写入层：
 * - 锁定快照只追加，从不原地改写；补录/比例/复检生成“待复核”修订并作废旧锁定结论。
 * - 待复核期间工作数据不动（退回复核可直接作废修订）；复核通过才把修订条目落到工作数据。
 * - 乐观版本号 + 待复核互斥保证并发保存只成立一次，后到者拿到版本冲突。
 * - requestId 幂等：写入失败不落任何记录，重试沿用同一 requestId，不会重复追加。
 */
@Injectable({ providedIn: 'root' })
export class RevisionServerService {
  private state: ServerState | null = null
  private readonly results = new Map<string, RevisionResult>()
  /** 演示用：下一次写入必定失败（一次性），失败后可用同一请求编号重试 */
  failNextWrite = false
  private serial = 0

  seed(data: { batchId: string; welds: Weld[]; plans: InspectionPlan[]; qualifications: QualificationVersion[]; audit: AuditEvent[] }) {
    this.serial = 0
    this.results.clear()
    this.failNextWrite = false
    this.state = {
      batchId: data.batchId,
      welds: data.welds.map((weld) => ({ ...weld, defects: [...weld.defects], repairRecords: [...weld.repairRecords] })),
      plans: data.plans.map((plan) => ({ ...plan, weldIds: [...plan.weldIds] })),
      qualifications: data.qualifications.map((qualification) => ({ ...qualification })),
      revisions: [],
      audit: data.audit,
      stateVersion: 1,
    }
  }

  getState(): ServerState {
    if (!this.state) throw new Error('修订服务尚未初始化')
    return this.state
  }

  lock(params: {
    batchId: string
    requestId: string
    expectedVersion: number
    actor: string
    reason: string
  }): RevisionResult {
    const state = this.requireState()
    if (this.results.has(params.requestId)) return this.replay(params.requestId)
    if (params.expectedVersion !== state.stateVersion) {
      return this.fail(params.requestId, 409, `版本冲突：检测批次已被他人保存（当前 v${state.stateVersion}），请刷新后重试`)
    }
    const pending = state.revisions.find((revision) => revision.status === '待复核')
    const effective = state.revisions.find((revision) => revision.status === '有效')
    if (pending) return this.fail(params.requestId, 409, `已有待复核修订 ${pending.id}，须先完成复核才能再次锁定`)
    if (effective) return this.fail(params.requestId, 409, `检测批次已被锁定（${effective.id}），修订只能以待复核形式追加`)
    if (this.consumeFailure(params.requestId)) return this.failure(params.requestId, '服务端写入失败：锁定未保存，原快照保留，请用同一请求编号重试')

    const plans = state.plans.filter((plan) => plan.batchId === params.batchId)
    const weldIds = this.batchWeldIds(plans)
    const serial = ++this.serial
    const revision: Revision = {
      id: revId(serial),
      serial,
      batchId: params.batchId,
      type: '锁定基线',
      status: '有效',
      parentId: null,
      time: now(),
      actor: params.actor,
      reason: params.reason,
      requestId: params.requestId,
      planIds: plans.map((plan) => plan.id),
      entries: weldIds.map((weldId) => this.snapshotWorking(weldId)),
      changes: [],
      invalidReason: null,
      invalidatedById: null,
      reviewer: params.actor,
      reviewedTime: now(),
      reviewNote: '签字锁定',
    }
    plans.forEach((plan) => { plan.lockedInRevisionId = revision.id; plan.invalidReason = null })
    state.revisions.push(revision)
    state.stateVersion += 1
    state.audit.unshift({ id: `AE-${Date.now()}`, time: now(), actor: params.actor, action: '签字锁定', target: params.batchId, detail: `${revision.id} 固化 ${revision.entries.length} 条计划内焊缝的资质版本、检测比例、缺陷与返修记录` })
    return this.succeed(params.requestId, revision, '锁定快照已生成')
  }

  propose(request: ProposeRequest): RevisionResult {
    const state = this.requireState()
    if (this.results.has(request.requestId)) return this.replay(request.requestId)
    if (request.expectedVersion !== state.stateVersion) {
      return this.fail(request.requestId, 409, `版本冲突：批次当前为 v${state.stateVersion}，您基于 v${request.expectedVersion} 编辑，请刷新后重试`)
    }
    const latest = this.chainHead(request.batchId)
    if (!latest) return this.fail(request.requestId, 409, '批次尚未锁定，不能生成修订')
    if (latest.status === '待复核') return this.fail(request.requestId, 409, `已有待复核修订 ${latest.id}，请等待其复核结论`)

    const newQualifications: QualificationVersion[] = []
    for (const weldId of request.weldIds) {
      const previous = latest.entries.find((entry) => entry.weldId === weldId)
      if (!previous) return this.fail(request.requestId, 404, `焊缝 ${weldId} 不在锁定批次内`)
      if (request.type === '焊工资质补录' && request.qualification) {
        const qualification: QualificationVersion = {
          id: `QV-${String(state.qualifications.length + newQualifications.length + 1).padStart(3, '0')}`,
          welder: request.qualification.welder,
          standard: request.qualification.standard,
          expiry: request.qualification.expiry,
          validAtWeldTime: request.qualification.validAtWeldTime,
          source: '当前台账',
        }
        newQualifications.push(qualification)
      }
    }

    // 失败发生在任何状态写入之前：原快照与请求编号均保留
    if (this.consumeFailure(request.requestId)) return this.failure(request.requestId, '服务端写入失败：修订未追加，原快照保留，请用同一请求编号重试')

    state.qualifications.push(...newQualifications)
    let qualificationCursor = 0
    const entries: RevisionEntry[] = latest.entries.map((previous) => {
      if (!request.weldIds.includes(previous.weldId)) return cloneEntry(previous)
      const entry = cloneEntry(previous)
      if (request.type === '焊工资质补录') {
        entry.qualification = { ...newQualifications[qualificationCursor] }
        qualificationCursor += 1
      }
      if (request.type === '检测比例调整' && typeof request.ratio === 'number') entry.inspectionRatio = request.ratio
      if (request.type === '复检结果更新') {
        entry.status = request.recheckStatus ?? previous.status
        if (request.recheckNote) {
          entry.repairRecords = [...previous.repairRecords, {
            id: `${previous.weldId}-RR${previous.repairRecords.length + 1}`,
            round: previous.repairRecords.length + 1,
            date: now().slice(0, 10),
            result: request.recheckNote,
          }]
        }
      }
      return entry
    })

    const changes = this.buildChanges(request, latest, newQualifications)
    const serial = ++this.serial
    const revision: Revision = {
      id: revId(serial),
      serial,
      batchId: request.batchId,
      type: request.type,
      status: '待复核',
      parentId: latest.id,
      time: now(),
      actor: request.actor,
      reason: request.reason,
      requestId: request.requestId,
      planIds: latest.planIds,
      entries,
      changes,
      invalidReason: null,
      invalidatedById: null,
      reviewer: null,
      reviewedTime: null,
      reviewNote: null,
    }
    // 原锁定结论失效并退回复核；原快照对象保持只读
    this.invalidateChainHead(request.batchId, request.type, revision.id)
    state.revisions.push(revision)
    state.stateVersion += 1
    state.audit.unshift({ id: `AE-${Date.now()}`, time: now(), actor: request.actor, action: request.type, target: request.weldIds.join('、'), detail: `${revision.id} 基于 ${latest.id} 生成待复核修订；原锁定结论失效退回复核。${request.reason}` })
    return this.succeed(request.requestId, revision, '待复核修订已生成，原锁定结论已失效', newQualifications)
  }

  review(params: {
    requestId: string
    expectedVersion: number
    revisionId: string
    approve: boolean
    reviewer: string
    note: string
  }): RevisionResult {
    const state = this.requireState()
    if (this.results.has(params.requestId)) return this.replay(params.requestId)
    if (params.expectedVersion !== state.stateVersion) {
      return this.fail(params.requestId, 409, `版本冲突：批次当前为 v${state.stateVersion}，复核结论基于过期版本`)
    }
    const revision = state.revisions.find((item) => item.id === params.revisionId)
    if (!revision) return this.fail(params.requestId, 404, `修订 ${params.revisionId} 不存在`)
    if (revision.status !== '待复核') return this.fail(params.requestId, 409, `${revision.id} 已是“${revision.status}”状态，复核只成立一次`)
    if (this.consumeFailure(params.requestId)) return this.failure(params.requestId, '服务端写入失败：复核未保存，请用同一请求编号重试')

    if (params.approve) {
      revision.status = '有效'
      revision.invalidReason = null
      revision.invalidatedById = null
      revision.reviewer = params.reviewer
      revision.reviewedTime = now()
      revision.reviewNote = params.note || '复核通过'
      // 复核通过：修订条目落到工作数据（焊工资质、检测比例、复检结果、返修记录）
      revision.entries.forEach((entry) => this.applyEntry(entry))
      state.stateVersion += 1
      state.audit.unshift({ id: `AE-${Date.now()}`, time: now(), actor: params.reviewer, action: '复核通过', target: revision.id, detail: `修订链当前版本恢复为“有效”，${revision.changes.length} 项变更已落到工作数据` })
    } else {
      revision.status = '已失效'
      revision.invalidReason = '复核退回'
      revision.invalidatedById = revision.id
      revision.reviewer = params.reviewer
      revision.reviewedTime = now()
      revision.reviewNote = params.note || '复核退回'
      // 工作数据从未被待复核修订改动，最近一个有效修订自然仍是锁定结论
      const restored = [...state.revisions].reverse().find((item) => item.status === '有效')
      state.stateVersion += 1
      state.audit.unshift({ id: `AE-${Date.now()}`, time: now(), actor: params.reviewer, action: '复核退回', target: revision.id, detail: `修订作废，原快照保留${restored ? `，锁定结论仍为 ${restored.id}` : ''}：${params.note}` })
    }
    return this.succeed(params.requestId, revision, params.approve ? '复核通过，修订生效' : '已退回，修订作废')
  }

  private requireState(): ServerState {
    if (!this.state) throw new Error('修订服务尚未初始化')
    return this.state
  }

  private chainHead(batchId: string): Revision | undefined {
    const state = this.requireState()
    return [...state.revisions].reverse().find((revision) => revision.batchId === batchId)
  }

  private invalidateChainHead(batchId: string, reason: InvalidReason, byId: string) {
    const state = this.requireState()
    for (let index = state.revisions.length - 1; index >= 0; index -= 1) {
      const revision = state.revisions[index]
      if (revision.batchId !== batchId) continue
      if (revision.status === '有效') {
        revision.status = '已失效'
        revision.invalidReason = reason
        revision.invalidatedById = byId
        return
      }
      if (revision.status === '待复核') {
        revision.status = '已失效'
        revision.invalidReason = '被新修订取代'
        revision.invalidatedById = byId
        return
      }
    }
  }

  private batchWeldIds(plans: InspectionPlan[]): string[] {
    const ids: string[] = []
    plans.forEach((plan) => plan.weldIds.forEach((id) => { if (!ids.includes(id)) ids.push(id) }))
    return ids
  }

  private buildChanges(request: ProposeRequest, parent: Revision, newQualifications: QualificationVersion[]) {
    let cursor = 0
    return request.weldIds.flatMap((weldId) => {
      const previous = parent.entries.find((entry) => entry.weldId === weldId)!
      const changes = []
      if (request.type === '焊工资质补录') {
        changes.push({ field: 'qualification', label: '焊工资质版本', weldId, before: this.qualLabel(previous.qualification), after: this.qualLabel(newQualifications[cursor]) })
        cursor += 1
      }
      if (request.type === '检测比例调整' && typeof request.ratio === 'number') {
        changes.push({ field: 'inspectionRatio', label: '检测比例', weldId, before: `${previous.inspectionRatio}%`, after: `${request.ratio}%` })
      }
      if (request.type === '复检结果更新') {
        changes.push({ field: 'status', label: '复检结果', weldId, before: previous.status, after: request.recheckStatus ?? previous.status })
        if (request.recheckNote) {
          changes.push({ field: 'repairRecord', label: '返修记录', weldId, before: `${previous.repairRecords.length} 条`, after: `${previous.repairRecords.length + 1} 条（${request.recheckNote}）` })
        }
      }
      return changes
    })
  }

  private qualLabel(qualification: QualificationVersion): string {
    return `${qualification.id} ${qualification.welder} ${qualification.standard}·${qualification.expiry}${qualification.validAtWeldTime ? '' : '（焊接时点失效）'}`
  }

  private snapshotWorking(weldId: string): RevisionEntry {
    const state = this.requireState()
    const weld = state.welds.find((item) => item.id === weldId)!
    const qualification = state.qualifications.find((item) => item.id === weld.qualificationId)
    if (!qualification) throw new Error(`焊缝 ${weldId} 缺少资质版本，旧数据必须先升级`)
    return {
      weldId,
      drawing: weld.drawing,
      component: weld.component,
      method: weld.method,
      welder: weld.welder,
      qualification: { ...qualification },
      inspectionRatio: weld.inspectionRatio,
      requiredRatio: weld.requiredRatio,
      status: weld.status,
      defects: weld.defects.map((defect) => ({ ...defect })),
      repairRecords: weld.repairRecords.map((record) => ({ ...record })),
    }
  }

  private applyEntry(entry: RevisionEntry) {
    const state = this.requireState()
    const weld = state.welds.find((item) => item.id === entry.weldId)
    if (!weld) return
    weld.qualificationId = entry.qualification.id
    weld.inspectionRatio = entry.inspectionRatio
    weld.status = entry.status
    weld.defects = entry.defects.map((defect) => ({ ...defect }))
    weld.repairRecords = entry.repairRecords.map((record) => ({ ...record }))
    weld.repairs = entry.repairRecords.length
  }

  private consumeFailure(_requestId: string): boolean {
    if (this.failNextWrite) {
      this.failNextWrite = false
      return true
    }
    return false
  }

  private fail(requestId: string, code: number, message: string): RevisionResult {
    return { ok: false, conflict: code === 409 ? message : undefined, error: code === 409 ? undefined : message, requestId, stateVersion: this.state!.stateVersion }
  }

  private failure(requestId: string, error: string): RevisionResult {
    // 失败结果不写入 results 缓存：允许同 requestId 重试，且因失败前无任何写入，重试不会重复追加
    return { ok: false, error, requestId, stateVersion: this.state!.stateVersion }
  }

  private succeed(requestId: string, revision: Revision, _message: string, qualifications: QualificationVersion[] = []): RevisionResult {
    const result: RevisionResult = { ok: true, requestId, revision, qualifications, stateVersion: this.state!.stateVersion }
    this.results.set(requestId, result)
    return { ...result }
  }

  private replay(requestId: string): RevisionResult {
    return { ...this.results.get(requestId)!, duplicated: true }
  }
}

function cloneEntry(entry: RevisionEntry): RevisionEntry {
  return {
    ...entry,
    qualification: { ...entry.qualification },
    defects: entry.defects.map((defect) => ({ ...defect })),
    repairRecords: entry.repairRecords.map((record) => ({ ...record })),
  }
}
