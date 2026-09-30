import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { RevisionFacade } from '../services/revision.facade'
import { RevisionSelectors } from '../store/revision.selectors'
import type { WeldState } from '../store/weld.reducer'

/**
 * 修订链统一横幅：总览 / 焊缝地图 / 检测返修 / 审核锁定四页复用，
 * 始终展示当前修订（链头）、批次状态与原锁定失效原因；
 * 写入失败时保留请求编号并提供“同编号重试”。
 */
@Component({
  selector: 'app-revision-banner',
  standalone: true,
  imports: [CommonModule, ButtonModule, TagModule],
  template: `
    <section class="rev-banner" *ngIf="state as s" [class.pending]="batchStatus === '修订待复核'" [class.invalid]="batchStatus === '原锁定已失效'" [class.locked]="batchStatus === '已签字锁定'">
      <div class="rev-main">
        <span class="rev-icon"><i class="pi" [class.pi-lock]="batchStatus === '已签字锁定'" [class.pi-spin]="notice?.kind === 'pending'" [class.pi-spinner-dotted]="notice?.kind === 'pending'" [class.pi-exclamation-triangle]="batchStatus === '修订待复核' || batchStatus === '原锁定已失效'" [class.pi-pencil]="batchStatus === '未锁定'"></i></span>
        <div class="rev-text">
          <div class="rev-line">
            <b>批次 {{s.batchId || '—'}}</b>
            <p-tag [value]="batchStatus" [severity]="severity" [styleClass]="'rev-tag'" />
            <ng-container *ngIf="head as revision">
              <span class="rev-id">{{revision.id}} · {{revision.type}}</span>
              <span class="rev-version">工作版本 v{{s.stateVersion}}</span>
            </ng-container>
            <span class="rev-version" *ngIf="!head">尚未锁定 · 工作版本 v{{s.stateVersion}}</span>
          </div>
          <p class="rev-detail" *ngIf="head as revision">
            基于
            <b>{{revision.parentId ?? '基线'}}</b>
            由 {{revision.actor}} 于 {{revision.time}} 提出
            <ng-container *ngIf="revision.status === '待复核'">，待 {{revision.planIds.join('、')}} 复核</ng-container>
            <ng-container *ngIf="revision.status === '有效' && revision.reviewer">，{{revision.reviewer}} {{revision.reviewedTime}} 复核锁定</ng-container>
            <ng-container *ngIf="revision.status === '已失效'">，已失效</ng-container>
            ；固化 {{revision.entries.length}} 条焊缝
          </p>
          <p class="rev-reason" *ngIf="invalidReason">
            <i class="pi pi-arrow-circle-up"></i>原锁定结论失效原因：<b>{{invalidReason}}</b>
            <ng-container *ngIf="head?.status === '待复核'"> —— 已退回复核，原只读快照保留不变</ng-container>
            <span class="rev-note" *ngIf="head?.reason">（{{head?.reason}}）</span>
          </p>
        </div>
      </div>
      <div class="rev-notice" *ngIf="s.notice as notice" [class]="'notice-' + notice.kind">
        <i class="pi" [class.pi-check-circle]="notice.kind === 'success'" [class.pi-info-circle]="notice.kind === 'pending'" [class.pi-ban]="notice.kind === 'conflict'" [class.pi-times-circle]="notice.kind === 'failure'"></i>
        <div>
          <b>{{notice.label}}</b>
          <p>{{notice.message}}</p>
        </div>
        <p-button *ngIf="notice.retryable" label="用原请求编号重试" icon="pi pi-refresh" size="small" severity="warn" (onClick)="facade.retry()" />
        <button class="notice-close" (click)="facade.clearNotice(notice.requestId)"><i class="pi pi-times"></i></button>
      </div>
    </section>
  `,
  styles: [`
    .rev-banner{display:flex;justify-content:space-between;gap:14px;align-items:center;background:#f8fafc;border:1px solid #e1e7ef;border-left:4px solid #2563eb;border-radius:8px;padding:12px 16px;margin-bottom:16px;flex-wrap:wrap}
    .rev-banner.locked{border-left-color:#16a34a}
    .rev-banner.pending{border-left-color:#d97706;background:#fffbeb}
    .rev-banner.invalid{border-left-color:#dc2626;background:#fef2f2}
    .rev-main{display:flex;gap:12px;align-items:flex-start;min-width:0}
    .rev-icon{display:grid;place-items:center;width:34px;height:34px;border-radius:7px;background:#e8eefc;color:#2563eb;font-size:16px}
    .locked .rev-icon{background:#dcfce7;color:#16a34a}
    .pending .rev-icon,.invalid .rev-icon{background:#fef3c7;color:#b45309}
    .rev-line{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
    .rev-line b{font-size:15px}
    .rev-id{font-weight:700;color:#1d4ed8}
    .rev-version{color:#7a8798;font-size:12px;border:1px solid #e1e7ef;border-radius:20px;padding:2px 9px;background:#fff}
    .rev-detail{margin:5px 0 0;font-size:13px;color:#667085}
    .rev-detail b{color:#334155}
    .rev-reason{margin:4px 0 0;font-size:13px;color:#b91c1c}
    .rev-reason .rev-note{color:#b45309}
    .rev-notice{display:flex;gap:9px;align-items:flex-start;background:#fff;border:1px solid #e1e7ef;border-radius:7px;padding:9px 12px;max-width:430px}
    .rev-notice>i{margin-top:2px}
    .rev-notice b{font-size:13px}
    .rev-notice p{margin:2px 0 0;font-size:12.5px;color:#667085}
    .notice-success{border-color:#86efac}.notice-success>i{color:#16a34a}
    .notice-conflict{border-color:#fca5a5;background:#fef2f2}.notice-conflict>i{color:#dc2626}
    .notice-failure{border-color:#fca5a5;background:#fef2f2}.notice-failure>i{color:#dc2626}
    .notice-pending>i{color:#2563eb}
    .rev-notice .p-button{margin-left:4px}
    .notice-close{border:none;background:none;color:#94a3b8;cursor:pointer;padding:2px}
    @media(max-width:900px){.rev-banner{flex-direction:column;align-items:stretch}.rev-notice{max-width:none}}
  `],
})
export class RevisionBannerComponent {
  readonly facade = inject(RevisionFacade)
  private readonly selectors = inject(RevisionSelectors)
  state: WeldState | null = null

  constructor() {
    this.facade.state().subscribe((state) => (this.state = state))
  }

  get head() { return this.state ? this.selectors.headRevision(this.state) : null }
  get batchStatus() { return this.state ? this.selectors.batchStatus(this.state) : '未锁定' }
  get invalidReason() { return this.state ? this.selectors.invalidReason(this.state) : null }
  get notice() { return this.state?.notice ?? null }
  get severity() {
    switch (this.batchStatus) {
      case '已签字锁定': return 'success'
      case '修订待复核': return 'warn'
      case '原锁定已失效': return 'danger'
      default: return 'info'
    }
  }
}
