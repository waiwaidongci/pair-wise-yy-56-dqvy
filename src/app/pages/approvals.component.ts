import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { TimelineModule } from 'primeng/timeline'
import { TagModule } from 'primeng/tag'
import { CheckboxModule } from 'primeng/checkbox'
import { RevisionFacade } from '../services/revision.facade'
import { RevisionSelectors } from '../store/revision.selectors'
import { RevisionBannerComponent } from '../components/revision-banner.component'
import { RevisionServerService } from '../services/revision-server.service'
import type { WeldState } from '../store/weld.reducer'
import * as A from '../store/weld.actions'
import type { Revision } from '../types'

@Component({
  selector:'app-approvals', standalone:true, imports:[CommonModule,FormsModule,ButtonModule,TimelineModule,TagModule,CheckboxModule,RevisionBannerComponent],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">签字、版本与追溯</p><h1>逐段确认与锁定</h1><p>锁定固化计划内每条焊缝的资质版本、检测比例、缺陷与返修记录；补录、调比、复检只生成待复核修订，不改原快照。</p></div>
      <div class="head-actions"><label class="fail-switch"><p-checkbox [ngModel]="failNext" (ngModelChange)="toggleFail($event)" [binary]="true" inputId="failNext" /><span>模拟下一次写入失败</span></label>
        <p-button label="并发双保存（甲乙同时签字）" icon="pi pi-users" severity="secondary" (onClick)="concurrent()" />
        <p-button [label]="batchStatus === '已签字锁定' ? '已锁定，可发起修订' : '签字锁定检测批次'" icon="pi pi-lock" [severity]="batchStatus === '已签字锁定' ? 'success' : 'primary'" [disabled]="!!pending || notice?.kind === 'pending'" (onClick)="lock()" />
      </div></div>
      <app-revision-banner />

      <div class="grid-2">
        <section class="card"><h2 class="panel-title">待复核修订队列</h2>
          <p class="empty" *ngIf="!pending">当前没有待复核修订。<ng-container *ngIf="!head">质量负责人可对批次 {{state.batchId}} 签字锁定；锁定快照将固化 {{state.welds.length}} 条计划内焊缝。</ng-container><ng-container *ngIf="head">原锁定结论有效，焊工资质补录 / 检测比例调整 / 复检结果更新将在此排队复核。</ng-container></p>
          <div class="pending-card" *ngIf="pending as revision">
            <div class="pending-head"><div><b>{{revision.id}} · {{revision.type}}</b><small>请求编号 {{revision.requestId}} · 基于 {{revision.parentId}} · {{revision.time}} · {{revision.actor}} 提交</small></div><p-tag value="待复核" severity="warn" /></div>
            <p class="reason">{{revision.reason}}</p>
            <table class="change-table"><thead><tr><th>焊缝</th><th>变更项</th><th>原值（原快照）</th><th>修订后值</th></tr></thead><tbody><tr *ngFor="let change of revision.changes"><td>{{change.weldId}}</td><td>{{change.label}}</td><td class="old">{{change.before}}</td><td class="new">{{change.after}}</td></tr></tbody></table>
            <div class="review-actions"><input class="note-input" [(ngModel)]="reviewNote" placeholder="复核意见（可留空）" /><p-button label="复核退回（修订作废，原快照保留）" severity="danger" variant="outlined" (onClick)="review(false)" /><p-button label="复核通过（修订生效）" icon="pi pi-check" (onClick)="review(true)" /></div>
          </div>
          <h2 class="panel-title sub">待处理焊缝状态</h2>
          <div class="review" *ngFor="let view of reviewViews"><div><b>{{view.weld.id}} · {{view.weld.component}}</b><small>{{view.weld.method}} · {{view.weld.welder}} · 返修 {{view.weld.repairs}} 次</small></div><p-tag [value]="view.weld.status" [severity]="view.weld.status === '待复检' ? 'warn' : 'danger'" /><p-button label="要求复检" severity="danger" text size="small" (onClick)="requestRecheck(view.weld.id)" /><p-button label="确认合格" size="small" (onClick)="confirm(view.weld.id)" /></div>
        </section>

        <aside class="card"><h2 class="panel-title">完整审计时间线</h2><p-timeline [value]="state.audit" align="left"><ng-template #content let-event><div class="audit" [class.audit-migration]="event.action === '旧数据升级'"><div><b>{{event.actor}} · {{event.action}}</b><span>{{event.time}}</span></div><p><strong>{{event.target}}</strong> {{event.detail}}</p></div></ng-template></p-timeline></aside>
      </div>

      <section class="card mt-4"><h2 class="panel-title">修订链与只读快照 <small class="chain-sub">任一历史快照均可追溯，永不被覆盖</small></h2>
        <div class="revision-row" *ngFor="let revision of chain" [class.rev-active]="revision.status === '有效'" [class.rev-pending]="revision.status === '待复核'" [class.rev-dead]="revision.status === '已失效'">
          <div class="rev-dot"><i class="pi" [class.pi-lock]="revision.type === '锁定基线'" [class.pi-id-card]="revision.type === '焊工资质补录'" [class.pi-sliders-h]="revision.type === '检测比例调整'" [class.pi-refresh]="revision.type === '复检结果更新'"></i></div>
          <div class="rev-body"><div class="rev-row-head"><b>{{revision.id}} · {{revision.type}}</b><p-tag [value]="revision.status" [severity]="revision.status === '有效' ? 'success' : revision.status === '待复核' ? 'warn' : 'secondary'" /><span class="rev-meta">{{revision.actor}} · {{revision.time}} · 请求 {{revision.requestId}}</span></div>
            <p class="rev-parent">父修订：{{revision.parentId ?? '—（锁定基线）'}} · 固化焊缝 {{revision.entries.length}} 条 · 计划 {{revision.planIds.join('、')}}</p>
            <p class="rev-invalid" *ngIf="revision.invalidReason"><i class="pi pi-undo"></i>失效原因：<b>{{revision.invalidReason}}</b><ng-container *ngIf="revision.invalidatedById">（由 {{revision.invalidatedById}} 取代/退回）</ng-container><ng-container *ngIf="revision.reviewNote"> · 复核意见：{{revision.reviewNote}}（{{revision.reviewer}}）</ng-container></p>
            <div class="snapshot-grid"><div class="snap-entry" *ngFor="let entry of revision.entries"><b>{{entry.weldId}}</b><small>{{entry.qualification.id}} · {{entry.qualification.standard}}·{{entry.qualification.expiry}}<span [class.danger]="!entry.qualification.validAtWeldTime">（焊接时点{{entry.qualification.validAtWeldTime ? '有效' : '失效'}}）</span></small><small>比例 {{entry.inspectionRatio}}%/{{entry.requiredRatio}}% · {{entry.status}} · 缺陷 {{entry.defects.length}} · 返修 {{entry.repairRecords.length}}</small></div></div>
          </div>
        </div>
      </section>
    </main>
  `,
  styles:[`.head-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end}.fail-switch{display:flex;align-items:center;gap:7px;font-size:13px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:7px 10px}.empty{color:#7a8798;font-size:13.5px;background:#f8fafc;border-radius:6px;padding:12px}.pending-card{border:1px solid #fde68a;background:#fffbeb;border-radius:8px;padding:13px;margin-bottom:16px}.pending-head{display:flex;justify-content:space-between;gap:10px}.pending-head small{display:block;color:#92400e;margin-top:3px;font-size:12px}.reason{margin:9px 0;font-size:13.5px}.change-table{width:100%;border-collapse:collapse;font-size:12.5px;background:#fff;border-radius:6px;overflow:hidden}.change-table th,.change-table td{border:1px solid #f1e4b8;padding:6px 9px;text-align:left}.change-table .old{color:#b91c1c}.change-table .new{color:#15803d;font-weight:700}.review-actions{display:flex;gap:8px;align-items:center;margin-top:11px;flex-wrap:wrap}.note-input{flex:1;min-width:180px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px}.review{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:12px 0;border-bottom:1px solid #edf0f5}.review b,.review small{display:block}.review small{color:#7a8798;margin-top:4px}.sub{margin-top:18px}.audit{background:#fff;border:1px solid #e1e7ef;border-radius:6px;padding:10px}.audit-migration{border-left:3px solid #2563eb}.audit>div{display:flex;justify-content:space-between}.audit span{color:#7a8798;font-size:12px}.audit p{margin:5px 0 0;font-size:13px}.chain-sub{font-size:12.5px;font-weight:400;color:#7a8798}.revision-row{display:flex;gap:12px;padding:14px 0;border-bottom:1px solid #edf0f5}.rev-dot{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;flex:none;background:#eef2ff;color:#4f46e5}.rev-active .rev-dot{background:#dcfce7;color:#16a34a}.rev-pending .rev-dot{background:#fef3c7;color:#b45309}.rev-dead .rev-dot{background:#f1f5f9;color:#94a3b8}.rev-body{flex:1;min-width:0}.rev-row-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.rev-meta{color:#94a3b8;font-size:12px}.rev-parent{margin:5px 0 3px;font-size:13px;color:#667085}.rev-invalid{margin:0 0 9px;font-size:13px;color:#b91c1c}.rev-invalid i{margin-right:3px}.snapshot-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px}.snap-entry{border:1px solid #e1e7ef;border-radius:6px;padding:8px 10px;background:#f8fafc}.snap-entry b{font-size:13px}.snap-entry small{display:block;color:#667085;font-size:11.5px;margin-top:2px}.danger{color:#dc2626}.mt-4{margin-top:16px}@media(max-width:760px){.review{grid-template-columns:1fr auto}.review .p-button{width:100%}}`],
})
export class ApprovalsComponent {
  private readonly facade = inject(RevisionFacade)
  private readonly selectors = inject(RevisionSelectors)
  private readonly server = inject(RevisionServerService)
  state!: WeldState
  reviewNote = ''
  failNext = false

