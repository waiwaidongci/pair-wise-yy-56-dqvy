import { RevisionServerService } from '../src/app/services/revision-server.service'
import { DataMigrationService } from '../src/app/services/data-migration.service'
import type { LegacyPlan, LegacyWeld } from '../src/app/types'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { passed += 1; console.log(`  ✅ ${message}`) }
  else { failed += 1; console.error(`  ❌ ${message}`) }
}

const legacyWelds: LegacyWeld[] = [
  { id: 'W-1', drawing: 'D', component: 'C1', joint: 'j', method: 'GMAW', welder: '王凯', qualification: 'GB/T 9448 · 2027-06', qualificationValid: true, inspectionRatio: 50, requiredRatio: 50, status: '合格', x: 1, y: 1, repairs: 0, defects: [] },
  { id: 'W-2', drawing: 'D', component: 'C2', joint: 'j', method: 'SAW', welder: '孙鹏', qualification: 'GB/T 9448 · 2026-10-01', qualificationValid: false, inspectionRatio: 10, requiredRatio: 20, status: '返修中', x: 2, y: 2, repairs: 2, defects: [{ id: 'D-1', position: 30, type: '夹渣', length: 10, level: 'Ⅱ级', method: 'UT', report: 'R-1' }] },
]
const legacyPlans: LegacyPlan[] = [
  { id: 'IP-1', date: '2026-09-30', method: 'UT', weldIds: ['W-1', 'W-2'], inspector: '陈锋', state: '执行中' },
]

// ---- 1. 旧数据升级：按焊接时点有效资质补齐版本 ----
const migration = new DataMigrationService()
const migrated = migration.migrate(legacyWelds, legacyPlans, 'B-1')
assert(migrated.qualifications.length === 2, `旧数据补齐 2 个资质版本（实际 ${migrated.qualifications.length}）`)
assert(migrated.backfilledWelderIds.includes('王凯') && migrated.backfilledWelderIds.includes('孙鹏'), '两名焊工均按历史有效资质回填')
assert(migrated.welds[1].repairRecords.length === 2, '返修次数展开为 2 条返修记录')
assert(migrated.qualifications[1].validAtWeldTime === false && migrated.qualifications[1].source === '历史台账补录', '过期资质按焊接时点失效标记回填')
assert(migrated.plans[0].batchId === 'B-1', '计划归属检测批次')

const server = new RevisionServerService()
server.seed({ batchId: 'B-1', welds: migrated.welds, plans: migrated.plans, qualifications: migrated.qualifications, audit: [] })

// ---- 2. 锁定：固化计划内每条焊缝 ----
const lockReq = 'REQ-LOCK-1'
const lock = server.lock({ batchId: 'B-1', requestId: lockReq, expectedVersion: 1, actor: '周质量负责人', reason: '锁定' })
assert(lock.ok && lock.revision?.type === '锁定基线', '锁定成功')
assert(lock.revision!.entries.length === 2, '快照固化计划内 2 条焊缝')
assert(lock.revision!.entries[1].inspectionRatio === 10, '快照固化检测比例 10%')
assert(lock.revision!.entries[1].qualification.id === 'QV-002', '快照固化资质版本 QV-002')
assert(lock.revision!.entries[1].repairRecords.length === 2, '快照固化返修记录 2 条')
assert(lock.stateVersion === 2, `锁定后版本号 v2（实际 v${lock.stateVersion}）`)

// 原快照对象引用保存，后续验证不可变
const frozenEntry = JSON.stringify(lock.revision!.entries)

// ---- 3. 并发双锁：同版本两个请求，只成立一次 ----
const lockB = server.lock({ batchId: 'B-1', requestId: 'REQ-LOCK-B', expectedVersion: 1, actor: '审核人乙', reason: '并发迟到锁' })
assert(!lockB.ok && !!lockB.conflict, '后到者收到版本冲突')
assert(server.getState().revisions.filter((r) => r.type === '锁定基线').length === 1, '锁定只成立一次，无重复快照')

// ---- 4. 资质补录：生成待复核修订，原锁定失效但快照不变 ----
const qualResult = server.propose({
  batchId: 'B-1', requestId: 'REQ-QUAL-1', expectedVersion: 2, actor: '陈锋',
  type: '焊工资质补录', reason: '孙鹏换证', weldIds: ['W-2'],
  qualification: { welder: '孙鹏', standard: 'GB/T 9448', expiry: '2029-06', validAtWeldTime: true },
})
assert(qualResult.ok && qualResult.revision?.status === '待复核', '资质补录生成待复核修订')
const stateAfterQual = server.getState()
assert(stateAfterQual.revisions[0].status === '已失效' && stateAfterQual.revisions[0].invalidReason === '焊工资质补录', '原锁定结论失效，原因=焊工资质补录')
assert(JSON.stringify(stateAfterQual.revisions[0].entries) === frozenEntry, '原锁定快照内容保持只读不变')
assert(stateAfterQual.welds[1].qualificationId === 'QV-002', '待复核期间工作数据资质版本不变')
assert(qualResult.revision!.entries[1].qualification.expiry === '2029-06', '新修订快照固化补录后的资质版本')
assert(qualResult.revision!.parentId === lock.revision!.id, '新修订 parentId 指向原锁定，接成修订链')

