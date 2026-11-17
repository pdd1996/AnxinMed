// Scene5.tsx — S5 效期（20–25s）。复用 v1 Scene05 元素（橙盒 + 效期标签 + 提醒卡 + 90 天窗口条），升级：
// ① 标签逐字「印出」：每字 scale 1.4→1 + 硬显影（盖章感，错峰 0.07s），不是匀速擦入；
// ② 提醒卡 slam（22.0：ease-in 硬着陆 + 元素层微震 3px 衰减）；
// ③ 窗口条加速走满（EASE.in 指数加速，22.25–23.5），走满后到切点 ≥0.8s 静止（R2）。
// 字高升级（Q11）：标签 24→34、卡标题 44→48、窗口标注 20→32、字幕 44→60、类目戳 22→28。
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Canvas, EASE, InkFilter, Letters, MaterialLayer, prog, roughFor, toPath} from '../lib/motion';
import type {Item} from '../lib/motion';
import {PALETTE, rectPts} from '../lib/film';
import {COLOR, COPY, FONT, FONT_SANS} from '../spec';
import {T2} from './timeline';

const BOX_ITEMS: Item[] = [
  {d: toPath(rectPts(700, 480, 360, 252)), c: 4},
  {d: toPath(rectPts(700, 480 - 126 + 23, 360, 46)), c: 9},
  {d: toPath(rectPts(700, 492, 316, 84)), c: 2},
];

const CARD = {left: 1150, top: 356, w: 560, h: 264};

// slam 微震：振幅 3px、周期 0.12s、τ 0.08s（只作用卡片元素层）
const shakeAt = (t: number) => {
  const dt = t - T2.card5;
  return dt >= 0 && dt < 0.3 ? 3 * Math.cos((2 * Math.PI * dt) / 0.12) * Math.exp(-dt / 0.08) : 0;
};

export const Scene5: React.FC<{t: number}> = ({t}) => {
  if (t < T2.s5 || t >= 25) return null;
  const boxP = prog(t, T2.s5, 0.35, EASE.out);
  const cardP = prog(t, T2.card5, 0.18, EASE.in); // 硬加速下落，0.18s 着陆
  const barP = prog(t, T2.bar5, T2.barDur, EASE.in); // 加速走满
  const capP = prog(t, T2.cap5, 0.35, EASE.out);
  const shake = shakeAt(t);
  return (
    <AbsoluteFill>
      <Canvas>
        <InkFilter id="s5v2-edge" edge={roughFor(360)} grain={0.3} seed={15} />
        <g filter="url(#s5v2-edge)" opacity={boxP} transform={`translate(0 ${((1 - boxP) * 30).toFixed(1)})`}>
          <MaterialLayer items={BOX_ITEMS} material={{kind: 'paper', shadow: 7, shadowOpacity: 0.16}} palette={PALETTE} />
        </g>
      </Canvas>
      {/* 效期标签：逐字印出（每字盖章式显影） */}
      <div style={{position: 'absolute', left: 542, top: 450, width: 316, height: 84, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <Letters
          text={COPY.s5label} t={t} start={T2.label5} stagger={0.07} dur={0.22} ease={EASE.snap}
          box={{fontFamily: FONT_SANS, fontSize: 36, fontWeight: 700, color: COLOR.ink, letterSpacing: '-0.01em', whiteSpace: 'pre'}}
          style={(p) => ({opacity: Math.min(1, p * 2), transform: `scale(${(1.4 - 0.4 * p).toFixed(3)})`})}
        />
      </div>
      {/* 提醒卡 slam */}
      <div style={{
        position: 'absolute', left: CARD.left, top: CARD.top, width: CARD.w, height: CARD.h,
        background: COLOR.card, border: `2px solid ${COLOR.ink}`, borderRadius: 14,
        boxShadow: '9px 9px 0 rgba(62,54,44,0.16)', boxSizing: 'border-box', padding: '24px 40px',
        fontFamily: FONT_SANS, opacity: cardP > 0 ? 1 : 0,
        transform: `translate(${shake.toFixed(2)}px, ${((1 - cardP) * -90).toFixed(1)}px) scale(${(1 + 0.05 * (1 - cardP)).toFixed(4)})`,
      }}>
        <span style={{background: COLOR.orange, color: COLOR.card, fontSize: 36, fontWeight: 700, padding: '5px 14px', borderRadius: 6}}>{COPY.s5stamp}</span>
        <div style={{fontFamily: FONT, fontSize: 48, fontWeight: 900, color: COLOR.ink, marginTop: 14}}>{COPY.s5card}</div>
        <div style={{position: 'relative', width: 480, height: 12, background: COLOR.line, borderRadius: 6, marginTop: 22}}>
          <div style={{position: 'absolute', left: 0, top: 0, height: 12, width: Math.max(0, 480 * barP), background: COLOR.orange, borderRadius: 6}} />
          {[0, 160, 320, 478].map((x) => (
            <div key={x} style={{position: 'absolute', left: x, top: -3, width: 2, height: 18, background: COLOR.ink, opacity: 0.4}} />
          ))}
        </div>
        <div style={{display: 'flex', justifyContent: 'space-between', width: 480, marginTop: 10, fontSize: 36, color: COLOR.ink, opacity: 0.55}}>
          <span>{COPY.s5bar[0]}</span><span>{COPY.s5bar[1]}</span>
        </div>
      </div>
      {/* 字幕 60px（Q11） */}
      <div style={{position: 'absolute', left: 0, right: 0, top: 880, display: 'flex', justifyContent: 'center'}}>
        <Letters
          text={COPY.s5cap} t={t} start={T2.cap5} stagger={0.035} dur={0.35} ease={EASE.out}
          style={(p) => ({fontFamily: FONT, fontSize: 60, fontWeight: 700, color: COLOR.ink, opacity: p, transform: `translateY(${(1 - p) * 22}px)`})}
          box={{opacity: capP > 0 ? 1 : 0}}
        />
      </div>
    </AbsoluteFill>
  );
};