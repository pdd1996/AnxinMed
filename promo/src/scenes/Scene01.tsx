// Scene01 — 问题：一天 8 种药，3 个来源。8 盒剪纸药盒分三组散落，轻微呼吸感。
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Canvas, EASE, InkFilter, Letters, MaterialLayer, drawOn, line, prog, roughFor, toPath, wobble} from '../lib/motion';
import {BOX_LAYOUT, PALETTE, medBoxItems} from '../lib/film';
import {COLOR, COPY, FONT, FONT_SANS, T, WIPE} from '../spec';

const STAMPS = [{x: 545, y: 352}, {x: 965, y: 347}, {x: 1397, y: 362}];

export const Scene01: React.FC<{t: number}> = ({t}) => {
  if (t >= 5 + WIPE) return null;
  return (
    <>
      <Canvas>
        <InkFilter id="s1-edge" edge={roughFor(160)} grain={0.3} seed={11} />
        {BOX_LAYOUT.map((b, i) => {
          const p = prog(t, 0.125 + i * 0.125, 0.5, EASE.out);
          const wx = wobble('bx', i, t, 0.4) * 1.5, wy = wobble('by', i, t, 0.4) * 1.5;
          return (
            <g key={i} transform={`translate(${b.x + wx} ${b.y + (1 - p) * 80 + wy})`} filter="url(#s1-edge)">
              <MaterialLayer items={medBoxItems(0, 0, b.w, b.h, b.c, b.shadeC)} material={{kind: 'paper', shadow: 6, shadowOpacity: 0.16}} palette={PALETTE} />
            </g>
          );
        })}
        {STAMPS.map((s, g) => {
          const d = toPath(line(s.x - 45, s.y + 36, s.x + 45, s.y + 36), false);
          return <path key={g} d={d} stroke={COLOR.ink} strokeOpacity={0.4} strokeWidth={3} fill="none" {...drawOn(d, prog(t, 0.75 + g * 0.25, 0.4, EASE.out))} />;
        })}
      </Canvas>
      {STAMPS.map((s, g) => {
        const p = prog(t, 0.625 + g * 0.25, 0.375, EASE.out);
        return (
          <div key={g} style={{position: 'absolute', left: s.x - 60, top: s.y, width: 120, textAlign: 'center', fontFamily: FONT_SANS, fontSize: 26, fontWeight: 700, letterSpacing: '0.3em', color: COLOR.ink, opacity: p > 0 ? 0.7 : 0, transform: `translateY(${(1 - p) * 16}px)`}}>
            {COPY.sources[g]}
          </div>
        );
      })}
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-start', paddingTop: 128}}>
        <Letters text={COPY.s1a} t={t} start={T.headline} stagger={0.05} dur={0.45}
          box={{fontSize: 84, fontWeight: 900, fontFamily: FONT, color: COLOR.ink, letterSpacing: '0.02em', lineHeight: 1.15}}
          style={(p) => ({transform: `translateY(${(1 - p) * 70}px)`, clipPath: 'inset(-25% -5% 0 -5%)', opacity: p > 0 ? 1 : 0})} />
      </AbsoluteFill>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-start', paddingTop: 268}}>
        <Letters text={COPY.s1b} t={t} start={T.sub} stagger={0.04} dur={0.4}
          box={{fontSize: 44, fontWeight: 500, fontFamily: FONT_SANS, color: COLOR.ink, lineHeight: 1.2}}
          style={(p) => ({transform: `translateY(${(1 - p) * 30}px)`, opacity: p * 0.75})} />
      </AbsoluteFill>
    </>
  );
};