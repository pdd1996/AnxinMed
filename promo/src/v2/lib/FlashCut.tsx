// FlashCut.tsx — copy 自 video-shotcraft assets/lib/FlashCut.tsx（模板片同源组件）。
// 改皮：亮场色温对齐暖纸（#FFF8EB / #FFF4E0 本就是暖白，保留）；只在 S1→S2 切点用一次（R4 名额之一）。
import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';

/** Bright-field cut: a warm-white bloom that flashes over the hard cut. */
export const FlashCut: React.FC<{duration?: number}> = ({duration = 10}) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, duration * 0.4, duration], [0, 0.85, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        opacity: o,
        background: 'radial-gradient(ellipse at 50% 45%, rgba(255,248,235,0.98), rgba(255,244,224,0.55) 55%, transparent 80%)',
      }}
    />
  );
};