  constructor() {
    this.facade.initialize()
    this.facade.state().subscribe((state) => this.state = state)
  }

  get head(): Revision | null { return this.state ? this.selectors.headRevision(this.state) : null }
  get pending(): Revision | null { return this.state ? this.selectors.pendingRevision(this.state) : null }
  get chain() { return this.state ? this.selectors.chain(this.state) : [] }
  get batchStatus() { return this.state ? this.selectors.batchStatus(this.state) : '未锁定' }
  get notice() { return this.state?.notice ?? null }
  get reviewViews() { return (this.state?.welds ?? []).filter((item) => ['待复检','返修中','待检测'].includes(item.status)).map((weld) => ({ weld })) }

  toggleFail(checked: boolean) {
    this.failNext = checked
    this.facade.setFailNextWrite(checked)
  }

  lock() {
    this.failNext = false
    this.facade.lock('周质量负责人', '焊工资质、检测比例与返修闭环已确认，固化计划内全部焊缝')
  }

  concurrent() {
    this.failNext = false
    this.facade.concurrentLock('审核人甲·周质量负责人', '审核人乙·周质量负责人')
  }

  review(approve: boolean) {
    if (!this.pending) return
    this.failNext = false
    this.facade.review(this.pending.id, approve, '周质量负责人', this.reviewNote || (approve ? '复核通过' : '复核退回，要求补充材料'))
    this.reviewNote = ''
  }

  confirm(id: string) {
    if (this.head) this.facade.submit('周质量负责人', { type: '复检结果更新', reason: `${id} 审核确认合格`, weldIds: [id], recheckStatus: '合格', recheckNote: '审核确认合格' })
    else this.facade.dispatch(A.advanceWeld({ id, status:'合格' }))
  }

  requestRecheck(id: string) {
    if (this.head) this.facade.submit('周质量负责人', { type: '复检结果更新', reason: `${id} 质量负责人要求复检`, weldIds: [id], recheckStatus: '待复检' })
    else this.facade.dispatch(A.advanceWeld({ id, status:'待复检' }))
  }
}
