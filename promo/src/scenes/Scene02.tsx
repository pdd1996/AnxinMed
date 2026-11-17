// Scene02 — 录入与汇聚：扫描一盒药（身份字段）→ 8 盒逐点汇聚进药箱（X01，数量守恒 8→8）。
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Canvas, Counter, EASE, InkFilter, Letters, MaterialLayer, converge, drawOn, line, mix, prog, roughFor, toPath} from '../lib/motion';
import {BOX_LAYOUT, PALETTE, SCAN_INDEX, boxParts, medBoxItems} from '../lib/film';
import {BOX_HOME, COLOR, COPY, FONT, FONT_SANS, T, WIPE} from '../spec';

const PARTS = boxParts();
const BRACKETS = [
  'M866 400 L830 400 L830 436', 'M1054 400 L1090 400 L1090 436',
  'M1090 564 L1090 600 L1054 600', 'M866 600 L830 600 L830 564',
];

export const Scene02: React.FC<{t: number}> = ({t}) => {
  if (t < T.s2 || t >= 10 + WIPE) return null;
  const {shapes} = converge(t, PARTS, [BOX_HOME.x, BOX_HOME.y]);
  const scanP = prog(t, T.scan, 0.5, EASE.out) * (1 - prog(t, T.converge, 0.375, EASE.in));
  const capOut = prog(t, T.converge, 0.375, EASE.in);
  return (
    <>
      <Canvas>
        <InkFilter id="s2-edge" edge={roughFor(160)} grain={0.3} seed={12} />
        {BOX_LAYOUT.map((b, i) => {
          const p = prog(t, T.arrivals[i] - 0.5, 0.5, EASE.in);
          let tx = b.x, ty = b.y, k = 1, op = 1;
          if (t < T.converge) {
            if (i === SCAN_INDEX) {
              const q = prog(t, T.s2, WIPE, EASE.inOut);
              tx = mix(b.x, BOX_HOME.x, q); ty = mix(b.y, BOX_HOME.y, q);
            } else {
              op = mix(1, 0.25, prog(t, T.s2, 0.5));
            }
          } else {
            const sh = shapes[i];
            if (!sh) return null;
            tx = sh.reduce((s, pt) => s + pt[0], 0) / sh.length;
            ty = sh.reduce((s, pt) => s + pt[1], 0) / sh.length;
            k = 1 - 0.92 * p;
            op = i === SCAN_INDEX ? 1 : mix(0.25, 1, Math.min(1, p * 3));
          }
          return (
            <g key={i} transform={`translate(${tx} ${ty}) scale(${k})`} opacity={op} filter="url(#s2-edge)">
              <MaterialLayer items={medBoxItems(0, 0, b.w, b.h, b.c, b.shadeC)} material={{kind: 'paper', shadow: 6, shadowOpacity: 0.16}} palette={PALETTE} />
            </g>
          );
        })}
        {scanP > 0 && BRACKETS.map((d, i) => (
          <path key={i} d={d} stroke={COLOR.ink} strokeWidth={5} fill="none" {...drawOn(d, scanP)} />
        ))}
        {t >= 5.875 && t <= 6.875 && (
          <path d={toPath(line(838, mix(408, 592, prog(t, 5.875, 1, EASE.linear)), 1082, mix(408, 592, prog(t, 5.875, 1, EASE.linear))), false)}
            stroke={COLOR.orange} strokeWidth={4} strokeOpacity={0.85} fill="none" />
        )}
      </Canvas>
      {COPY.fields.map(([k, v], i) => {
        const pin = prog(t, T.fields[i], 0.375, EASE.out);
        const pout = prog(t, T.converge, 0.5, EASE.in);
        return (
          <div key={k} style={{position: 'absolute', left: 1250, top: 400 + i * 92, width: 390, height: 78, background: COLOR.card, border: `2px solid ${COLOR.line}`, borderRadius: 8, boxShadow: '5px 5px 0 rgba(62,54,44,0.12)', transform: `translate(${pout * 700}px, ${(1 - pin) * 30}px)`, opacity: pin > 0 ? 1 : 0, padding: '8px 20px', fontFamily: FONT_SANS, boxSizing: 'border-box'}}>
            <div style={{fontSize: 22, fontWeight: 500, color: COLOR.ink, opacity: 0.55}}>{k}</div>
            <div style={{fontSize: 30, fontWeight: 700, color: COLOR.ink, marginTop: 2}}>{v}</div>
          </div>
        );
      })}
      {t < T.converge + 0.375 && (
        <AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-start', paddingTop: 880, transform: `translateY(${capOut * 80}px)`}}>
          <Letters text={COPY.s2scan} t={t} start={T.scan} stagger={0.04} dur={0.4}
            box={{fontSize: 44, fontWeight: 500, fontFamily: FONT_SANS, color: COLOR.ink}}
            style={(p) => ({transform: `translateY(${(1 - p) * 24}px)`, opacity: p > 0 ? 1 : 0})} />
        </AbsoluteFill>
      )}
      <div style={{position: 'absolute', top: 688, width: '100%', textAlign: 'center', fontFamily: FONT_SANS, fontSize: 34, fontWeight: 700, color: COLOR.ink, opacity: t >= T.arrivals[0] ? 1 : 0}}>
        <Counter from={0} to={8} p={prog(t, T.arrivals[0], 0.875, EASE.linear)} suffix={COPY.boxCountSuffix} />
      </div>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-start', paddingTop: 856}}>
        <Letters text={COPY.s2cap} t={t} start={T.cap2} stagger={0.04} dur={0.45}
          box={{fontSize: 56, fontWeight: 600, fontFamily: FONT, color: COLOR.green}}
          style={(p) => ({transform: `translateY(${(1 - p) * 30}px)`, opacity: p > 0 ? 1 : 0})} />
      </AbsoluteFill>
    </>
  );
};