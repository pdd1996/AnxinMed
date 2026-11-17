// Scene05 — 效期：药盒效期标签逐字印出 → 提醒卡升起，90 天窗口条走满。
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Canvas, EASE, InkFilter, Letters, MaterialLayer, prog, roughFor} from '../lib/motion';
import {PALETTE, rectPts} from '../lib/film';
import {toPath} from '../lib/motion';
import {COLOR, COPY, FONT, FONT_SANS, T, WIPE} from '../spec';
import {Item} from '../lib/motion';

const BOX_ITEMS: Item[] = [
  {d: toPath(rectPts(740, 490, 300, 210)), c: 4},
  {d: toPath(rectPts(740, 490 - 105 + 19, 300, 38)), c: 9},
  {d: toPath(rectPts(740, 500, 258, 72)), c: 2},
];

export const Scene05: React.FC<{t: number}> = ({t}) => {
  if (t < T.s5 || t >= 25 + WIPE) return null;
  const labelP = prog(t, T.label5, 1.25, EASE.inOut);
  const cardP = prog(t, T.card5, 0.5, EASE.out);
  const barP = prog(t, T.card5, 1.25, EASE.linear);
  return (
    <>
      <Canvas>
        <InkFilter id="s5-edge" edge={roughFor(300)} grain={0.3} seed={15} />
        <g filter="url(#s5-edge)">
          <MaterialLayer items={BOX_ITEMS} material={{kind: 'paper', shadow: 7, shadowOpacity: 0.16}} palette={PALETTE} />
        </g>
      </Canvas>
      <div style={{position: 'absolute', left: 611, top: 464, width: 258, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT_SANS, fontSize: 24, fontWeight: 700, color: COLOR.ink, clipPath: `inset(0 ${(1 - labelP) * 100}% 0 0)`, opacity: labelP > 0 ? 1 : 0}}>
        {COPY.s5label}
      </div>
      <div style={{position: 'absolute', left: 1150, top: 380, width: 560, height: 240, background: COLOR.card, border: `2px solid ${COLOR.ink}`, borderRadius: 12, boxShadow: '8px 8px 0 rgba(62,54,44,0.16)', transform: `translateY(${(1 - cardP) * 80}px)`, opacity: cardP > 0 ? 1 : 0, fontFamily: FONT_SANS, boxSizing: 'border-box', padding: '24px 40px'}}>
        <span style={{background: COLOR.orange, color: COLOR.card, fontSize: 22, fontWeight: 700, padding: '4px 12px', borderRadius: 4}}>{COPY.s5stamp}</span>
        <div style={{fontFamily: FONT, fontSize: 44, fontWeight: 900, color: COLOR.ink, marginTop: 16}}>{COPY.s5card}</div>
        <div style={{position: 'relative', width: 480, height: 10, background: COLOR.line, borderRadius: 5, marginTop: 26}}>
          <div style={{position: 'absolute', left: 0, top: 0, height: 10, width: 480 * barP, background: COLOR.orange, borderRadius: 5}} />
          {[0, 160, 320, 478].map((x) => (
            <div key={x} style={{position: 'absolute', left: x, top: -3, width: 2, height: 16, background: COLOR.ink, opacity: 0.4}} />
          ))}
        </div>
        <div style={{display: 'flex', justifyContent: 'space-between', width: 480, marginTop: 10, fontSize: 20, color: COLOR.ink, opacity: 0.55}}>
          <span>{COPY.s5bar[0]}</span><span>{COPY.s5bar[1]}</span>
        </div>
      </div>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-start', paddingTop: 880}}>
        <Letters text={COPY.s5cap} t={t} start={T.cap5} stagger={0.04} dur={0.4}
          box={{fontSize: 44, fontWeight: 500, fontFamily: FONT_SANS, color: COLOR.ink}}
          style={(p) => ({transform: `translateY(${(1 - p) * 24}px)`, opacity: p > 0 ? 1 : 0})} />
      </AbsoluteFill>
    </>
  );
};