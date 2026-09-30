import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { DialogModule } from 'primeng/dialog'
import { RevisionFacade } from '../services/revision.facade'
import { RevisionSelectors, type RevisionWeldView } from '../store/revision.selectors'
import { RevisionBannerComponent } from '../components/revision-banner.component'
import type { WeldState } from '../store/weld.reducer'
import * as A from '../store/weld.actions'
import type { Weld } from '../types'

@Component({
  selector:'app-weld-map', standalone:true, imports:[CommonModule,ButtonModule,TagModule,DialogModule,RevisionBannerComponent],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">二维构件定位</p><h1>构件焊缝地图</h1><p>颜色代表当前质量状态；圆环标记该焊缝存在待复核修订，原锁定结论已失效。</p></div><p-button label="批量生成检测计划" icon="pi pi-calendar-plus" (onClick)="planDialog = true" /></div>
      <app-revision-banner />
      <div class="map-grid"><section class="card drawing-card"><div class="drawing-head"><span>构件图 SG-07/SG-12 · 展开示意 · 批次 {{state.batchId}}</span><span>当前修订 {{head?.id ?? '未锁定'}} · 单位 mm · 1:50</span></div><svg viewBox="0 0 100 90" class="weld-map"><defs><pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="#dbe2ea" stroke-width=".2"/></pattern></defs><rect x="3" y="3" width="94" height="84" fill="url(#grid)" stroke="#334155"/><path d="M8 20H92M8 42H92M8 66H92" stroke="#94a3b8" stroke-width="4"/><path d="M16 12V78M42 12V78M70 12V78M86 12V78" stroke="#cbd5e1" stroke-width="7"/><g *ngFor="let view of views"><circle [attr.cx]="view.weld.x" [attr.cy]="view.weld.y" r="3.2" [attr.fill]="color(view)" stroke="#fff" stroke-width="1" (click)="select(view.weld)" /><circle *ngIf="view.pending" [attr.cx]="view.weld.x" [attr.cy]="view.weld.y" r="4.6" fill="none" stroke="#d97706" stroke-width=".7" stroke-dasharray="1.2 1" class="pending-ring"/><text [attr.x]="view.weld.x+4" [attr.y]="view.weld.y-4" class="label">{{view.weld.id}}</text><circle *ngFor="let defect of (view.entry?.defects ?? view.weld.defects)" [attr.cx]="view.weld.x + defect.position / 30" [attr.cy]="view.weld.y + 4" r="1.4" fill="#dc2626" /></g><text x="50" y="86" class="axis">构件长度方向 →　虚线圆环 = 待复核修订焊缝</text></svg></section>
        <aside class="card"><h2 class="panel-title">焊缝明细 <small class="rev-sub" *ngIf="selectedView">· {{selectedView.revision?.id ?? '未锁定'}}</small></h2><div *ngIf="selectedView as view" class="detail"><div class="detail-head"><div><small>{{view.weld.drawing}}</small><h3>{{view.weld.id}} · {{view.weld.component}}</h3></div><p-tag [value]="view.entry?.status ?? view.weld.status" [severity]="(view.entry?.status ?? view.weld.status) === '合格' || (view.entry?.status ?? view.weld.status) === '已关闭' ? 'success' : (view.entry?.status ?? view.weld.status) === '返修中' ? 'danger' : 'warn'" /></div>
          <div class="pending-box" *ngIf="view.pending"><i class="pi pi-exclamation-triangle"></i><div><b>待复核修订 {{head?.id}}</b><p>原锁定结论已失效：{{invalidReason}}；本页数值显示修订后待生效值，原快照只读保留。</p></div></div>
          <div class="kv"><span>焊接方法</span><b>{{view.weld.method}} / {{view.weld.joint}}</b></div><div class="kv"><span>焊工</span><b>{{view.weld.welder}}</b></div><div class="kv"><span>资质版本（固化）</span><b [class.danger]="view.entry && !view.entry.qualification.validAtWeldTime">{{qualLabel(view)}}</b></div><div class="kv"><span>检测比例</span><b [class.danger]="(view.entry?.inspectionRatio ?? view.weld.inspectionRatio) < view.weld.requiredRatio">{{view.entry?.inspectionRatio ?? view.weld.inspectionRatio}}% / {{view.weld.requiredRatio}}%</b></div><div class="kv"><span>返修记录</span><b>{{(view.entry?.repairRecords ?? view.weld.repairRecords).length}} 条</b></div>
          <h3>缺陷与返修记录（快照）</h3><div *ngFor="let defect of (view.entry?.defects ?? view.weld.defects)" class="defect"><b>{{defect.id}} · {{defect.type}}</b><p>位置 {{defect.position}}% · 长度 {{defect.length}}mm · {{defect.level}} · {{defect.method}}</p></div><p class="muted" *ngIf="!(view.entry?.defects ?? view.weld.defects).length">当前无未关闭缺陷。</p><ol class="repairs" *ngIf="(view.entry?.repairRecords ?? view.weld.repairRecords).length"><li *ngFor="let record of (view.entry?.repairRecords ?? view.weld.repairRecords)">{{record.round}}. {{record.date}} · {{record.result}} <small>{{record.id}}</small></li></ol><p-button label="进入检测返修" icon="pi pi-wrench" styleClass="w-full" routerLink="/inspections" /></div></aside></div>
      <p-dialog header="生成批量检测计划" [(visible)]="planDialog" [modal]="true" [style]="{width:'560px'}"><div class="dialog-form"><label>检测方法</label><select><option>UT 超声检测</option><option>MT 磁粉检测</option><option>UT + MT</option></select><label>计划日期</label><input type="date" value="2026-09-30" /><label>检测人员</label><select><option>陈锋</option><option>赵岚</option></select><p>计划纳入批次 {{state.batchId}}；锁定时将为计划内每条焊缝固化资质版本、检测比例、缺陷与返修记录。</p></div><ng-template #footer><p-button label="取消" severity="secondary" (onClick)="planDialog = false" /><p-button label="生成计划" (onClick)="createPlan()" /></ng-template></p-dialog>
    </main>
  `,
  styles:[`.map-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(320px,.65fr);gap:16px}.drawing-card{padding:0;overflow:hidden}.drawing-head{display:flex;justify-content:space-between;gap:10px;padding:13px 16px;background:#f8fafc;border-bottom:1px solid #e1e7ef;color:#64748b;font-size:13px}.weld-map{width:100%;height:min(68vh,680px);display:block;background:#fff}.weld-map circle{cursor:pointer}.pending-ring{animation:pulse 1.4s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}.label{font-size:2.4px;font-weight:700;fill:#334155}.axis{font-size:2.2px;fill:#94a3b8}.rev-sub{color:#1d4ed8;font-weight:700}.detail-head{display:flex;justify-content:space-between}.detail-head small{color:#7a8798}.detail-head h3{margin:5px 0}.kv{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #edf0f5}.kv span{color:#667085}.kv b{text-align:right}.pending-box{display:flex;gap:9px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px;margin:10px 0}.pending-box>i{color:#b45309;margin-top:2px}.pending-box p{margin:3px 0 0;font-size:12.5px}.defect{margin-top:10px;padding:10px;background:#fff1f2;border-left:3px solid #ef4444;border-radius:5px}.defect p{margin:4px 0 0;font-size:13px}.repairs{margin:8px 0 0;padding-left:20px;font-size:13px}.repairs small{color:#94a3b8}.dialog-form{display:grid;gap:8px}.dialog-form input,.dialog-form select{padding:9px;border:1px solid #cbd5e1;border-radius:6px}.muted{color:#7a8798}`],
})
export class WeldMapComponent {
  private readonly facade = inject(RevisionFacade)
  private readonly selectors = inject(RevisionSelectors)
  state!: WeldState
  planDialog = false

