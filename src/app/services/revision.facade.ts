import { inject, Injectable } from '@angular/core'
import { Store } from '@ngrx/store'
import { forkJoin, of } from 'rxjs'
import { delay, map } from 'rxjs/operators'
import { WeldGraphqlService } from './weld-graphql.service'
import { DataMigrationService } from './data-migration.service'
import { RevisionServerService, type ProposeRequest, type RevisionResult } from './revision-server.service'
import type { RevisionType, WeldStatus } from '../types'
import type { WeldState } from '../store/weld.reducer'
import * as A from '../store/weld.actions'

export interface RevisionSubmission {
  type: Exclude<RevisionType, '锁定基线'>
  reason: string
  weldIds: string[]
  qualification?: { welder: string; standard: string; expiry: string; validAtWeldTime: boolean }
  ratio?: number
  recheckStatus?: WeldStatus
  recheckNote?: string
}

interface PendingWrite {
  kind: 'lock' | 'propose' | 'review'
  requestId: string
  label: string
  payload: Record<string, unknown>
}

let requestSeq = 0
const newRequestId = () => `REQ-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${String(++requestSeq).padStart(4, '0')}`

/**
 * 修订链门面：所有写入先经权威服务做版本/幂等校验，再把服务端快照同步进 NgRx。
 * 请求编号在客户端生成并随请求保留；写入失败后重试沿用同一编号，杜绝重复追加。
 */
@Injectable({ providedIn: 'root' })
export class RevisionFacade {
  private readonly store = inject(Store<{ welds: WeldState }>)
  private readonly api = inject(WeldGraphqlService)
  private readonly migration = inject(DataMigrationService)
  private readonly server = inject(RevisionServerService)
  private pending: PendingWrite | null = null
  private seeded = false

  /** 拉取旧格式 GraphQL 数据 → 旧数据升级补齐资质版本 → 播种权威服务 */
  initialize() {
    if (this.seeded) return
    this.seeded = true
    const batchId = 'B-2026-0930'
    this.api.load().subscribe(({ welds: legacyWelds, plans: legacyPlans }) => {
      const migrated = this.migration.migrate(legacyWelds, legacyPlans, batchId)
      this.server.seed({
        batchId,
        welds: migrated.welds,
        plans: migrated.plans,
        qualifications: migrated.qualifications,
        audit: [
          { id: 'AE-1', time: '16:38', actor: '赵岚', action: '提交复检', target: 'W-104', detail: '返修后 UT 复检合格，等待审核签字' },
          { id: 'AE-2', time: '15:12', actor: '陈锋', action: '录入缺陷', target: 'W-107', detail: '翼缘板端部夹渣，长度 12mm，Ⅱ级' },
          { id: 'AE-3', time: '14:20', actor: '系统', action: '资质预警', target: 'W-109', detail: '焊工证书 2026-10-01 到期，不得列入后续检测计划' },
          ...(migrated.backfilledWelderIds.length
            ? [{ id: 'AE-MIG', time: '系统升级', actor: '系统', action: '旧数据升级', target: batchId, detail: `按焊接时点有效资质为 ${migrated.backfilledWelderIds.join('、')} 补齐资质版本，返修次数展开为返修记录` }]
            : []),
        ],
      })
      const state = this.server.getState()
      this.store.dispatch(A.loadWeldsSuccess({ server: cloneState(state), migratedWelders: migrated.backfilledWelderIds }))
    })
  }

  setFailNextWrite(value: boolean) {
    this.server.failNextWrite = value
  }

  state() {
    return this.store.select('welds')
  }

  dispatch(action: ReturnType<typeof A.selectWeld> | ReturnType<typeof A.filterStatus> | ReturnType<typeof A.advanceWeld> | ReturnType<typeof A.createPlan>) {
    this.store.dispatch(action)
  }

  lock(actor: string, reason: string, requestId: string = newRequestId()) {
    const state = this.server.getState()
    const label = '签字锁定'
    this.pending = { kind: 'lock', requestId, label, payload: { actor, reason } }
    this.store.dispatch(A.writeStarted({ requestId, label }))
    this.simulateLatency(() => this.server.lock({ batchId: state.batchId, requestId, expectedVersion: state.stateVersion, actor, reason }), requestId, label)
  }

  submit(actor: string, submission: RevisionSubmission, requestId: string = newRequestId()) {
    const state = this.server.getState()
    const request: ProposeRequest = {
      batchId: state.batchId,
      requestId,
      expectedVersion: state.stateVersion,
      actor,
      type: submission.type,
      reason: submission.reason,
      weldIds: submission.weldIds,
      qualification: submission.qualification,
      ratio: submission.ratio,
      recheckStatus: submission.recheckStatus,
      recheckNote: submission.recheckNote,
    }
    const label = submission.type
    this.pending = { kind: 'propose', requestId, label, payload: { actor, submission } }
    this.store.dispatch(A.writeStarted({ requestId, label }))
    this.simulateLatency(() => this.server.propose(request), requestId, label)
  }

  review(revisionId: string, approve: boolean, reviewer: string, note: string, requestId: string = newRequestId()) {
    const state = this.server.getState()
    const label = approve ? '复核通过' : '复核退回'
    this.pending = { kind: 'review', requestId, label, payload: { revisionId, approve, reviewer, note } }
    this.store.dispatch(A.writeStarted({ requestId, label }))
    this.simulateLatency(() => this.server.review({ requestId, expectedVersion: state.stateVersion, revisionId, approve, reviewer, note }), requestId, label)
  }

