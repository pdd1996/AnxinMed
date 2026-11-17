// PaperBox.tsx — v2 共享件：把 lib/film 的 medBoxItems 包成可放进 CSS 3D 的纸盒元素。
// SVG 矢量（任意 scale 锐利，Q2 无需位图栅格化链路）；paper 材质 = 实色 + 硬偏移投影。
import React from 'react';
import {InkFilter, MaterialLayer, roughFor} from '../lib/motion';
import {PALETTE, medBoxItems} from '../lib/film';

export const PaperBox: React.FC<{
  w: number; h: number; c: number; shadeC: number; edgeId?: string; shadow?: number;
}> = ({w, h, c, shadeC, edgeId, shadow = 6}) => (
  <svg width={w + 24} height={h + 24} viewBox={`${-w / 2 - 12} ${-h / 2 - 12} ${w + 24} ${h + 24}`}
    style={{display: 'block', overflow: 'visible'}}>
    {edgeId && <InkFilter id={edgeId} edge={roughFor(w)} grain={0.3} seed={21} />}
    <g filter={edgeId ? `url(#${edgeId})` : undefined}>
      <MaterialLayer items={medBoxItems(0, 0, w, h, c, shadeC)} material={{kind: 'paper', shadow, shadowOpacity: 0.16}} palette={PALETTE} />
    </g>
  </svg>
);