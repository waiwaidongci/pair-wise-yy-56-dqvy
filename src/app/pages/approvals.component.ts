import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { ButtonModule } from 'primeng/button'
import { TimelineModule } from 'primeng/timeline'
import { TagModule } from 'primeng/tag'
import { TableModule } from 'primeng/table'
import { SelectModule } from 'primeng/select'
import { WeldState, genRequestNo } from '../store/weld.reducer'
import * as A from '../store/weld.actions'
import type { Weld } from '../types'
import { RevisionBannerComponent } from '../components/revision-banner.component'

@Component({
  selector:'app-approvals', standalone:true, imports:[CommonModule,FormsModule,ButtonModule,TimelineModule,TagModule,TableModule,SelectModule,RevisionBannerComponent],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">签字、版本与追溯</p><h1>逐段确认与锁定</h1><p>审核人按焊缝或检测计划确认、退回或要求复检；锁定后生成只读版本快照，补录/复检只生成待复核修订。</p></div><p-button [label]="state.locked ? '已锁定' : '签字锁定检测批次'" icon="pi pi-lock" [disabled]="state.locked && state.lockSnapshot?.state === '有效'" (onClick)="lock()" /></div>
      <app-revision-banner [state]="state" />
      <div class="grid-2"><section class="card"><h2 class="panel-title">待审核焊缝</h2><div class="review" *ngFor="let weld of reviewWelds"><div><b>{{weld.id}} · {{weld.component}}</b><small>{{weld.method}} · {{weld.welder}} · 返修 {{weld.repairs}} 次 · 资质 {{weld.qualificationVersion}}</small></div><p-tag [value]="weld.status" [severity]="weld.status === '待复检' ? 'warn' : 'danger'" /><p-button label="要求复检" severity="danger" text size="small" /><p-button label="确认合格" size="small" (onClick)="confirm(weld.id)" /></div><p-button label="导出质量追溯包" icon="pi pi-file-export" severity="secondary" styleClass="w-full" /></section>
      <aside class="card"><h2 class="panel-title">完整审计时间线</h2><p-timeline [value]="state.audit" align="left"><ng-template #content let-event><div class="audit"><div><b>{{event.actor}} · {{event.action}}</b><span>{{event.time}}</span></div><p><strong>{{event.target}}</strong> {{event.detail}}</p></div></ng-template></p-timeline></aside></div>

      <section class="card mt-4"><h2 class="panel-title">锁定快照 vs 当前修订 <small class="muted">（快照锁定时固定，补录/复检不改原快照）</small></h2><p-table [value]="snapshotRows" [paginator]="true" [rows]="6"><ng-template #header><tr><th>焊缝</th><th>锁定资质版本</th><th>当前资质版本</th><th>锁定比例</th><th>当前比例</th><th>锁定返修</th><th>当前返修</th><th>状态</th></tr></ng-template><ng-template #body let-row><tr><td><b>{{row.weldId}}</b></td><td><code class="qv">{{row.snap?.qualificationVersion ?? '—'}}</code></td><td><code class="qv">{{row.current.qualificationVersion}}</code></td><td>{{row.snap?.inspectionRatio ?? '—'}}%</td><td>{{row.current.inspectionRatio}}%</td><td>{{row.snap?.repairs ?? '—'}}</td><td>{{row.current.repairs}}</td><td><p-tag *ngIf="row.changed" value="已偏离快照" severity="warn" /><p-tag *ngIf="!row.changed" value="与快照一致" severity="success" /></td></tr></ng-template></p-table></section>

      <section class="card mt-4"><h2 class="panel-title">待复核修订 <small class="muted">（补录 / 复检生成，退回复核）</small></h2><p-table [value]="state.revisions" [paginator]="true" [rows]="6"><ng-template #header><tr><th>修订编号</th><th>类型</th><th>目标</th><th>变更摘要</th><th>请求编号</th><th>状态</th><th>操作</th></tr></ng-template><ng-template #body let-rev><tr><td>{{rev.id}}</td><td><p-tag [value]="rev.type" severity="info" /></td><td>{{rev.targetId}}<small class="block">{{rev.reason}}</small></td><td><small *ngFor="let c of rev.changes" class="block">{{c}}</small></td><td><code class="qv">{{rev.requestNo}}</code></td><td><p-tag [value]="rev.state" [severity]="rev.state === '已通过' ? 'success' : rev.state === '已驳回' ? 'danger' : 'warn'" /></td><td><p-button label="复核通过" size="small" [disabled]="rev.state !== '待复核'" (onClick)="approve(rev.requestNo)" /><p-button label="驳回" size="small" severity="danger" text [disabled]="rev.state !== '待复核'" (onClick)="reject(rev.requestNo)" /></td></tr></ng-template></p-table></section>

      <div class="grid-2 mt-4"><section class="card"><h2 class="panel-title">并发保存演示 <small class="muted">（两位审核人同时保存同一批次，只成立一次）</small></h2><p class="muted">当前工作版本 <b>v{{state.version}}</b>。两位审核人基于同一版本同时保存：先到者成立，版本 +1；后到者基于过期版本，看到版本冲突，保存不成立。</p><div class="row-actions"><p-button label="模拟两位审核人同时保存同一批次" icon="pi pi-users" (onClick)="concurrentSave()" /><p-button label="单独保存批次" icon="pi pi-save" severity="secondary" (onClick)="singleSave()" /></div></section>
      <section class="card"><h2 class="panel-title">写入失败与重试 <small class="muted">（保留原快照与请求编号，重试不重复追加）</small></h2><div class="dialog-form"><label>修订类型</label><p-select [options]="failKinds" [(ngModel)]="failKind" placeholder="选择类型" /><label>目标焊缝</label><p-select [options]="weldOptions" [(ngModel)]="failTarget" placeholder="选择焊缝" /><p-button label="模拟写入失败" icon="pi pi-exclamation-triangle" severity="danger" (onClick)="simulateFail()" /></div><div class="fail-box" *ngIf="state.writeError"><i class="pi pi-times-circle"></i><div><b>写入失败（请求编号 {{failedRequestNo}}）</b><p>{{state.writeError}}</p><p-button label="重试该请求" icon="pi pi-refresh" size="small" (onClick)="retryFailed()" /></div></div></section></div>

      <section class="card mt-4"><h2 class="panel-title">版本快照</h2><div class="snapshot"><div><b>v{{state.version}}</b><small>当前工作版本 · {{state.welds.length}} 条焊缝 · {{state.plans.length}} 个检测计划 · {{state.revisions.length}} 项待复核修订</small></div><p-tag [value]="snapshotStateLabel" [severity]="snapshotStateSeverity" /><p-button label="查看差异" text /></div><p>版本快照记录焊缝资质版本、检测比例、缺陷、返修方案和签字人。锁定后补录/复检只派生待复核修订，不覆盖原始检测记录；原锁定结论失效后退回复核，复核通过重新锁定生成新快照。</p></section>
    </main>
  `,
  styles:[`.review{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:12px 0;border-bottom:1px solid #edf0f5}.review b,.review small{display:block}.review small{color:#7a8798;margin-top:4px}.audit{background:#fff;border:1px solid #e1e7ef;border-radius:6px;padding:10px}.audit>div{display:flex;justify-content:space-between}.audit span{color:#7a8798;font-size:12px}.audit p{margin:5px 0 0;font-size:13px}.snapshot{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:12px;background:#f8fafc;border-radius:6px}.snapshot b,.snapshot small{display:block}.snapshot small{color:#7a8798;margin-top:4px}.mt-4{margin-top:16px}.qv{background:#f1f5f9;border:1px solid #e1e7ef;border-radius:4px;padding:1px 6px;font-size:12px;color:#334155}.muted{color:#7a8798}.block{display:block;color:#7a8798;margin-top:3px}.row-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.dialog-form{display:grid;gap:8px;max-width:360px}.dialog-form label{font-size:13px;color:#475467}.fail-box{display:flex;gap:10px;margin-top:12px;padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;color:#b91c1c}.fail-box p{margin:4px 0 0;font-size:13px}.fail-box .p-button{margin-top:6px}@media(max-width:760px){.review{grid-template-columns:1fr auto}.review .p-button{width:100%}}`],
})
export class ApprovalsComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  state!: WeldState
  failKinds = ['资质补录','比例调整','复检更新']
  failKind = '复检更新'
  failTarget = 'W-104'
  failedRequestNo = ''
  private failedParams: { kind: string; weldId: string } | null = null
  constructor() { this.store.select('welds').subscribe((state) => this.state = state) }
  get reviewWelds() { return (this.state?.welds ?? []).filter((item) => ['待复检','返修中','待检测'].includes(item.status)) }
  get weldOptions() { return (this.state?.welds ?? []).map((w) => ({ label: `${w.id} · ${w.welder}`, value: w.id })) }
  get snapshotRows() {
    return (this.state?.welds ?? []).map((current) => {
      const snap = this.state?.lockSnapshot?.welds.find((s) => s.weldId === current.id)
      const changed = !!snap && (snap.qualificationVersion !== current.qualificationVersion || snap.inspectionRatio !== current.inspectionRatio || snap.repairs !== current.repairs || snap.status !== current.status)
      return { weldId: current.id, current, snap, changed }
    })
  }
  get snapshotStateLabel() {
    if (!this.state?.locked) return '可编辑'
    return this.state.lockSnapshot?.state === '已失效' ? '原结论已失效 · 待复核' : '已签字锁定'
  }
  get snapshotStateSeverity() {
    if (!this.state?.locked) return 'warn'
    return this.state.lockSnapshot?.state === '已失效' ? 'danger' : 'success'
  }
  confirm(id: string) { this.store.dispatch(A.advanceWeld({ id, status:'合格' })) }
  lock() { this.store.dispatch(A.lockBaseline()) }
  approve(requestNo: string) { this.store.dispatch(A.approveRevision({ requestNo })) }
  reject(requestNo: string) { this.store.dispatch(A.rejectRevision({ requestNo })) }

  // 并发保存：两位审核人基于同一版本同时保存，先到者成立，后到者版本冲突
  concurrentSave() {
    const base = this.state.version
    this.store.dispatch(A.saveBatch({ requestNo: genRequestNo(), basedOnVersion: base, actor: '审核人甲' }))
    this.store.dispatch(A.saveBatch({ requestNo: genRequestNo(), basedOnVersion: base, actor: '审核人乙' }))
  }
  singleSave() {
    this.store.dispatch(A.saveBatch({ requestNo: genRequestNo(), basedOnVersion: this.state.version, actor: '当前审核人' }))
  }

  // 写入失败：保留原快照与请求编号；重试时以同一请求编号提交，幂等不重复追加
  simulateFail() {
    const requestNo = genRequestNo()
    const weld = this.state.welds.find((w) => w.id === this.failTarget)
    const summary = `${this.failKind} · ${this.failTarget}${weld ? '（' + weld.welder + '）' : ''} 写入超时`
    this.failedRequestNo = requestNo
    this.failedParams = { kind: this.failKind, weldId: this.failTarget }
    this.store.dispatch(A.failWrite({ requestNo, reason: '网络写入超时', targetId: this.failTarget, summary }))
  }
  retryFailed() {
    if (!this.failedParams) return
    const { kind, weldId } = this.failedParams
    const requestNo = this.failedRequestNo
    if (kind === '资质补录') {
      this.store.dispatch(A.supplementQualification({ weldId, certificateNo: 'GB/T 9448 · 2027-12', validTo: '2027-12-01', requestNo }))
    } else if (kind === '比例调整') {
      this.store.dispatch(A.adjustRatio({ weldId, ratio: 30, reason: '重试：检测比例调整为 30%', requestNo }))
    } else {
      this.store.dispatch(A.updateReinspection({ weldId, status: '合格', reason: '重试：复检合格', requestNo }))
    }
    this.failedParams = null
  }
}
