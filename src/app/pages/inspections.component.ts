import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { TextareaModule } from 'primeng/textarea'
import { SelectButtonModule } from 'primeng/selectbutton'
import { WeldState, genRequestNo } from '../store/weld.reducer'
import * as A from '../store/weld.actions'
import { RevisionBannerComponent } from '../components/revision-banner.component'

@Component({
  selector:'app-inspections', standalone:true, imports:[CommonModule,FormsModule,TableModule,TagModule,ButtonModule,DialogModule,InputTextModule,TextareaModule,SelectButtonModule,RevisionBannerComponent],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">NDT / 返修闭环</p><h1>检测计划与返修</h1><p>检测结果绑定缺陷位置、等级、照片、报告和返修方案；锁定后复检更新只生成待复核修订，不改原快照。</p></div><p-button label="新增检测结果" icon="pi pi-plus" (onClick)="dialog = true" /></div>
      <app-revision-banner [state]="state" />
      <div class="grid-2"><section class="card"><h2 class="panel-title">批量检测计划</h2><p-table [value]="state.plans" [paginator]="true" [rows]="6"><ng-template #header><tr><th>计划编号</th><th>日期</th><th>方法</th><th>焊缝</th><th>检测人</th><th>状态</th></tr></ng-template><ng-template #body let-plan><tr><td>{{plan.id}}</td><td>{{plan.date}}</td><td>{{plan.method}}</td><td>{{plan.weldIds.length}} 条</td><td>{{plan.inspector}}</td><td><p-tag [value]="plan.state" [severity]="plan.state === '已完成' ? 'success' : plan.state === '执行中' ? 'info' : 'warn'" /></td></tr></ng-template></p-table><p-button label="开始执行计划" icon="pi pi-play" styleClass="mt-3" /></section>
      <aside class="card"><h2 class="panel-title">返修状态流转</h2><div class="step" *ngFor="let weld of repairWelds"><div><b>{{weld.id}} · {{weld.component}}</b><small>{{weld.defects.length}} 个缺陷 · 已返修 {{weld.repairs}} 次 · 资质 {{weld.qualificationVersion}}</small></div><p-tag [value]="weld.status" severity="warn" /><p-selectbutton [options]="['返修中','待复检','合格']" [ngModel]="weld.status" (ngModelChange)="advance(weld.id,$event)" /></div><p-button label="提交质量负责人审核" icon="pi pi-send" styleClass="w-full" /></aside></div>
      <section class="card mt-4"><h2 class="panel-title">待复核修订链 <small class="muted">（补录 / 复检生成，原快照不改）</small></h2><p-table [value]="state.revisions" [paginator]="true" [rows]="6"><ng-template #header><tr><th>修订编号</th><th>类型</th><th>目标</th><th>变更摘要</th><th>请求编号</th><th>状态</th></tr></ng-template><ng-template #body let-rev><tr><td>{{rev.id}}</td><td><p-tag [value]="rev.type" severity="info" /></td><td>{{rev.targetId}}<small class="block">{{rev.reason}}</small></td><td><small *ngFor="let c of rev.changes" class="block">{{c}}</small></td><td><code class="qv">{{rev.requestNo}}</code></td><td><p-tag [value]="rev.state" [severity]="rev.state === '已通过' ? 'success' : rev.state === '已驳回' ? 'danger' : 'warn'" /></td></tr></ng-template></p-table></section>
      <section class="card mt-4"><h2 class="panel-title">检测结果与缺陷明细</h2><p-table [value]="defects" [paginator]="true" [rows]="8"><ng-template #header><tr><th>缺陷编号</th><th>焊缝</th><th>位置 / 长度</th><th>类型 / 等级</th><th>检测方法</th><th>报告</th><th>处置</th></tr></ng-template><ng-template #body let-item><tr><td>{{item.defect.id}}</td><td>{{item.weld.id}}</td><td>{{item.defect.position}}% · {{item.defect.length}}mm</td><td>{{item.defect.type}} · {{item.defect.level}}</td><td>{{item.defect.method}}</td><td>{{item.defect.report}}</td><td><p-button label="退回方案" severity="danger" size="small" text /><p-button label="复检更新" size="small" (onClick)="openRecheck(item.weld.id)" /></td></tr></ng-template></p-table></section>
      <p-dialog header="录入检测结果" [(visible)]="dialog" [modal]="true" [style]="{width:'620px'}"><div class="form"><label>焊缝编号</label><input pInputText [(ngModel)]="form.weldId" /><label>检测方法</label><select [(ngModel)]="form.method"><option>UT</option><option>MT</option><option>PT</option></select><label>缺陷位置（0–100%）</label><input pInputText type="number" [(ngModel)]="form.position" /><label>缺陷类型与等级</label><input pInputText [(ngModel)]="form.type" placeholder="如：未熔合 / Ⅲ级" /><label>报告编号与说明</label><textarea pTextarea [(ngModel)]="form.report" rows="4"></textarea></div><ng-template #footer><p-button label="取消" severity="secondary" (onClick)="dialog=false" /><p-button label="提交结果" [disabled]="!form.weldId || !form.report" (onClick)="submit()" /></ng-template></p-dialog>
      <p-dialog header="复检结果更新" [(visible)]="recheckDialog" [modal]="true" [style]="{width:'520px'}"><div class="form"><label>焊缝编号</label><input pInputText [(ngModel)]="recheckForm.weldId" /><label>复检结论</label><select [(ngModel)]="recheckForm.status"><option value="合格">合格</option><option value="待复检">待复检</option><option value="返修中">返修中</option></select><label>复检说明</label><input pInputText [(ngModel)]="recheckForm.reason" placeholder="如：UT 复检合格，关闭缺陷" /><p class="muted">锁定后更新将生成待复核修订，原锁定快照不改变。</p></div><ng-template #footer><p-button label="取消" severity="secondary" (onClick)="recheckDialog = false" /><p-button label="提交复检更新" (onClick)="submitRecheck()" /></ng-template></p-dialog>
    </main>
  `,
  styles:[`.step{display:grid;grid-template-columns:1fr auto;gap:9px;padding:12px 0;border-bottom:1px solid #edf0f5}.step>div,.step small{display:block}.step small{color:#7a8798;margin-top:4px}.step p-selectbutton{grid-column:1/-1}.form{display:grid;gap:9px}.form input,.form select,.form textarea{padding:9px;border:1px solid #cbd5e1;border-radius:6px;width:100%}.mt-3{margin-top:12px}.mt-4{margin-top:16px}.qv{background:#f1f5f9;border:1px solid #e1e7ef;border-radius:4px;padding:1px 6px;font-size:12px;color:#334155}.muted{color:#7a8798}.block{display:block;color:#7a8798;margin-top:3px}`],
})
export class InspectionsComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  state!: WeldState
  dialog = false
  recheckDialog = false
  form = { weldId:'W-109', method:'UT', position:42, type:'未熔合 / Ⅲ级', report:'UT-2026-0929-08；按 NB/T 47013.3 评定。' }
  recheckForm = { weldId:'W-104', status:'合格' as const, reason:'' }
  constructor() { this.store.select('welds').subscribe((state) => this.state = state) }
  get repairWelds() { return (this.state?.welds ?? []).filter((item) => ['返修中','待复检'].includes(item.status)) }
  get defects() { return (this.state?.welds ?? []).flatMap((weld) => weld.defects.map((defect) => ({ weld, defect }))) }
  advance(id: string, status: string) { this.store.dispatch(A.advanceWeld({ id, status: status as never })) }
  submit() { this.store.dispatch(A.advanceWeld({ id:this.form.weldId, status:'返修中' })); this.dialog = false }
  openRecheck(weldId: string) { this.recheckForm = { weldId, status:'合格', reason:'' }; this.recheckDialog = true }
  submitRecheck() {
    this.store.dispatch(A.updateReinspection({ weldId:this.recheckForm.weldId, status:this.recheckForm.status, reason:this.recheckForm.reason, requestNo:genRequestNo() }))
    this.recheckDialog = false
  }
}
