// Scene03 — 依从：今日服药清单 UI，三行按拍打勾，计数器 0/3 → 3/3。
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Counter, EASE, Letters, drawOn, prog} from '../lib/motion';
import {checkD} from '../lib/film';
import {COLOR, COPY, FONT, FONT_SANS, T, WIPE} from '../spec';

export const Scene03: React.FC<{t: number}> = ({t}) => {
  if (t < T.s3 || t >= 15 + WIPE) return null;
  const cardP = prog(t, T.card3, 0.5, EASE.out);
  return (
    <>
      <div style={{position: 'absolute', left: 700, top: 300, width: 760, height: 420, background: COLOR.card, border: `2px solid ${COLOR.ink}`, borderRadius: 12, boxShadow: '8px 8px 0 rgba(62,54,44,0.16)', transform: `translateX(${(1 - cardP) * 1000}px)`, opacity: cardP > 0 ? 1 : 0, fontFamily: FONT_SANS, boxSizing: 'border-box', padding: '26px 40px'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
          <span style={{background: COLOR.green, color: COLOR.card, fontSize: 22, fontWeight: 700, padding: '4px 12px', borderRadius: 4}}>{COPY.s3stamp}</span>
          <span style={{fontFamily: FONT, fontSize: 44, fontWeight: 600, color: COLOR.ink}}>{COPY.s3title}</span>
          <span style={{flex: 1}} />
          <span style={{fontSize: 24, fontWeight: 500, color: COLOR.ink, opacity: 0.55}}>{COPY.s3done} </span>
          <Counter from={0} to={COPY.s3items.length} p={prog(t, T.ticks[0], 1.25, EASE.snap)} style={{fontSize: 40, fontWeight: 700, color: COLOR.green}} />
          <span style={{fontSize: 28, color: COLOR.ink, opacity: 0.6}}>/{COPY.s3items.length}</span>
        </div>
        {COPY.s3items.map(([name, dose], i) => {
          const rp = prog(t, T.card3 + 0.25 + i * 0.125, 0.375, EASE.out);
          const tickP = prog(t, T.ticks[i], 0.25, EASE.out);
          return (
            <div key={name} style={{display: 'flex', alignItems: 'center', gap: 20, height: 96, borderTop: i > 0 ? `1px solid ${COLOR.line}` : 'none', marginTop: i === 0 ? 20 : 0, transform: `translateY(${(1 - rp) * 24}px)`, opacity: rp > 0 ? 1 : 0}}>
              <span style={{position: 'relative', width: 40, height: 40, border: `2px solid ${COLOR.ink}`, borderRadius: 8, flexShrink: 0, boxSizing: 'border-box'}}>
                <svg width={40} height={40} style={{position: 'absolute', left: -2, top: -2}}>
                  <path d={checkD(20, 21)} stroke={COLOR.green} strokeWidth={5} strokeLinecap="round" fill="none" {...drawOn(checkD(20, 21), tickP)} />
                </svg>
              </span>
              <span style={{fontSize: 34, fontWeight: 700, color: COLOR.ink, opacity: 1 - 0.45 * prog(t, T.ticks[i], 0.3)}}>{name}</span>
              <span style={{marginLeft: 'auto', fontSize: 26, fontWeight: 400, color: COLOR.ink, opacity: 0.6}}>{dose}</span>
            </div>
          );
        })}
      </div>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-start', paddingTop: 880}}>
        <Letters text={COPY.s3cap} t={t} start={T.cap3} stagger={0.04} dur={0.4}
          box={{fontSize: 44, fontWeight: 500, fontFamily: FONT_SANS, color: COLOR.ink}}
          style={(p) => ({transform: `translateY(${(1 - p) * 24}px)`, opacity: p > 0 ? 1 : 0})} />
      </AbsoluteFill>
    </>
  );
};