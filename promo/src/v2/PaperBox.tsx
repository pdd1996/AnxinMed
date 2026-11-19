// PaperBox.tsx — v2 共享件：把 lib/film 的药物形态包成可放进 CSS 3D 的剪纸元素。
// SVG 矢量（任意 scale 锐利，Q2 无需位图栅格化链路）；paper 材质 = 实色 + 硬偏移投影。
// form: carton/capsule/tablet/blister/bottle（用户反馈：药物剪影必须一眼可认，默认改进药盒）。
import React from 'react';
import {InkFilter, MaterialLayer, roughFor} from '../lib/motion';
import {MedForm, PALETTE, medItems} from '../lib/film';

export const PaperBox: React.FC<{
  w: number; h: number; c: number; shadeC: number; edgeId?: string; shadow?: number; form?: MedForm;
}> = ({w, h, c, shadeC, edgeId, shadow = 6, form = 'carton'}) => (
  <svg width={w + 24} height={h + 24} viewBox={`${-w / 2 - 12} ${-h / 2 - 12} ${w + 24} ${h + 24}`}
    style={{display: 'block', overflow: 'visible'}}>
    {edgeId && <InkFilter id={edgeId} edge={roughFor(w)} grain={0.3} seed={21} />}
    <g filter={edgeId ? `url(#${edgeId})` : undefined}>
      {/* bottleItems 为固定像素比例（自然高约195），按包围盒高等比缩放以免溢出/压到来源戳 */}
      <g transform={form === 'bottle' ? `scale(${(h / 195).toFixed(4)})` : undefined}>
        <MaterialLayer items={medItems(form, 0, 0, w, h, c, shadeC)} material={{kind: 'paper', shadow, shadowOpacity: 0.16}} palette={PALETTE} />
      </g>
    </g>
  </svg>
);