  /** 失败后用同一请求编号重试：服务端没有任何失败残留，因此不会重复追加 */
  retry() {
    const pending = this.pending
    if (!pending) return
    this.store.dispatch(A.writeStarted({ requestId: pending.requestId, label: pending.label }))
    if (pending.kind === 'lock') {
      const { actor, reason } = pending.payload as { actor: string; reason: string }
      this.simulateLatency(() => this.server.lock({ batchId: this.server.getState().batchId, requestId: pending.requestId, expectedVersion: this.server.getState().stateVersion, actor, reason }), pending.requestId, pending.label)
    } else if (pending.kind === 'propose') {
      const { actor, submission } = pending.payload as { actor: string; submission: RevisionSubmission }
      const state = this.server.getState()
      this.simulateLatency(() => this.server.propose({
        batchId: state.batchId, requestId: pending.requestId, expectedVersion: state.stateVersion, actor,
        type: submission.type, reason: submission.reason, weldIds: submission.weldIds,
        qualification: submission.qualification, ratio: submission.ratio,
        recheckStatus: submission.recheckStatus, recheckNote: submission.recheckNote,
      }), pending.requestId, pending.label)
    } else {
      const { revisionId, approve, reviewer, note } = pending.payload as { revisionId: string; approve: boolean; reviewer: string; note: string }
      this.simulateLatency(() => this.server.review({ requestId: pending.requestId, expectedVersion: this.server.getState().stateVersion, revisionId, approve, reviewer, note }), pending.requestId, pending.label)
    }
  }

  clearNotice(requestId: string) {
    this.store.dispatch(A.clearWriteNotice({ requestId }))
  }

  /**
   * 两位审核人同时保存同一批次：并行发起两个 lock（不同请求编号、相同期望版本）。
   * 服务端串行裁决，先到者成立，后到者收到版本冲突。
   */
  concurrentLock(actorA: string, actorB: string) {
    const state = this.server.getState()
    const reqA = newRequestId()
    const reqB = newRequestId()
    // 两个请求带相同的期望版本；mock 服务端同步裁决：callA 先提交使版本号前进，
    // callB 的乐观版本检查随即失败。真实环境下由数据库行锁/版本号得到相同结论。
    const callA = this.server.lock({ batchId: state.batchId, requestId: reqA, expectedVersion: state.stateVersion, actor: actorA, reason: '并发保存演示（审核人甲）' })
    const callB = this.server.lock({ batchId: state.batchId, requestId: reqB, expectedVersion: state.stateVersion, actor: actorB, reason: '并发保存演示（审核人乙）' })
    forkJoin({ a: of(callA).pipe(delay(220)), b: of(callB).pipe(delay(220)) }).subscribe(({ a, b }) => {
      this.dispatchResult(a, '签字锁定·甲')
      if (b.ok) this.dispatchResult(b, '签字锁定·乙')
      else this.store.dispatch(A.writeConflict({ requestId: reqB, message: `${b.conflict ?? b.error}；审核人甲的保存已成立（${a.revision?.id ?? '已锁定'}），同批次锁定只生效一次` }))
    })
  }

  private simulateLatency(invoke: () => RevisionResult, requestId: string, label: string) {
    of(null).pipe(delay(260), map(() => invoke())).subscribe((result) => this.dispatchResult(result, label, requestId))
  }

  private dispatchResult(result: RevisionResult, label: string, requestId = result.requestId) {
    const state = this.server.getState()
    if (result.ok) {
      this.pending = null
      this.store.dispatch(A.writeSucceeded({
        requestId,
        label,
        message: `${label}成功 · ${result.revision?.id ?? ''} · 请求编号 ${requestId}`,
        duplicated: !!result.duplicated,
        server: cloneState(state),
      }))
    } else if (result.conflict) {
      this.pending = null
      this.store.dispatch(A.writeConflict({ requestId, message: result.conflict }))
    } else {
      // 失败：保留 pending（原请求编号），等待用户重试
      this.store.dispatch(A.writeFailed({ requestId, error: result.error ?? '写入失败', label }))
    }
  }
}

function cloneState(state: ReturnType<RevisionServerService['getState']>) {
  return {
    batchId: state.batchId,
    welds: state.welds.map((weld) => ({ ...weld, defects: [...weld.defects], repairRecords: [...weld.repairRecords] })),
    plans: state.plans.map((plan) => ({ ...plan, weldIds: [...plan.weldIds] })),
    qualifications: state.qualifications.map((qualification) => ({ ...qualification })),
    revisions: state.revisions.map((revision) => ({
      ...revision,
      planIds: [...revision.planIds],
      changes: revision.changes.map((change) => ({ ...change })),
      entries: revision.entries.map((entry) => ({
        ...entry,
        qualification: { ...entry.qualification },
        defects: entry.defects.map((defect) => ({ ...defect })),
        repairRecords: entry.repairRecords.map((record) => ({ ...record })),
      })),
    })),
    audit: state.audit.map((event) => ({ ...event })),
    stateVersion: state.stateVersion,
  }
}
