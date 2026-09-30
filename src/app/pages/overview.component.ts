import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ButtonModule } from 'primeng/button'
import { SelectModule } from 'primeng/select'
import { FormsModule } from '@angular/forms'
import { RevisionFacade } from '../services/revision.facade'
import { RevisionSelectors, type RevisionWeldView } from '../store/revision.selectors'
import { RevisionBannerComponent } from '../components/revision-banner.component'
import type { WeldState } from '../store/weld.reducer'
import * as A from '../store/weld.actions'
import type { Weld } from '../types'

@Component({
  selector:'app-overview', standalone:true, imports:[CommonModule,TableModule,TagModule,ButtonModule,SelectModule,FormsModule,RevisionBannerComponent],
  template:`
    <main class="page">
      <div class="page-head"><div><p class="eyebrow">焊缝、资质与检测比例</p><h1>焊缝台账总览</h1><p>按构件、图纸和检验节点管理焊缝；锁定后焊工资质补录、检测比例调整与复检更新只生成待复核修订，不改原快照。</p></div><p-button label="批量导入焊缝" icon="pi pi-upload" severity="secondary" /></div>
      <app-revision-banner />
      <div class="grid-4"><article class="card metric"><span>焊缝总数</span><strong>{{state.welds.length}}</strong><small>批次 {{state.batchId}} · 已建地图定位 {{state.welds.length}} 条</small></article><article class="card metric"><span>待检测 / 返修</span><strong class="warning">{{pending}}</strong><small>{{state.plans.length}} 项计划纳入修订链</small></article><article class="card metric"><span>资质或比例预警</span><strong class="danger">{{warnings}}</strong><small>{{batchStatus === '未锁定' ? '必须处理后才可锁定' : '调整将生成待复核修订'}}</small></article><article class="card metric" [class.metric-pending]="batchStatus !== '已签字锁定'"><span>当前修订</span><strong>{{head?.id ?? '未锁定'}}</strong><small>v{{state.stateVersion}} · {{batchStatus}}<ng-container *ngIf="invalidReason"> · {{invalidReason}}</ng-container></small></article></div>
      <div class="grid-2"><section class="card"><div class="toolbar"><p-select [options]="statusOptions" [(ngModel)]="filter" (ngModelChange)="applyFilter($event)" placeholder="筛选状态" styleClass="w-full md:w-40" /><span class="spacer"></span><p-button label="导出焊缝台账" icon="pi pi-file-excel" severity="secondary" /></div><p-table [value]="filteredViews" [paginator]="true" [rows]="8" selectionMode="single" (onRowSelect)="onRowSelect($event)" dataKey="weld.id"><ng-template #header><tr><th>焊缝 / 构件</th><th>方法与资质版本</th><th>检测比例</th><th>返修</th><th>当前修订</th><th>状态</th></tr></ng-template><ng-template #body let-view><tr [class.row-pending]="view.pending"><td><b>{{view.weld.id}}</b><small class="block">{{view.weld.drawing}} · {{view.weld.component}}</small></td><td>{{view.weld.method}} · {{view.weld.welder}}<small class="block" [class.danger]="!(view.entry?.qualification.validAtWeldTime ?? true)">{{qualLabel(view)}}</small><div class="rev-chip" *ngIf="view.pending"><i class="pi pi-exclamation-triangle"></i>待复核：资质补录</div></td><td><b [class.danger]="(view.entry?.inspectionRatio ?? view.weld.inspectionRatio) < view.weld.requiredRatio">{{view.entry?.inspectionRatio ?? view.weld.inspectionRatio}}% / {{view.weld.requiredRatio}}%</b><small class="block">要求检测比例</small><div class="rev-chip ratio" *ngIf="view.pending && hasChange(view,'inspectionRatio')"><i class="pi pi-exclamation-triangle"></i>待复核比例调整</div></td><td>{{view.entry?.repairRecords.length ?? view.weld.repairs}} 次<small class="block" *ngIf="(view.entry?.repairRecords.length ?? view.weld.repairs) >= 2">重复返修关注</small></td><td><span class="mono">{{view.revision?.id ?? '—'}}</span><small class="block" [class.danger]="!!view.invalidReason">{{view.invalidReason ?? (view.revision?.status ?? '未锁定')}}</small></td><td><p-tag [value]="view.entry?.status ?? view.weld.status" [severity]="(view.entry?.status ?? view.weld.status) === '合格' || (view.entry?.status ?? view.weld.status) === '已关闭' ? 'success' : (view.entry?.status ?? view.weld.status) === '返修中' ? 'danger' : 'warn'" /></td></tr></ng-template></p-table></section>
      <aside class="card"><h2 class="panel-title">规则预警与修订触发</h2><div class="warning-row"><i class="red"></i><div><b>W-109 焊工资质即将到期</b><p>孙鹏证书 2026-10-01 到期（焊接时点已失效），检测计划未安排替代人员。</p><p-button [label]="batchStatus === '未锁定' ? '标记资质处理' : '补录有效资质（生成待复核修订）'" size="small" severity="danger" icon="pi pi-id-card" (onClick)="backfillQual()" /></div></div><div class="warning-row"><i class="amber"></i><div><b>W-109 检测比例不足</b><p>当前计划 10%，图纸及规范要求 20%。</p><p-button [label]="batchStatus === '未锁定' ? '按要求调整比例' : '调整检测比例至 20%（待复核）'" size="small" severity="warn" icon="pi pi-sliders-h" (onClick)="adjustRatio()" /></div></div><div class="warning-row"><i class="amber"></i><div><b>W-104 同一位置二次返修</b><p>需质量负责人确认返修工艺并提高复检比例，复检结果走修订链更新。</p></div></div><p class="chain-tip"><i class="pi pi-link"></i>所有变更只追加修订：原锁定快照保持只读，待质量负责人复核后生效。</p></aside></div>
    </main>
  `,
  styles:[`.block{display:block;color:#7a8798;margin-top:3px}.mono{font-weight:700;color:#1d4ed8}.row-pending{background:#fffbeb}.rev-chip{display:inline-flex;align-items:center;gap:4px;margin-top:4px;font-size:11.5px;color:#b45309;background:#fef3c7;border-radius:4px;padding:1px 7px}.rev-chip.ratio{color:#92400e}.warning-row{display:flex;gap:10px;padding:12px 0;border-bottom:1px solid #edf0f5}.warning-row i{width:6px;border-radius:5px;background:#f59e0b;flex:none}.warning-row i.red{background:#ef4444}.warning-row div{flex:1}.warning-row p{margin:4px 0 8px;font-size:13px}.warning-row .p-button{margin-bottom:2px}.metric-pending{border-left-color:#d97706}.chain-tip{display:flex;gap:8px;align-items:flex-start;margin:12px 0 0;font-size:13px;color:#667085;background:#f8fafc;border-radius:6px;padding:10px}.chain-tip i{color:#2563eb}`],
})
export class OverviewComponent {
  private readonly facade = inject(RevisionFacade)
  private readonly selectors = inject(RevisionSelectors)
  state!: WeldState
  filter = '全部'
  statusOptions = ['全部','待检测','合格','返修中','待复检','已关闭']

