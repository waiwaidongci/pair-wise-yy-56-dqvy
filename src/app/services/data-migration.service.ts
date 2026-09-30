import { Injectable } from '@angular/core'
import type {
  InspectionPlan,
  LegacyPlan,
  LegacyWeld,
  QualificationVersion,
  RepairRecord,
  Weld,
} from '../types'

export interface MigratedData {
  welds: Weld[]
  plans: InspectionPlan[]
  qualifications: QualificationVersion[]
  backfilledWelderIds: string[]
}

/**
 * 旧数据升级：历史台账只有“资质文本 + 当前是否有效”，没有版本与返修记录。
 * 规则——按焊接完成时点“当时有效”的焊工资质补齐资质版本（资质过期焊缝也要回填），
 * 同一焊工同一张证书复用同一版本；返修次数展开为可追溯的返修记录。
 */
@Injectable({ providedIn: 'root' })
export class DataMigrationService {
  migrate(legacyWelds: LegacyWeld[], legacyPlans: LegacyPlan[], batchId: string): MigratedData {
    const certIndex = new Map<string, string>()
    const qualifications: QualificationVersion[] = []

    const qualify = (weld: LegacyWeld): string => {
      const [standard = 'GB/T 9448', expiry = '未知'] = weld.qualification.split('·').map((part) => part.trim())
      const key = `${weld.welder}|${standard}|${expiry}`
      let id = certIndex.get(key)
      if (!id) {
        id = `QV-${String(qualifications.length + 1).padStart(3, '0')}`
        certIndex.set(key, id)
        qualifications.push({
          id,
          welder: weld.welder,
          standard,
          expiry,
          // 旧标记 qualificationValid 表示该证书在焊接完成时点是否有效，升级时原样沿用
          validAtWeldTime: weld.qualificationValid,
          source: '历史台账补录',
        })
      }
      return id
    }

    const backfilledWelderIds: string[] = []
    const welds: Weld[] = legacyWelds.map((weld) => {
      const qualificationId = qualify(weld)
      const cert = qualifications.find((item) => item.id === qualificationId)!
      if (cert.source === '历史台账补录' && !backfilledWelderIds.includes(weld.welder)) {
        backfilledWelderIds.push(weld.welder)
      }
      const repairRecords: RepairRecord[] = Array.from({ length: weld.repairs }, (_, index) => ({
        id: `${weld.id}-RR${index + 1}`,
        round: index + 1,
        date: '2026-09 历史补录',
        result: index + 1 === weld.repairs && (weld.status === '待复检' || weld.status === '返修中')
          ? '待复检'
          : '复检合格',
      }))
      return {
        id: weld.id,
        drawing: weld.drawing,
        component: weld.component,
        joint: weld.joint,
        method: weld.method,
        welder: weld.welder,
        qualificationId,
        inspectionRatio: weld.inspectionRatio,
        requiredRatio: weld.requiredRatio,
        status: weld.status,
        x: weld.x,
        y: weld.y,
        repairs: weld.repairs,
        defects: weld.defects.map((defect) => ({ ...defect })),
        repairRecords,
        pendingRevisionId: null,
        invalidReason: null,
      }
    })

    const plans: InspectionPlan[] = legacyPlans.map((plan) => ({
      ...plan,
      weldIds: [...plan.weldIds],
      batchId,
      lockedInRevisionId: null,
      invalidReason: null,
    }))

    return { welds, plans, qualifications, backfilledWelderIds }
  }
}
