// Scene06 — 落版：药箱回中央（持久层），品牌名 + 口号 + 功能行，29.5s 后全静。
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {EASE, Letters, prog} from '../lib/motion';
import {COLOR, COPY, FILM, FONT, FONT_SANS, T} from '../spec';

export const Scene06: React.FC<{t: number}> = ({t}) => {
  if (t < T.s6 || t >= FILM.duration) return null;
  const fp = prog(t, T.features, 0.5, EASE.out);
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-start', paddingTop: 150}}>
      <Letters text={COPY.s6title} t={t} start={T.logo} stagger={0.08} dur={0.5}
        box={{fontSize: 150, fontWeight: 900, fontFamily: FONT, color: COLOR.ink, letterSpacing: '0.04em', lineHeight: 1.1}}
        style={(p) => ({transform: `translateY(${(1 - p) * 80}px)`, clipPath: 'inset(-25% -5% 0 -5%)', opacity: p > 0 ? 1 : 0})} />
      <div style={{marginTop: 36}}>
        <Letters text={COPY.s6slogan} t={t} start={T.slogan} stagger={0.04} dur={0.4}
          box={{fontSize: 52, fontWeight: 600, fontFamily: FONT, color: COLOR.green}}
          style={(p) => ({transform: `translateY(${(1 - p) * 30}px)`, opacity: p > 0 ? 1 : 0})} />
      </div>
      <div style={{marginTop: 28, fontFamily: FONT_SANS, fontSize: 34, fontWeight: 500, color: COLOR.ink, opacity: fp * 0.7, transform: `translateY(${(1 - fp) * 20}px)`}}>
        {COPY.s6features}
      </div>
    </AbsoluteFill>
  );
};