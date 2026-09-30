import { Component, Input } from '@angular/core'
import { CommonModule } from '@angular/common'
import { TagModule } from 'primeng/tag'
import type { WeldState } from '../store/weld.reducer'

/**
 * 修订链状态条：总览、焊缝地图、检测返修、审核锁定均展示
 * 当前修订版本与原锁定结论失效原因。
 */
@Component({
  selector: 'app-revision-banner',
  standalone: true,
  imports: [CommonModule, TagModule],
  template: `
    <div class="rev-banner" [class.invalid]="invalid" [class.locked]="locked && !invalid">
      <div class="rev-row">
        <span class="rev-label">当前修订</span>
        <b class="rev-version">v{{ state.version }}</b>
        <p-tag *ngIf="!locked" value="未锁定 · 工作版本可编辑" severity="info" />
        <p-tag *ngIf="locked && !invalid" value="已签字锁定 · 快照有效" severity="success" />
        <p-tag *ngIf="invalid" value="原锁定结论已失效 · 退回复核" severity="danger" />
        <span class="spacer"></span>
        <span class="req" *ngIf="state.lastRequestNo">最近请求编号：<code>{{ state.lastRequestNo }}</code></span>
      </div>
      <div class="rev-meta" *ngIf="locked && !invalid && snapshot">
        锁定快照 {{ snapshot.id }}（请求编号 {{ snapshot.requestNo }}）：已固定 {{ snapshot.welds.length }} 条焊缝的资质版本、检测比例、缺陷与返修记录，补录/复检将生成待复核修订。
      </div>
      <div class="rev-reason" *ngIf="invalid">
        <i class="pi pi-exclamation-triangle"></i>
        <span><b>失效原因：</b>{{ invalidReason }}</span>
      </div>
      <div class="rev-error" *ngIf="state.writeError">
        <i class="pi pi-times-circle"></i>
        <span>{{ state.writeError }}</span>
      </div>
      <div class="rev-conflict" *ngIf="state.conflict">
        <i class="pi pi-exclamation-circle"></i>
        <span>版本冲突：后到保存基于过期版本，批次保存不成立（只成立一次）。</span>
      </div>
      <div class="rev-idem" *ngIf="state.idempotentHit">
        <i class="pi pi-check-circle"></i>
        <span>重复请求已按幂等处理，未追加记录。</span>
      </div>
    </div>
  `,
  styles: [
    `.rev-banner{margin-bottom:16px;border:1px solid #c7d7ee;border-left:4px solid #2563eb;border-radius:8px;background:#f5f8ff;padding:12px 14px}`,
    `.rev-banner.locked{border-color:#bbf7d0;border-left-color:#16a34a;background:#f0fdf4}`,
    `.rev-banner.invalid{border-color:#fecaca;border-left-color:#dc2626;background:#fef2f2}`,
    `.rev-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}`,
    `.rev-label{font-size:12px;color:#667085;font-weight:600}`,
    `.rev-version{font-size:16px;color:#182230}`,
    `.spacer{flex:1}`,
    `.req{font-size:12px;color:#667085}`,
    `.req code{background:#fff;border:1px solid #e1e7ef;border-radius:4px;padding:1px 6px;font-size:12px;color:#334155}`,
    `.rev-meta{margin-top:8px;font-size:13px;color:#475467}`,
    `.rev-reason{display:flex;gap:8px;align-items:flex-start;margin-top:8px;font-size:13px;color:#b91c1c}`,
    `.rev-error{display:flex;gap:8px;align-items:flex-start;margin-top:8px;font-size:13px;color:#b91c1c}`,
    `.rev-conflict{display:flex;gap:8px;align-items:flex-start;margin-top:8px;font-size:13px;color:#b45309}`,
    `.rev-idem{display:flex;gap:8px;align-items:flex-start;margin-top:8px;font-size:13px;color:#15803d}`,
  ],
})
export class RevisionBannerComponent {
  @Input() state!: WeldState
  get locked() { return !!this.state?.locked }
  get invalid() { return this.state?.lockSnapshot?.state === '已失效' }
  get invalidReason() { return this.state?.lockSnapshot?.invalidReason ?? '' }
  get snapshot() { return this.state?.lockSnapshot ?? null }
}