  constructor() {
    this.facade.initialize()
    this.facade.state().subscribe((state) => this.state = state)
  }

  get views() { return this.state ? this.selectors.viewFor(this.state) : [] }
  get selectedView() { return this.views.find((item) => item.weld.id === this.state?.selectedId) }
  get head() { return this.state ? this.selectors.headRevision(this.state) : null }
  get invalidReason() { return this.state ? this.selectors.invalidReason(this.state) : null }
  qualLabel(view: RevisionWeldView) {
    const qualification = view.entry?.qualification
    return qualification ? `${qualification.id} · ${qualification.standard}·${qualification.expiry}${qualification.validAtWeldTime ? '' : '（焊接时点失效）'}` : '未绑定资质版本'
  }
  select(weld: Weld) { this.facade.dispatch(A.selectWeld({ id: weld.id })) }
  color(view: RevisionWeldView) {
    const status = view.entry?.status ?? view.weld.status
    const qualificationValid = view.entry?.qualification.validAtWeldTime ?? true
    return status === '合格' || status === '已关闭' ? '#16a34a' : status === '返修中' || !qualificationValid ? '#dc2626' : status === '待复检' ? '#7c3aed' : '#f59e0b'
  }
  createPlan() {
    this.facade.dispatch(A.createPlan({ plan:{ id:`IP-${Date.now().toString().slice(-6)}`, date:'2026-09-30', method:'UT + MT', weldIds:['W-109'], inspector:'陈锋', state:'待执行', batchId:this.state.batchId, lockedInRevisionId:null, invalidReason:null } }))
    this.planDialog = false
  }
}
