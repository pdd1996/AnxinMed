// Scene4.tsx — S4 冲突（15–20s）。主角 = riso-print-hits 裂版套准（P4：riso 只在本镜头主演一次）。
// 结构：crash-zoom 推近（整画面冲击#1，15.0s，14f 1.3→1 + 方向性拖影）
//      → 两瓶相遇顿挫（15.5–16.5：接近 72% → 迟疑 0.18s → 最后 28% snap 合拢）
//      → 警示章 slam（17.0 = local f60）→ 绿×橙双版 multiply 错位震荡 44f（AX14/AY6，周期 18f，τ60f）
//      → f104（18.4667s）硬切套准 + 4f scale 1.03→1 脉冲 + 「核对」圆章盖下
//      → 核对卡（18.6）→ 字幕（18.8，60px）。
// 改皮自 demos/effects/riso-print-hits/RisoMisregistrationHit.tsx：荧光粉×蓝 → 品牌墨绿×暖橙；
// 300px 海报标题 → 320×130 警示章。裂版期白字「相互作用」单独一层保持套准可读（选择记录见 DESIGN-NOTES）。
// demo 的整页 1.2% 顿挫 kick 弃用：本镜头整画面名额已给 crash-zoom，震荡只作用印章元素层（R4）。
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Canvas, EASE, Letters, MaterialLayer, mix, prog} from '../lib/motion';
import {PALETTE, bottleItems} from '../lib/film';
import {COLOR, COPY, FONT, FONT_SANS} from '../spec';
import {EASE as PE, SpeedBlur, ramp, velocity} from './polish';
import {T2} from './timeline';

const HIT = 60, SNAP = 104;           // 命中 / 套准帧（local）
const AX = 14, AY = 6;                // 单版错位振幅（两版反向 → 总分离 ~28px）
const OMEGA = (2 * Math.PI) / 18;     // 震荡周期 18f
const TAU = 60;                       // 衰减 τ：f104 前仍余可见残差，被硬切归零
const SEAL = {cx: 960, cy: 285, w: 320, h: 130};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// crash-zoom：整画面 1.3→1，14f snappy 落定（冲击#1）
const camAt = (f: number) => mix(1.3, 1, ramp(f, 0, 14, PE.out));

// 两瓶相遇顿挫：接近 → 迟疑 → 合拢
const meetQ = (t: number) => {
  const u = t - T2.bottles;
  if (u <= 0) return 0;
  if (u < 0.6) return 0.72 * EASE.inOut(u / 0.6);
  if (u < 0.78) return 0.72;
  return 0.72 + 0.28 * EASE.snap((u - 0.78) / 0.22);
};

// 套准十字（印刷对位标）：静止布景，绿版一色
const RegMark: React.FC<{x: number; y: number; o: number}> = ({x, y, o}) => (
  <svg width={36} height={36} viewBox="0 0 36 36" style={{position: 'absolute', left: x - 18, top: y - 18, opacity: o}}>
    <g fill="none" stroke={COLOR.green} strokeWidth={1.6} opacity={0.55}>
      <circle cx={18} cy={18} r={8} />
      <path d="M18 1 V35 M1 18 H35" />
    </g>
  </svg>
);

