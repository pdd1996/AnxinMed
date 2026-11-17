// Scene02v2 — 样片·新版录入汇聚。shotcraft: scan-bracket-sweep（5 趟往复光带+拖尾+括号错峰）
// + card-flock-tumble 纸感版（3D 翻飞→慢转→收束吸入药箱+墨点环）。本地时间 0–5s。
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Canvas, Counter, EASE, InkFilter, MaterialLayer, mix, prog, settle} from '../lib/motion';
import {BOX_HOME, COLOR, COPY, FILM, FONT, FONT_SANS} from '../spec';
import {BOX_LAYOUT, PALETTE, SCAN_INDEX, boxItems, medBoxItems} from '../lib/film';

const SCAN0 = 0.5, SCAN1 = 2.6, PASSES = 5;
const FLOCK = 2.8, SUCK = 3.9, LAND = 4.2;
const sine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;

export const Scene02v2: React.FC<{t: number}> = ({t}) => {
  if (t < 0 || t >= 5) return null;
  const doc = BOX_LAYOUT[SCAN_INDEX];
  const pop = prog(t, 0, 0.35, EASE.out);
  const docScale = mix(0.86, 1, pop);
  // 扫描光带：5 趟，趟内 inOutSine + 末尾 12% 停顿
  const sw = prog(t, SCAN0, SCAN1 - SCAN0, EASE.linear);
  const pass = Math.min(PASSES - 1, Math.floor(sw * PASSES));
  const localRaw = sw * PASSES - pass;
  const local = Math.min(1, localRaw / 0.88);
  const dir = pass % 2 === 0 ? 1 : -1;
  const scanY = dir === 1 ? mix(-doc.h / 2, doc.h / 2, sine(local)) : mix(doc.h / 2, -doc.h / 2, sine(local));
  const scanning = t >= SCAN0 && t <= SCAN1;
  const speed = Math.abs(Math.sin(Math.PI * local));
  const tail = 82 * speed;
  // 汇聚质量（收束吸入）
  const suckP = prog(t, SUCK, LAND - SUCK, EASE.in);
  const grow = Math.sqrt(suckP);
  const land = 1 + 0.05 * (1 - settle(t, FILM.fps, LAND, {lead: 0.1, dur: 0.4, bounce: 0.3}));
  const ring = prog(t, LAND, 0.6, EASE.out);
  return (
    <>
      {/* 3D 翻飞盒群 */}
      <AbsoluteFill style={{perspective: 1400}}>
        {BOX_LAYOUT.map((b, i) => {
          const isDoc = i === SCAN_INDEX;
          const bx = isDoc ? BOX_HOME.x : b.x, by = isDoc ? BOX_HOME.y : b.y;
          let x = bx, y = by, sc = isDoc ? docScale : 1, rx = 0, ry = 0, op = isDoc ? 1 : 0.25;
          if (t >= FLOCK && t < SUCK) {
            const q = prog(t, FLOCK + i * 0.05, 0.5, EASE.out);
            ry = mix(88, 0, q) + (t - FLOCK - 0.5) * 6;
            rx = mix(24, 0, q);
            op = isDoc ? 1 : mix(0.25, 1, q);
            y = by - Math.sin(q * Math.PI) * 40;
          } else if (t >= SUCK) {
            if (suckP >= 1) return null;
            x = mix(bx, BOX_HOME.x, suckP); y = mix(by, BOX_HOME.y, suckP);
            sc = mix(1, 0.08, suckP); op = suckP < 0.6 ? 1 : 1 - (suckP - 0.6) / 0.4;
            ry = (t - FLOCK - 0.5) * 6;
          }
          return (
            <div key={i} style={{position: 'absolute', left: x - b.w / 2, top: y - b.h / 2, width: b.w, height: b.h, opacity: op, transform: `rotateX(${rx}deg) rotateY(${ry}deg) scale(${sc})`, transformStyle: 'preserve-3d'}}>
              <svg width={b.w} height={b.h} viewBox={`${-b.w / 2} ${-b.h / 2} ${b.w} ${b.h}`} style={{overflow: 'visible'}}>
                <MaterialLayer items={medBoxItems(0, 0, b.w, b.h, b.c, b.shadeC)} material={{kind: 'paper', shadow: 6, shadowOpacity: 0.16}} palette={PALETTE} />
              </svg>
            </div>
          );
        })}
      </AbsoluteFill>
      {/* 取景括号 + 扫描光带（裁在文档 bbox 内） */}
      {t < FLOCK && (
        <div style={{position: 'absolute', left: BOX_HOME.x - doc.w / 2 - 14, top: BOX_HOME.y - doc.h / 2 - 14, width: doc.w + 28, height: doc.h + 28}}>
          <svg width={doc.w + 28} height={doc.h + 28} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
            {[[0, 0, 1, 1], [doc.w + 28, 0, -1, 1], [doc.w + 28, doc.h + 28, -1, -1], [0, doc.h + 28, 1, -1]].map(([cx, cy, sx, sy], i) => {
              const bp = settle(t, FILM.fps, SCAN0 + i * 0.07, {lead: 0.02, dur: 0.18, bounce: 0.5});
              const d = `M${cx + sx * 34} ${cy} L${cx} ${cy} L${cx} ${cy + sy * 34}`;
              return <path key={i} d={d} stroke={COLOR.ink} strokeWidth={4} fill="none" strokeLinecap="round" opacity={bp} transform={`translate(${(1 - bp) * sx * -8} ${(1 - bp) * sy * -8})`} />;
            })}
          </svg>
          {scanning && (
            <div style={{position: 'absolute', left: 14, top: 14, width: doc.w, height: doc.h, overflow: 'hidden', borderRadius: 10}}>
              <div style={{position: 'absolute', left: 0, top: doc.h / 2 + scanY - (dir === 1 ? tail : 0), width: doc.w, height: tail, background: `linear-gradient(${dir === 1 ? 'to top' : 'to bottom'}, rgba(224,138,60,0.28), rgba(224,138,60,0))`, mixBlendMode: 'multiply'}} />
              <div style={{position: 'absolute', left: 0, top: doc.h / 2 + scanY - 1.5, width: doc.w, height: 3, background: COLOR.orange, boxShadow: '0 0 10px 2px rgba(224,138,60,0.5)'}} />
            </div>
          )}
        </div>
      )}
      {/* 身份字段 */}
      {COPY.fields.map(([k, v], i) => {
        const pin = prog(t, 1.0 + i * 0.25, 0.3, EASE.out);
        const pout = prog(t, FLOCK, 0.3, EASE.in);
        return (
          <div key={k} style={{position: 'absolute', left: 1250, top: 400 + i * 92, width: 390, height: 78, background: COLOR.card, border: `2px solid ${COLOR.line}`, borderRadius: 8, boxShadow: '5px 5px 0 rgba(62,54,44,0.12)', transform: `translate(${pout * 700}px, ${(1 - pin) * 30}px)`, opacity: pin > 0 ? 1 : 0, padding: '8px 20px', fontFamily: FONT_SANS, boxSizing: 'border-box'}}>
            <div style={{fontSize: 22, fontWeight: 500, color: COLOR.ink, opacity: 0.55}}>{k}</div>
            <div style={{fontSize: 30, fontWeight: 700, color: COLOR.ink, marginTop: 2}}>{v}</div>
          </div>
        );
      })}
      {/* 药箱接收 + 墨点环 */}
      {grow > 0.001 && (
        <Canvas>
          <InkFilter id="v2-ring" edge={14} grain={0.5} seed={9} />
          {ring > 0 && ring < 1 && <circle cx={BOX_HOME.x} cy={BOX_HOME.y} r={60 + ring * 260} fill="none" stroke={COLOR.ink} strokeWidth={10 * (1 - ring)} strokeOpacity={0.3 * (1 - ring)} filter="url(#v2-ring)" />}
          <g transform={`translate(${BOX_HOME.x} ${BOX_HOME.y}) scale(${grow * land})`}>
            <MaterialLayer items={boxItems(0, 0, 1)} material={{kind: 'paper', shadow: 8, shadowOpacity: 0.16}} palette={PALETTE} />
          </g>
        </Canvas>
      )}
      <div style={{position: 'absolute', top: 688, width: '100%', textAlign: 'center', fontFamily: FONT_SANS, fontSize: 34, fontWeight: 700, color: COLOR.ink, opacity: suckP > 0 ? 1 : 0}}>
        <Counter from={0} to={8} p={suckP} suffix={COPY.boxCountSuffix} />
      </div>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'flex-start', paddingTop: 856}}>
        <div style={{fontFamily: FONT, fontSize: 56, fontWeight: 600, color: COLOR.green, opacity: prog(t, LAND, 0.3), transform: `translateY(${(1 - prog(t, LAND, 0.4, EASE.out)) * 30}px)`}}>{COPY.s2cap}</div>
      </AbsoluteFill>
    </>
  );
};