// 待复核互斥：不能再提
const dup = server.propose({
  batchId: 'B-1', requestId: 'REQ-RATIO-X', expectedVersion: 3, actor: '陈锋',
  type: '检测比例调整', reason: '互斥测试', weldIds: ['W-2'], ratio: 20,
})
assert(!dup.ok && !!dup.conflict, '已有待复核修订时再次提交被拒绝')

// ---- 5. 写入失败：失败前不落任何记录，同 requestId 重试不重复 ----
server.review({ requestId: 'REQ-REV-1', expectedVersion: 3, revisionId: qualResult.revision!.id, approve: false, reviewer: '周质量负责人', note: '先退回以便测失败' })
// 现在最新为已失效 + 有效基线恢复；再提比例修订，打开失败开关
server.failNextWrite = true
const failedRatio = server.propose({
  batchId: 'B-1', requestId: 'REQ-RATIO-FAIL', expectedVersion: 4, actor: '陈锋',
  type: '检测比例调整', reason: '比例到20', weldIds: ['W-2'], ratio: 20,
})
assert(!failedRatio.ok && failedRatio.error?.includes('写入失败'), '模拟写入失败返回错误')
assert(server.getState().revisions.length === 2, '失败不追加修订记录（仍为 2 条）')
const retryRatio = server.propose({
  batchId: 'B-1', requestId: 'REQ-RATIO-FAIL', expectedVersion: 4, actor: '陈锋',
  type: '检测比例调整', reason: '比例到20', weldIds: ['W-2'], ratio: 20,
})
assert(retryRatio.ok, '同一请求编号重试成功')
assert(server.getState().revisions.length === 3, '重试只追加 1 条修订，无重复')

// ---- 6. 复核通过：变更落到工作数据 ----
const approve = server.review({ requestId: 'REQ-REV-2', expectedVersion: 5, revisionId: retryRatio.revision!.id, approve: true, reviewer: '周质量负责人', note: '通过' })
assert(approve.ok && retryRatio.revision!.status === '有效', '复核通过，修订变为有效')
assert(server.getState().welds[1].inspectionRatio === 20, '复核通过后工作数据检测比例更新为 20%')
assert(server.getState().stateVersion === 6, '版本号递增到 v6')

// 重复复核只成立一次
const reviewAgain = server.review({ requestId: 'REQ-REV-3', expectedVersion: 6, revisionId: retryRatio.revision!.id, approve: true, reviewer: '乙', note: 'x' })
assert(!reviewAgain.ok && !!reviewAgain.conflict, '同一修订重复复核被拒绝')

// ---- 7. 复检更新 + 复核退回：原快照保留 ----
const recheck = server.propose({
  batchId: 'B-1', requestId: 'REQ-RECHECK-1', expectedVersion: 6, actor: '赵岚',
  type: '复检结果更新', reason: '复检合格', weldIds: ['W-2'], recheckStatus: '合格', recheckNote: '复检合格',
})
assert(recheck.ok && recheck.revision!.entries[1].repairRecords.length === 3, '复检修订快照追加返修记录到 3 条')
assert(server.getState().welds[1].status === '返修中', '待复核期间工作数据状态仍为返修中')
const reject = server.review({ requestId: 'REQ-REV-4', expectedVersion: 7, revisionId: recheck.revision!.id, approve: false, reviewer: '周质量负责人', note: '依据不足' })
assert(reject.ok && recheck.revision!.status === '已失效' && recheck.revision!.invalidReason === '复核退回', '复核退回：修订作废，原因=复核退回')
assert(server.getState().welds[1].status === '返修中', '退回后工作数据未受污染')

// ---- 8. requestId 幂等重放：成功结果重复提交返回首次结果 ----
const replay = server.lock({ batchId: 'B-1', requestId: lockReq, expectedVersion: 1, actor: 'x', reason: 'x' })
assert(replay.ok && replay.duplicated && replay.revision?.id === lock.revision!.id, '同 requestId 重放返回首次结果')
assert(server.getState().revisions.length === 4, '重放不产生新记录（仍为 4 条）')

console.log(`\n${passed} 通过，${failed} 失败`)
if (failed) process.exit(1)