  constructor() {
    this.facade.initialize()
    this.facade.state().subscribe((state) => this.state = state)
  }

  get views(): RevisionWeldView[] { return this.state ? this.selectors.viewFor(this.state) : [] }
  get filteredViews() {
    if (this.filter === '全部') return this.views
    return this.views.filter((view) => view.weld.status === this.filter)
  }
  get pending() { return this.views.filter((item) => ['待检测','返修中','待复检'].includes(item.weld.status)).length }
  get warnings() { return this.views.filter((item) => !item.weld.qualificationId || (item.entry?.inspectionRatio ?? item.weld.inspectionRatio) < item.weld.requiredRatio || item.weld.repairs >= 2).length }
  get head() { return this.selectors.headRevision(this.state) }
  get batchStatus() { return this.selectors.batchStatus(this.state) }
  get invalidReason() { return this.selectors.invalidReason(this.state) }

  qualLabel(view: RevisionWeldView) {
    if (view.entry) {
      const qualification = view.entry.qualification
      return `${qualification.id} · ${qualification.standard}·${qualification.expiry}${qualification.validAtWeldTime ? '' : '（焊接时点失效）'}`
    }
    return this.state ? this.selectors.qualificationLabel(this.state, view.weld) : ''
  }

  hasChange(view: RevisionWeldView, field: string) {
    const head = this.head
    return !!head?.changes.some((change) => change.weldId === view.weld.id && change.field === field)
  }

  applyFilter(status: string) { this.facade.dispatch(A.filterStatus({ status })) }
  onRowSelect(event: { data?: RevisionWeldView | RevisionWeldView[] }) {
    const data = event.data
    if (data && !Array.isArray(data)) this.facade.dispatch(A.selectWeld({ id: data.weld.id }))
  }
  select(weld: Weld | undefined) { if (weld) this.facade.dispatch(A.selectWeld({ id: weld.id })) }

  backfillQual() {
    const submission = {
      type: '焊工资质补录' as const,
      reason: '孙鹏原证书 2026-10-01 到期，补录换证后有效资质 GB/T 9448·2029-06',
      weldIds: ['W-109'],
      qualification: { welder: '孙鹏', standard: 'GB/T 9448', expiry: '2029-06', validAtWeldTime: true },
    }
    if (this.batchStatus === '未锁定') this.facade.dispatch(A.advanceWeld({ id: 'W-109', status: '待检测' }))
    else this.facade.submit('陈锋', submission)
  }

  adjustRatio() {
    const submission = { type: '检测比例调整' as const, reason: '图纸及规范要求 W-109 检测比例由 10% 提高至 20%', weldIds: ['W-109'], ratio: 20 }
    if (this.batchStatus === '未锁定') this.facade.dispatch(A.advanceWeld({ id: 'W-109', status: '待检测' }))
    else this.facade.submit('陈锋', submission)
  }
}
