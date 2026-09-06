import { IntakeFlow, type IntakeCopy } from '@/components/domain/intake/IntakeFlow'

const COPY: IntakeCopy = {
  entry: 'A',
  pageTitle: '拍处方笺录入',
  pageLead: '把这次看病开的药安排上：建档和服药计划在同一个确认页完成，医嘱只抄录不生成。',
  uploadTitle: '上传平铺完整的处方笺照片',
  uploadHint: '覆盖 Rp（正文）至「处方完毕」，避免反光、遮挡和过暗',
  guidePoints: [
    '处方笺平铺完整入镜',
    '覆盖 Rp 至「处方完毕」',
    '关闭闪光灯避免反光',
    '涂黑/遮挡字段按缺失处理，系统不猜测',
  ],
  otherEntryLabel: '拍药品',
  otherEntryPath: '/intake/drug',
}

/** 入口A · 拍处方笺（M2-T8 · PRD §7.2.1）：医嘱线主导，产出档案 + 计划草稿。 */
export default function IntakeRx() {
  return <IntakeFlow copy={COPY} />
}
