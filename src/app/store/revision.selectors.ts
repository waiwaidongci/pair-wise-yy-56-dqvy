import { Injectable } from '@angular/core'
import type {
  BatchStatus,
  InspectionPlan,
  InvalidReason,
  Revision,
  RevisionEntry,
  Weld,
} from '../types'
import type { WeldState } from './weld.reducer'

export interface RevisionWeldView {
  weld: Weld
  /** 当前修订（链头）；无修订时为 null */
  revision: Revision | null
  /** 当前修订下该焊缝的固化条目；无修订时为 null */
  entry: RevisionEntry | null
  /** 该焊缝是否有待复核变更 */
  pending: boolean
  /** 该焊缝当前失效原因（原锁定结论已失效时给出原因） */
  invalidReason: InvalidReason | null
}

@Injectable({ providedIn: 'root' })
export class RevisionSelectors {
  /** 修订链链头：最后创建的修订（可能待复核或已失效） */
  headRevision(state: WeldState): Revision | null {
    return state.revisions.length ? state.revisions[state.revisions.length - 1] : null
  }

  effectiveRevision(state: WeldState): Revision | null {
    return [...state.revisions].reverse().find((revision) => revision.status === '有效') ?? null
  }

  pendingRevision(state: WeldState): Revision | null {
    return state.revisions.find((revision) => revision.status === '待复核') ?? null
  }

  batchStatus(state: WeldState): BatchStatus {
    const head = this.headRevision(state)
    if (!head) return '未锁定'
    if (head.status === '待复核') return '修订待复核'
    if (head.status === '有效') return '已签字锁定'
    // 链头已失效：若存在更老的有效修订，说明当前锁定结论因复核退回而恢复
    return this.effectiveRevision(state) ? '已签字锁定' : '原锁定已失效'
  }

  /** 原锁定结论的失效原因：优先展示待复核修订造成的失效 */
  invalidReason(state: WeldState): InvalidReason | null {
    const head = this.headRevision(state)
    if (!head) return null
    if (head.status === '待复核') {
      const invalidated = state.revisions.find((revision) => revision.invalidatedById === head.id && revision.status === '已失效')
      return invalidated?.invalidReason ?? head.type as InvalidReason
    }
    if (head.status === '已失效') return head.invalidReason
    return null
  }

  chain(state: WeldState): Revision[] {
    return [...state.revisions].sort((a, b) => b.serial - a.serial)
  }

  pendingWeldIds(revision: Revision | null): string[] {
    if (!revision || revision.status !== '待复核') return []
    return revision.changes.map((change) => change.weldId).filter((id, index, all) => all.indexOf(id) === index)
  }

  viewFor(state: WeldState): RevisionWeldView[] {
    const pending = this.pendingRevision(state)
    const effective = this.effectiveRevision(state)
    const pendingIds = this.pendingWeldIds(pending)
    const batchInvalidReason = this.invalidReason(state)
    return state.welds.map((weld) => {
      // 待复核期间展示待生效值；一旦退回（链头已失效），回落展示有效锁定值
      const source = pending ?? effective
      const entry = source?.entries.find((item) => item.weldId === weld.id) ?? null
      const affectedByPending = pendingIds.includes(weld.id)
      return {
        weld,
        revision: source,
        entry,
        pending: affectedByPending,
        // 待复核修订涉及的焊缝标注原锁定失效原因；其余焊缝不受影响
        invalidReason: affectedByPending ? batchInvalidReason : null,
      }
    })
  }

  planView(state: WeldState): (InspectionPlan & { currentRevisionId: string | null; invalidReason: string | null })[] {
    // 只有待复核修订会使原锁定结论失效；复核退回后计划仍归属有效修订
    const pending = this.pendingRevision(state)
    const effective = this.effectiveRevision(state)
    const current = pending ?? effective
    const reason = pending ? this.invalidReason(state) : null
    return state.plans.map((plan) => ({
      ...plan,
      currentRevisionId: current?.id ?? plan.lockedInRevisionId ?? null,
      invalidReason: pending && plan.lockedInRevisionId && pending.id !== plan.lockedInRevisionId ? reason : null,
    }))
  }

  /** 某条焊缝在当前修订下应显示的资质版本文本 */
  qualificationLabel(state: WeldState, weld: Weld): string {
    const head = this.headRevision(state)
    const source = head && head.status === '待复核' ? head : this.effectiveRevision(state)
    const entry = source?.entries.find((item) => item.weldId === weld.id)
    const qualification = entry?.qualification ?? state.qualifications.find((item) => item.id === weld.qualificationId)
    return qualification
      ? `${qualification.id} · ${qualification.standard}·${qualification.expiry}${qualification.validAtWeldTime ? '' : '（焊接时点失效）'}`
      : '未绑定资质版本'
  }
}
