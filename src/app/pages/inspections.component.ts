import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { TextareaModule } from 'primeng/textarea'
import { SelectButtonModule } from 'primeng/selectbutton'
import { RevisionFacade } from '../services/revision.facade'
import { RevisionSelectors, type RevisionWeldView } from '../store/revision.selectors'
import { RevisionBannerComponent } from '../components/revision-banner.component'
import type { WeldState } from '../store/weld.reducer'
import * as A from '../store/weld.actions'
import type { Defect, WeldStatus } from '../types'

@Component({
  selector:'app-inspections', standalone:true, imports:[CommonModule,FormsModule,TableModule,TagModule,ButtonModule,DialogModule,InputTextModule,TextareaModule,SelectButtonModule,RevisionBannerComponent],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">NDT / 返修闭环</p><h1>检测计划与返修</h1><p>检测结果绑定缺陷位置、等级、报告和返修方案；锁定后的复检只生成待复核修订，原快照不可无痕跳过。</p></div><p-button label="新增检测结果" icon="pi pi-plus" (onClick)="dialog = true" /></div>
      <app-revision-banner />
      <div class="grid-2"><section class="card"><h2 class="panel-title">批量检测计划 · 修订链归属</h2><p-table [value]="planViews" [paginator]="true" [rows]="6"><ng-template #header><tr><th>计划编号</th><th>日期</th><th>方法</th><th>焊缝</th><th>当前修订 / 失效</th><th>状态</th></tr></ng-template><ng-template #body let-plan><tr><td>{{plan.id}}</td><td>{{plan.date}}</td><td>{{plan.method}}</td><td>{{plan.weldIds.length}} 条</td><td><span class="mono">{{plan.currentRevisionId ?? '未锁定'}}</span><small class="block danger" *ngIf="plan.invalidReason">原结论失效：{{plan.invalidReason}}</small><small class="block muted" *ngIf="!plan.invalidReason && plan.lockedInRevisionId">快照 {{plan.lockedInRevisionId}} 只读</small></td><td><p-tag [value]="plan.state" [severity]="plan.state === '已完成' ? 'success' : plan.state === '执行中' ? 'info' : 'warn'" /></td></tr></ng-template></p-table><p-button label="开始执行计划" icon="pi pi-play" styleClass="mt-3" /></section>
      <aside class="card"><h2 class="panel-title">返修状态流转</h2><div class="step" *ngFor="let view of repairViews" [class.row-pending]="view.pending"><div><b>{{view.weld.id}} · {{view.weld.component}}</b><small>{{(view.entry?.defects ?? view.weld.defects).length}} 个缺陷 · 返修记录 {{(view.entry?.repairRecords ?? view.weld.repairRecords).length}} 条</small><div class="rev-chip" *ngIf="view.pending"><i class="pi pi-hourglass"></i>{{head?.id}} 待复核 · {{invalidReason}}</div></div><p-tag [value]="view.entry?.status ?? view.weld.status" severity="warn" /><p-selectbutton [options]="['返修中','待复检','合格']" [ngModel]="view.entry?.status ?? view.weld.status" (ngModelChange)="advance(view.weld.id,$event)" /></div><p class="chain-tip"><i class="pi pi-save"></i>未锁定时直接流转；已锁定后任何复检结果都生成待复核修订并作废原锁定结论。</p></aside></div>
      <section class="card mt-4"><h2 class="panel-title">检测结果、缺陷与复检更新</h2><p-table [value]="defectRows" [paginator]="true" [rows]="8"><ng-template #header><tr><th>缺陷编号</th><th>焊缝 / 当前修订</th><th>位置 / 长度</th><th>类型 / 等级</th><th>报告</th><th>复检处置</th></tr></ng-template><ng-template #body let-row><tr [class.row-pending]="row.view.pending"><td>{{row.defect.id}}</td><td>{{row.view.weld.id}}<small class="block mono">{{row.view.revision?.id ?? '未锁定'}}</small><div class="rev-chip" *ngIf="row.view.pending">失效：{{invalidReason}}</div></td><td>{{row.defect.position}}% · {{row.defect.length}}mm</td><td>{{row.defect.type}} · {{row.defect.level}}</td><td>{{row.defect.report}}</td><td><p-button label="退回方案" severity="danger" size="small" text /><p-button label="复检合格更新" icon="pi pi-refresh" size="small" [loading]="false" (onClick)="recheckPass(row.view.weld.id)" /></td></tr></ng-template></p-table></section>
      <p-dialog header="录入检测结果" [(visible)]="dialog" [modal]="true" [style]="{width:'620px'}"><div class="form"><label>焊缝编号</label><input pInputText [(ngModel)]="form.weldId" /><label>检测方法</label><select [(ngModel)]="form.method"><option>UT</option><option>MT</option><option>PT</option></select><label>缺陷位置（0–100%）</label><input pInputText type="number" [(ngModel)]="form.position" /><label>缺陷类型与等级</label><input pInputText [(ngModel)]="form.type" placeholder="如：未熔合 / Ⅲ级" /><label>报告编号与说明</label><textarea pTextarea [(ngModel)]="form.report" rows="4"></textarea><p class="form-note">该结果将作为下一次锁定快照的输入；若批次已锁定，需在审核页以复检修订形式提交。</p></div><ng-template #footer><p-button label="取消" severity="secondary" (onClick)="dialog=false" /><p-button label="提交结果" [disabled]="!form.weldId || !form.report" (onClick)="submit()" /></ng-template></p-dialog>
    </main>
  `,
  styles:[`.step{display:grid;grid-template-columns:1fr auto;gap:9px;padding:12px 0;border-bottom:1px solid #edf0f5}.step>div,.step small{display:block}.step small{color:#7a8798;margin-top:4px}.step p-selectbutton{grid-column:1/-1}.row-pending{background:#fffbeb}.rev-chip{display:inline-flex;align-items:center;gap:4px;margin-top:5px;font-size:11.5px;color:#b45309;background:#fef3c7;border-radius:4px;padding:1px 7px}.mono{font-weight:700;color:#1d4ed8}.block{display:block;margin-top:3px}.muted{color:#94a3b8}.form{display:grid;gap:9px}.form input,.form select,.form textarea{padding:9px;border:1px solid #cbd5e1;border-radius:6px;width:100%}.form-note{font-size:12.5px;color:#667085;margin:2px 0}.mt-3{margin-top:12px}.mt-4{margin-top:16px}.chain-tip{display:flex;gap:8px;align-items:flex-start;margin:12px 0 0;font-size:13px;color:#667085;background:#f8fafc;border-radius:6px;padding:10px}.chain-tip i{color:#2563eb}`],
})
export class InspectionsComponent {
  private readonly facade = inject(RevisionFacade)
  private readonly selectors = inject(RevisionSelectors)
  state!: WeldState
  dialog = false
  form = { weldId:'W-109', method:'UT', position:42, type:'未熔合 / Ⅲ级', report:'UT-2026-0929-08；按 NB/T 47013.3 评定。' }

  constructor() {
    this.facade.initialize()
    this.facade.state().subscribe((state) => this.state = state)
  }

  get views() { return this.state ? this.selectors.viewFor(this.state) : [] }
  get repairViews() { return this.views.filter((view) => ['返修中','待复检'].includes(view.entry?.status ?? view.weld.status)) }
  get defectRows(): { view: RevisionWeldView; defect: Defect }[] {
    return this.views.flatMap((view) => (view.entry?.defects ?? view.weld.defects).map((defect) => ({ view, defect })))
  }
  get planViews() { return this.state ? this.selectors.planView(this.state) : [] }
  get head() { return this.state ? this.selectors.headRevision(this.state) : null }
  get invalidReason() { return this.state ? this.selectors.invalidReason(this.state) : null }

  advance(id: string, status: string) {
    const locked = this.head !== null
    if (!locked) {
      this.facade.dispatch(A.advanceWeld({ id, status: status as WeldStatus }))
      return
    }
    if (status === '合格') {
      this.facade.submit('赵岚', { type: '复检结果更新', reason: `${id} 返修后复检合格，更新复检结果并追加返修记录`, weldIds: [id], recheckStatus: '合格', recheckNote: '复检合格' })
    } else {
      this.facade.submit('赵岚', { type: '复检结果更新', reason: `${id} 复检结果更新为 ${status}`, weldIds: [id], recheckStatus: status as WeldStatus })
    }
  }

  recheckPass(id: string) {
    this.facade.submit('赵岚', { type: '复检结果更新', reason: `${id} 缺陷复检合格，关闭缺陷并更新复检结论`, weldIds: [id], recheckStatus: '合格', recheckNote: `复检合格 · ${new Date().toISOString().slice(0, 10)}` })
  }

  submit() {
    if (this.head) {
      this.facade.submit('陈锋', { type: '复检结果更新', reason: `${this.form.weldId} 新录入 ${this.form.type}，进入返修待复检`, weldIds: [this.form.weldId], recheckStatus: '返修中' })
    } else {
      this.facade.dispatch(A.advanceWeld({ id:this.form.weldId, status:'返修中' }))
    }
    this.dialog = false
  }
}
