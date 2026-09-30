import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { AccordionModule } from 'primeng/accordion'
import { WeldState, genRequestNo } from '../store/weld.reducer'
import * as A from '../store/weld.actions'
import type { Weld } from '../types'
import { RevisionBannerComponent } from '../components/revision-banner.component'

@Component({
  selector:'app-weld-map', standalone:true, imports:[CommonModule,FormsModule,ButtonModule,TagModule,DialogModule,InputTextModule,AccordionModule,RevisionBannerComponent],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">二维构件定位</p><h1>构件焊缝地图</h1><p>在构件展开图上定位焊缝、缺陷和返修位置，颜色代表当前质量状态。</p></div><p-button label="批量生成检测计划" icon="pi pi-calendar-plus" (onClick)="planDialog = true" /></div>
      <app-revision-banner [state]="state" />
      <div class="map-grid"><section class="card drawing-card"><div class="drawing-head"><span>构件图 SG-07-屋面梁 · 展开示意</span><span>单位：mm · 比例 1:50</span></div><svg viewBox="0 0 100 90" class="weld-map"><defs><pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="#dbe2ea" stroke-width=".2"/></pattern></defs><rect x="3" y="3" width="94" height="84" fill="url(#grid)" stroke="#334155"/><path d="M8 20H92M8 42H92M8 66H92" stroke="#94a3b8" stroke-width="4"/><path d="M16 12V78M42 12V78M70 12V78M86 12V78" stroke="#cbd5e1" stroke-width="7"/><g *ngFor="let weld of state.welds"><circle [attr.cx]="weld.x" [attr.cy]="weld.y" r="3.2" [attr.fill]="color(weld)" stroke="#fff" stroke-width="1" (click)="select(weld)" /><text [attr.x]="weld.x+4" [attr.y]="weld.y-4" class="label">{{weld.id}}</text><circle *ngFor="let defect of weld.defects" [attr.cx]="weld.x + defect.position / 30" [attr.cy]="weld.y + 4" r="1.4" fill="#dc2626" /></g><text x="50" y="86" class="axis">构件长度方向 →</text></svg></section>
        <aside class="card"><h2 class="panel-title">焊缝明细</h2><div *ngIf="selected" class="detail"><div class="detail-head"><div><small>{{selected.drawing}}</small><h3>{{selected.id}} · {{selected.component}}</h3></div><p-tag [value]="selected.status" [severity]="selected.status === '合格' || selected.status === '已关闭' ? 'success' : selected.status === '返修中' ? 'danger' : 'warn'" /></div><div class="kv"><span>焊接方法</span><b>{{selected.method}} / {{selected.joint}}</b></div><div class="kv"><span>焊工</span><b>{{selected.welder}}</b></div><div class="kv"><span>资质版本</span><b><code class="qv">{{selected.qualificationVersion}}</code></b></div><div class="kv"><span>检测比例</span><b [class.danger]="selected.inspectionRatio < selected.requiredRatio">{{selected.inspectionRatio}}% / {{selected.requiredRatio}}%</b></div><div class="kv"><span>返修次数</span><b>{{selected.repairs}}</b></div><div class="snap-cmp" *ngIf="snapOf(selected) as snap"><b>锁定快照（不可改）</b><span>资质 {{snap.qualificationVersion}} · 比例 {{snap.inspectionRatio}}% · 返修 {{snap.repairs}} 次</span><p-tag *ngIf="invalid" value="已失效 · 待复核" severity="danger" /></div><h3>缺陷记录</h3><div *ngFor="let defect of selected.defects" class="defect"><b>{{defect.id}} · {{defect.type}}</b><p>位置 {{defect.position}}% · 长度 {{defect.length}}mm · {{defect.level}} · {{defect.method}}</p></div><p class="muted" *ngIf="!selected.defects.length">当前无未关闭缺陷。</p><div class="row-actions"><p-button label="补录焊工资质" icon="pi pi-id-card" size="small" (onClick)="openQual()" /><p-button label="调整检测比例" icon="pi pi-percentage" size="small" severity="secondary" (onClick)="openRatio()" /></div></div></aside></div>
      <p-dialog header="生成批量检测计划" [(visible)]="planDialog" [modal]="true" [style]="{width:'560px'}"><div class="dialog-form"><label>检测方法</label><select><option>UT 超声检测</option><option>MT 磁粉检测</option><option>UT + MT</option></select><label>计划日期</label><input type="date" value="2026-09-30" /><label>检测人员</label><select><option>陈锋</option><option>赵岚</option></select><p>系统将排除资质即将到期焊工完成的焊缝，并提示检测比例不足项。</p></div><ng-template #footer><p-button label="取消" severity="secondary" (onClick)="planDialog = false" /><p-button label="生成计划" (onClick)="createPlan()" /></ng-template></p-dialog>
      <p-dialog header="补录焊工资质" [(visible)]="qualDialog" [modal]="true" [style]="{width:'520px'}"><div class="dialog-form"><label>焊缝</label><input [value]="selected?.id + ' · ' + selected?.welder" disabled /><label>新证书编号</label><input pInputText [(ngModel)]="qualForm.certificateNo" placeholder="如 GB/T 9448 · 2027-06" /><label>有效期至</label><input pInputText type="month" [(ngModel)]="qualForm.validTo" /><p class="muted">锁定后补录将生成待复核修订，原锁定快照不改变。</p></div><ng-template #footer><p-button label="取消" severity="secondary" (onClick)="qualDialog = false" /><p-button label="提交补录" (onClick)="submitQual()" /></ng-template></p-dialog>
      <p-dialog header="调整检测比例" [(visible)]="ratioDialog" [modal]="true" [style]="{width:'520px'}"><div class="dialog-form"><label>焊缝</label><input [value]="selected?.id" disabled /><label>检测比例（%）</label><input pInputText type="number" [(ngModel)]="ratioForm.ratio" /><label>调整原因</label><input pInputText [(ngModel)]="ratioForm.reason" placeholder="如：设计变更，节点检测比例提高" /><p class="muted">锁定后调整将生成待复核修订并使原锁定结论失效。</p></div><ng-template #footer><p-button label="取消" severity="secondary" (onClick)="ratioDialog = false" /><p-button label="提交调整" (onClick)="submitRatio()" /></ng-template></p-dialog>
    </main>
  `,
  styles:[`.map-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(310px,.65fr);gap:16px}.drawing-card{padding:0;overflow:hidden}.drawing-head{display:flex;justify-content:space-between;padding:13px 16px;background:#f8fafc;border-bottom:1px solid #e1e7ef;color:#64748b;font-size:13px}.weld-map{width:100%;height:min(68vh,680px);display:block;background:#fff}.weld-map circle{cursor:pointer}.label{font-size:2.4px;font-weight:700;fill:#334155}.axis{font-size:2.2px;fill:#94a3b8}.detail-head{display:flex;justify-content:space-between}.detail-head small{color:#7a8798}.detail-head h3{margin:5px 0}.kv{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #edf0f5}.kv span{color:#667085}.qv{background:#f1f5f9;border:1px solid #e1e7ef;border-radius:4px;padding:1px 6px;font-size:12px;color:#334155}.snap-cmp{display:grid;gap:4px;margin:10px 0;padding:10px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:6px;font-size:12px;color:#475467}.snap-cmp b{color:#334155}.defect{margin-top:10px;padding:10px;background:#fff1f2;border-left:3px solid #ef4444;border-radius:5px}.defect p{margin:4px 0 0;font-size:13px}.row-actions{display:flex;gap:8px;margin-top:12px}.dialog-form{display:grid;gap:8px}.dialog-form input,.dialog-form select{padding:9px;border:1px solid #cbd5e1;border-radius:6px}.muted{color:#7a8798}`],
})
export class WeldMapComponent {
  readonly store = inject(Store<{ welds: WeldState }>)
  state!: WeldState
  planDialog = false
  qualDialog = false
  ratioDialog = false
  qualForm = { certificateNo:'GB/T 9448 · 2027-06', validTo:'2027-06' }
  ratioForm = { ratio:20, reason:'' }
  constructor() { this.store.select('welds').subscribe((state) => this.state = state) }
  get selected() { return this.state?.welds.find((item) => item.id === this.state.selectedId) }
  get invalid() { return this.state?.lockSnapshot?.state === '已失效' }
  snapOf(weld: Weld) { return this.state?.lockSnapshot?.welds.find((s) => s.weldId === weld.id) }
  select(weld: Weld) { this.store.dispatch(A.selectWeld({ id: weld.id })) }
  color(weld: Weld) { return weld.status === '合格' || weld.status === '已关闭' ? '#16a34a' : weld.status === '返修中' || !weld.qualificationValid ? '#dc2626' : weld.status === '待复检' ? '#7c3aed' : '#f59e0b' }
  createPlan() { this.store.dispatch(A.createPlan({ plan:{ id:`IP-${Date.now().toString().slice(-6)}`, date:'2026-09-30', method:'UT + MT', weldIds:['W-105','W-106','W-108'], inspector:'陈锋', state:'待执行' } })); this.planDialog = false }
  openQual() { this.qualForm = { certificateNo: this.selected?.qualification ?? 'GB/T 9448 · 2027-06', validTo:'2027-06' }; this.qualDialog = true }
  openRatio() { this.ratioForm = { ratio: this.selected?.inspectionRatio ?? 20, reason:'' }; this.ratioDialog = true }
  submitQual() {
    if (!this.selected) return
    this.store.dispatch(A.supplementQualification({ weldId:this.selected.id, certificateNo:this.qualForm.certificateNo, validTo:`${this.qualForm.validTo}-01`, requestNo:genRequestNo() }))
    this.qualDialog = false
  }
  submitRatio() {
    if (!this.selected) return
    this.store.dispatch(A.adjustRatio({ weldId:this.selected.id, ratio:Number(this.ratioForm.ratio), reason:this.ratioForm.reason, requestNo:genRequestNo() }))
    this.ratioDialog = false
  }
}