// 单色印版：同形圆角章，可调色可错位，multiply 叠到纸上
const Plate: React.FC<{color: string; dx: number; dy: number}> = ({color, dx, dy}) => (
  <svg width={SEAL.w} height={SEAL.h} viewBox={`0 0 ${SEAL.w} ${SEAL.h}`} style={{
    position: 'absolute', inset: 0, overflow: 'visible',
    transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`, mixBlendMode: 'multiply',
  }}>
    <rect x={0} y={0} width={SEAL.w} height={SEAL.h} rx={18} fill={color} />
  </svg>
);

export const Scene4: React.FC<{t: number}> = ({t}) => {
  if (t < T2.s4 || t >= 20) return null;
  const f = (t - T2.s4) * 30;
  const cam = camAt(f);
  const vx = f < 18 ? -velocity(camAt, f) * 960 : 0;

  const q = meetQ(t);
  const lx = mix(480, 840, q), rx = mix(1440, 1080, q);
  const squash = t >= T2.meet && t < T2.meet + 0.3 ? 1 - 0.05 * Math.exp(-(t - T2.meet) / 0.08) : 1;

  // 警示章 slam：f60 起 4f 由 1.6 加速压到 1（ease-in quad，硬着陆）
  const sp = clamp01((f - HIT) / 4);
  const slamS = f < HIT ? 1.6 : 1.6 - 0.6 * sp * sp;
  const slamO = f < HIT ? 0 : Math.min(1, sp * 3);
  // 裂版震荡：命中同帧裂开，f104 硬切归零
  const split = f >= HIT && f < SNAP;
  const tt = f - HIT;
  const m = split ? Math.cos(OMEGA * tt) * Math.exp(-tt / TAU) : 0;
  // 套准脉冲：f104 起 4f scale 1.03→1
  const pulse = f >= SNAP && f < SNAP + 4 ? 1 + 0.03 * (1 - (f - SNAP) / 4) : 1;
  // 「核对」圆章：f104 盖下，4f 1.5→1
  const kp = ramp(f, SNAP, 4, PE.out);
  const stampS = f < SNAP ? 1.5 : mix(1.5, 1, kp);
  const stampO = f < SNAP ? 0 : Math.min(1, kp * 2.5);

  const cardP = prog(t, T2.card4, 0.3, EASE.out);
  const capP = prog(t, T2.cap4, 0.35, EASE.out);
  const regO = ramp(f, 0, 10, PE.out) * 0.9;

  const world = (
    <AbsoluteFill>
      <RegMark x={110} y={110} o={regO} />
      <RegMark x={1810} y={110} o={regO} />
      <RegMark x={110} y={970} o={regO} />
      <RegMark x={1810} y={970} o={regO} />
      <Canvas>
        <g transform={`translate(${lx.toFixed(2)} 500) scale(1 ${squash.toFixed(4)})`}>
          <MaterialLayer items={bottleItems(0, 0, 0, 1, COPY.s4a)} material={{kind: 'paper', shadow: 6, shadowOpacity: 0.16}} palette={PALETTE} />
        </g>
        <g transform={`translate(${rx.toFixed(2)} 500) scale(1 ${squash.toFixed(4)})`}>
          <MaterialLayer items={bottleItems(0, 0, 7, 8, COPY.s4b)} material={{kind: 'paper', shadow: 6, shadowOpacity: 0.16}} palette={PALETTE} />
        </g>
      </Canvas>
      <div style={{position: 'absolute', left: 900, top: 606, width: 120, textAlign: 'center', fontFamily: FONT_SANS, fontSize: 36, color: COLOR.ink, opacity: t >= T2.meet ? 0.5 : 0}}>{COPY.s4eg}</div>

      {/* 警示章：双版 multiply + 白字套准层 + 套准脉冲 */}
      {f >= HIT && (
        <div style={{
          position: 'absolute', left: SEAL.cx - SEAL.w / 2, top: SEAL.cy - SEAL.h / 2, width: SEAL.w, height: SEAL.h,
          opacity: slamO, transform: `scale(${(slamS * pulse).toFixed(4)})`, transformOrigin: '50% 50%',
        }}>
          <Plate color={COLOR.green} dx={-AX * m} dy={AY * m} />
          <Plate color={COLOR.orange} dx={AX * m} dy={-AY * m} />
          {/* 白字始终套准：裂版期可读（Q11：56px × scale ≥ 56） */}
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: FONT_SANS, fontSize: 56, fontWeight: 700, color: COLOR.card, letterSpacing: '0.06em',
          }}>{COPY.s4badge}</div>
        </div>
      )}
      {/* 「核对」圆章：套准同一帧盖下 */}
      {stampO > 0 && (
        <svg width={160} height={160} viewBox="-80 -80 160 160" style={{
          position: 'absolute', left: 1215 - 80, top: SEAL.cy - 80, opacity: stampO,
          transform: `rotate(-12deg) scale(${stampS.toFixed(4)})`, transformOrigin: '50% 50%',
        }}>
          <g fill="none" stroke={COLOR.green}>
            <circle r={62} strokeWidth={5} />
            <circle r={50} strokeWidth={2.5} opacity={0.7} />
          </g>
          <text y={14} textAnchor="middle" fontSize={40} fontWeight={700} fontFamily={FONT_SANS} fill={COLOR.green}>核对</text>
        </svg>
      )}

      {/* 规则库核对卡 */}
      <div style={{
        position: 'absolute', left: 600, top: 680, width: 720, height: 110, background: COLOR.card,
        border: `2px solid ${COLOR.ink}`, borderRadius: 12, boxShadow: '8px 8px 0 rgba(62,54,44,0.16)',
        opacity: cardP > 0 ? 1 : 0, transform: `translateY(${((1 - cardP) * -30).toFixed(1)}px)`,
        display: 'flex', alignItems: 'center', fontFamily: FONT_SANS, boxSizing: 'border-box', overflow: 'hidden',
      }}>
        <div style={{width: 6, alignSelf: 'stretch', background: COLOR.red, flexShrink: 0}} />
        <div style={{flex: 1, textAlign: 'center', fontSize: 36, fontWeight: 500, color: COLOR.ink}}>{COPY.s4card}</div>
      </div>
      {/* 字幕 60px（Q11） */}
      <div style={{position: 'absolute', left: 0, right: 0, top: 880, display: 'flex', justifyContent: 'center'}}>
        <Letters
          text={COPY.s4cap} t={t} start={T2.cap4} stagger={0.035} dur={0.35} ease={EASE.out}
          style={(p) => ({fontFamily: FONT, fontSize: 60, fontWeight: 700, color: COLOR.ink, opacity: p, transform: `translateY(${(1 - p) * 22}px)`})}
          box={{opacity: capP > 0 ? 1 : 0}}
        />
      </div>
    </AbsoluteFill>
  );

  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <div style={{position: 'absolute', inset: 0, transform: `scale(${cam.toFixed(5)})`, transformOrigin: '50% 50%'}}>
        {f < 18 ? <SpeedBlur vx={vx} amount={0.15} max={14}>{world}</SpeedBlur> : world}
      </div>
      {/* 命中顿挫只给印章层（slamS），不做整页 kick —— R4 名额已给 crash-zoom */}
    </AbsoluteFill>
  );
};