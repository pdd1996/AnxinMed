// Scene04v2 — 样片·新版冲突。shotcraft: crash-zoom-punch（推近+命中顿挫）
// + riso-print-hits（纸墨套印错位→硬切套准+盖章）。本地时间 0–5s。
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Canvas, EASE, MaterialLayer, mix, prog, settle} from '../lib/motion';
import {ANCHOR, COLOR, COPY, FILM, FONT_SANS} from '../spec';
import {PALETTE, bottleItems, boxItems} from '../lib/film';

const MEET = 1.0, HIT = 1.4, REG = 2.6;

export const Scene04v2: React.FC<{t: number}> = ({t}) => {
  if (t < 0 || t >= 5) return null;
  const q = prog(t, 0, MEET, EASE.inOut);
  const lx = mix(430, 840, q), rx = mix(1490, 1080, q);
  // 推近：猛推后气垫回落
  const cam = mix(1, 1.14, prog(t, 0, 0.3, EASE.in)) - 0.08 * prog(t, 0.3, 0.6, EASE.out);
  // 命中顿挫（1.2% 衰减震荡）
  const ht = t - MEET;
  const shake = ht > 0 && ht < 0.4 ? Math.cos(ht * 70) * Math.exp(-ht * 12) * 14 : 0;
  // 套印错位包络：A·cos·exp，REG 硬切归零
  const rt = t - HIT;
  const off = t >= HIT && t < REG ? 20 * Math.cos((2 * Math.PI * rt) / 0.6) * Math.exp(-rt / 0.45) : 0;
  const badgeIn = settle(t, FILM.fps, HIT, {lead: 0.27, dur: 0.27, bounce: 0});
  const regPulse = t >= REG ? 1 + 0.03 * (1 - prog(t, REG, 0.13)) : 1;
  const stamp = settle(t, FILM.fps, REG, {lead: 0.02, dur: 0.3, bounce: 0.4});
  const cardP = prog(t, REG, 0.5, EASE.out);
  const plate = (color: string, dx: number, dy: number, key: string) => (
    <g key={key} transform={`translate(${960 + dx} ${300 + dy})`} style={{mixBlendMode: 'multiply'}}>
      <circle r={70} fill={color} />
      <text y={11} textAnchor="middle" fontSize={30} fontWeight={700} fontFamily={FONT_SANS} fill={color}>{COPY.s4badge}</text>
    </g>
  );
  return (
    <AbsoluteFill style={{transform: `translate(${shake}px, ${shake * 0.4}px) scale(${cam})`, transformOrigin: '960px 500px'}}>
      <Canvas>
        {/* 瓶 + 速度拖影 */}
        {[0.06, 0.12].map((d, k) => t < MEET && (
          <g key={k} opacity={0.12 - k * 0.05} transform={`translate(${mix(430, 840, prog(t, 0, MEET - d, EASE.inOut))} 500)`}>
            <MaterialLayer items={bottleItems(0, 0, 0, 1, '')} material={{kind: 'flat'}} palette={PALETTE} />
          </g>
        ))}
        <g transform={`translate(${lx} 500)`}><MaterialLayer items={bottleItems(0, 0, 0, 1, COPY.s4a)} material={{kind: 'paper', shadow: 6, shadowOpacity: 0.16}} palette={PALETTE} /></g>
        <g transform={`translate(${rx} 500)`}><MaterialLayer items={bottleItems(0, 0, 7, 8, COPY.s4b)} material={{kind: 'paper', shadow: 6, shadowOpacity: 0.16}} palette={PALETTE} /></g>
        {/* 套印双版 → 硬切套准 */}
        {t >= HIT && t < REG && badgeIn > 0 && (
          <g transform={`translate(960 300) scale(${badgeIn}) translate(-960 -300)`}>
            {plate(COLOR.green, off, off * 0.3, 'g')}
            {plate(COLOR.orange, -off, -off * 0.3, 'o')}
          </g>
        )}
        {t >= REG && (
          <g transform={`translate(960 300) scale(${regPulse})`}>
            <circle r={70} fill={COLOR.red} />
            <circle r={60} fill="none" stroke={COLOR.card} strokeWidth={2} strokeOpacity={0.6} />
            <text y={11} textAnchor="middle" fontSize={30} fontWeight={700} fontFamily={FONT_SANS} fill={COLOR.card}>{COPY.s4badge}</text>
          </g>
        )}
        {t >= REG && stamp > 0 && (
          <g transform={`translate(1030 350) scale(${mix(1.5, 1, stamp)})`} opacity={stamp}>
            <circle r={26} fill={COLOR.card} stroke={COLOR.red} strokeWidth={3} />
            <text y={8} textAnchor="middle" fontSize={22} fontWeight={700} fontFamily={FONT_SANS} fill={COLOR.red}>核对</text>
          </g>
        )}
        <g transform={`translate(${ANCHOR.x} ${ANCHOR.y}) scale(${ANCHOR.s})`}><MaterialLayer items={boxItems(0, 0, 1)} material={{kind: 'paper', shadow: 8, shadowOpacity: 0.16}} palette={PALETTE} /></g>
      </Canvas>
      <div style={{position: 'absolute', left: 920, top: 620, width: 80, textAlign: 'center', fontFamily: FONT_SANS, fontSize: 22, color: COLOR.ink, opacity: t >= MEET ? 0.5 : 0}}>{COPY.s4eg}</div>
      <div style={{position: 'absolute', left: 600, top: 680, width: 720, height: 110, background: COLOR.card, border: `2px solid ${COLOR.ink}`, borderRadius: 12, boxShadow: '8px 8px 0 rgba(62,54,44,0.16)', clipPath: `inset(0 0 ${(1 - cardP) * 100}% 0)`, opacity: cardP > 0 ? 1 : 0, display: 'flex', alignItems: 'center', fontFamily: FONT_SANS, boxSizing: 'border-box', overflow: 'hidden'}}>
        <div style={{width: 6, alignSelf: 'stretch', background: COLOR.red, flexShrink: 0}} />
        <div style={{flex: 1, textAlign: 'center', fontSize: 34, fontWeight: 500, color: COLOR.ink}}>{COPY.s4card}</div>
      </div>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-start', paddingTop: 880}}>
        <div style={{fontFamily: FONT_SANS, fontSize: 44, fontWeight: 500, color: COLOR.ink, opacity: prog(t, 3.2, 0.3), transform: `translateY(${(1 - prog(t, 3.2, 0.4, EASE.out)) * 24}px)`}}>{COPY.s4cap}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};