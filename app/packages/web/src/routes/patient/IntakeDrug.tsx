import { IntakeFlow, type IntakeCopy } from '@/components/domain/intake/IntakeFlow'

const COPY: IntakeCopy = {
  entry: 'B',
  pageTitle: '拍药品建档',
  pageLead: '我手里这个药，帮我建档管理：仅身份线建档，计划由你手动创建（药盒/标签用法不自动抄录）。',
  uploadTitle: '上传正面清晰的药盒照片',
  uploadHint: '药盒正面完整入镜，医院标签清晰可读；散装药片无法识别',
  guidePoints: [
    '药盒边缘完整入镜',
    '药名与规格文字清晰',
    '医院标签完整可读（如有）',
    '不要上传散装药片',
  ],
  otherEntryLabel: '拍处方笺',
  otherEntryPath: '/intake/rx',
}

/** 入口B · 拍药品（M2-T8 · PRD §7.2.1 / V2.1）：身份线主导，所有药盒同一路径，仅建档。 */
export default function IntakeDrug() {
  return <IntakeFlow copy={COPY} />
}
