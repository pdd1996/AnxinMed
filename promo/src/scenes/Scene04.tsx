// Scene04 — 冲突：两瓶药靠近相遇 → 警示章盖下（settle 落拍）→ 规则库核对卡展开。
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Canvas, EASE, Letters, MaterialLayer, mix, prog, settle, wobble} from '../lib/motion';
import {PALETTE, bottleItems} from '../lib/film';
import {COLOR, COPY, FILM, FONT_SANS, T, WIPE} from '../spec';

export const Scene04: React.FC<{t: number}> = ({t}) => {
  if (t < T.s4 || t >= 20 + WIPE) return null;
  const q = prog(t, T.bottles, 1.25, EASE.inOut);
  const lx = mix(480, 840, q), rx = mix(1440, 1080, q);
  const badgeS = settle(t, FILM.fps, T.badge, {bounce: 0.3, lead: 0.05, dur: 0.4});
  const cardP = prog(t, T.badge, 0.5, EASE.out);
  const wob = t > T.meet ? wobble('b4', 0, t, 0.5) * 1.2 : 0;
  return (
    <>
      <Canvas>
        <g transform={`translate(${lx} ${500 + wob})`}>
          <MaterialLayer items={bottleItems(0, 0, 0, 1, COPY.s4a)} material={{kind: 'paper', shadow: 6, shadowOpacity: 0.16}} palette={PALETTE} />
        </g>
        <g transform={`translate(${rx} ${500 - wob})`}>
          <MaterialLayer items={bottleItems(0, 0, 7, 8, COPY.s4b)} material={{kind: 'paper', shadow: 6, shadowOpacity: 0.16}} palette={PALETTE} />
        </g>
        {badgeS > 0 && (
          <g transform={`translate(960 300) scale(${badgeS})`}>
            <circle r={70} fill={COLOR.red} />
            <circle r={60} fill="none" stroke={COLOR.card} strokeWidth={2} strokeOpacity={0.6} />
            <text y={11} textAnchor="middle" fontSize={30} fontWeight={700} fontFamily={FONT_SANS} fill={COLOR.card}>{COPY.s4badge}</text>
          </g>
        )}
      </Canvas>
      <div style={{position: 'absolute', left: 920, top: 620, width: 80, textAlign: 'center', fontFamily: FONT_SANS, fontSize: 22, color: COLOR.ink, opacity: t >= T.meet ? 0.5 : 0}}>{COPY.s4eg}</div>
      <div style={{position: 'absolute', left: 600, top: 680, width: 720, height: 110, background: COLOR.card, border: `2px solid ${COLOR.ink}`, borderRadius: 12, boxShadow: '8px 8px 0 rgba(62,54,44,0.16)', clipPath: `inset(0 0 ${(1 - cardP) * 100}% 0)`, opacity: cardP > 0 ? 1 : 0, display: 'flex', alignItems: 'center', fontFamily: FONT_SANS, boxSizing: 'border-box', overflow: 'hidden'}}>
        <div style={{width: 6, alignSelf: 'stretch', background: COLOR.red, flexShrink: 0}} />
        <div style={{flex: 1, textAlign: 'center', fontSize: 34, fontWeight: 500, color: COLOR.ink}}>{COPY.s4card}</div>
      </div>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-start', paddingTop: 880}}>
        <Letters text={COPY.s4cap} t={t} start={T.cap4} stagger={0.04} dur={0.4}
          box={{fontSize: 44, fontWeight: 500, fontFamily: FONT_SANS, color: COLOR.ink}}
          style={(p) => ({transform: `translateY(${(1 - p) * 24}px)`, opacity: p > 0 ? 1 : 0})} />
      </AbsoluteFill>
    </>
  );
};