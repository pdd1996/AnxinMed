// Scene6.tsx — S6 落版（25–30s）。主角 = drone-dive-landing 俯冲落定（P4：只在本镜头主演一次；整画面冲击#2）。
// copy 自 demos/camera/space-camera-moves/DroneDiveLanding.tsx，改皮：
// 暗场 dashboard → 暖纸点阵地面 + 墨绿药箱（BOX_END 960,660 s0.8）；三轴联动同一条行程 p：
// 预备上提 2.5%（f4–15）→ 俯冲 82% 行程 ease-in(cubic)（f15–38）→ 气垫长尾 out(poly5)（f38–45，26.5s 落定）。
// 悬停高度 lift=150(1-p)^1.4 + 同形接触影随降落收紧；CameraMotionBlur shutter 200 / samples 8。
// 落定后屏幕空间品牌层：字标 slam（26.5）→ 口号（27.0）→ 功能行（27.2667）
// → Q8 合影：药盒/药瓶/清单卡/警示章四代表从四角飞入围住字标（26.6667–27.77，间隔 0.3→0.25→0.2 加速）
// → 28.0 起全静 hold 2s（R1 ≥1s ✓）。
// 注意：DiveWorld 内部用 useCurrentFrame（CameraMotionBlur 的 Freeze 只冻结 hook，不更新父传 prop）。
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {CameraMotionBlur} from '@remotion/motion-blur';
import {Canvas, EASE, InkFilter, Letters, MaterialLayer, mix, prog, roughFor} from '../lib/motion';
import {PALETTE, bottleItems, boxItems, checkD} from '../lib/film';
import {COLOR, COPY, FONT, FONT_SANS} from '../spec';
import {EASE as PE, alpha, ramp} from './polish';
import {PaperBox} from './PaperBox';
import {T2} from './timeline';

const DIVE_START = 15, DIVE_END = 38, LAND_END = 45; // 落定 f45 = 26.5s
const DIVE_SHARE = 0.82, PRE_LIFT = 0.025;
const BOX_C = {x: 960, y: 660}; // = spec.BOX_END

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const travel = (frame: number) => {
  const pre = -PRE_LIFT * ramp(frame, 4, DIVE_START - 4, PE.smooth);
  if (frame < DIVE_START) return pre;
  if (frame < DIVE_END) {
    return interpolate(frame, [DIVE_START, DIVE_END], [-PRE_LIFT, DIVE_SHARE], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic),
    });
  }
  return DIVE_SHARE + interpolate(frame, [DIVE_END, LAND_END], [0, 1 - DIVE_SHARE], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.poly(5)),
  });
};

// 点阵地面：暖纸上的墨点，径向渐隐（俯冲时向镜头涌来 = 速度参照）
const FLOOR = {x: -2400, y: -1500, w: 6720, h: 3300};
const floorStyle: React.CSSProperties = {
  position: 'absolute', left: FLOOR.x, top: FLOOR.y, width: FLOOR.w, height: FLOOR.h,
  backgroundImage: `radial-gradient(circle at 3px 3px, ${alpha(COLOR.ink, 0.2)} 2.2px, ${alpha(COLOR.ink, 0)} 3.2px)`,
  backgroundSize: '48px 48px',
  backgroundPosition: `${(-FLOOR.x) % 48}px ${(-FLOOR.y) % 48}px`,
  WebkitMaskImage: `radial-gradient(ellipse ${FLOOR.w * 0.36}px ${FLOOR.h * 0.42}px at ${-FLOOR.x + BOX_C.x}px ${-FLOOR.y + BOX_C.y}px, #000 30%, transparent 100%)`,
  maskImage: `radial-gradient(ellipse ${FLOOR.w * 0.36}px ${FLOOR.h * 0.42}px at ${-FLOOR.x + BOX_C.x}px ${-FLOOR.y + BOX_C.y}px, #000 30%, transparent 100%)`,
};

const DiveWorld: React.FC = () => {
  const frame = useCurrentFrame();
  const p = travel(frame);
  const rotX = mix(72, 0, p);
  const scale = mix(0.42, 1, p);
  const ty = mix(540 - BOX_C.y, 0, p);
  const lift = 150 * Math.pow(1 - clamp01(p), 1.4);
  const shOff = lift * 0.22;
  const shBlur = 18 + lift * 0.42;
  const shOp = interpolate(p, [0, 0.9, 1], [0.18, 0.12, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{perspective: 1400, overflow: 'hidden'}}>
      <div style={{
        position: 'absolute', width: 1920, height: 1080,
        transformOrigin: `${BOX_C.x}px ${BOX_C.y}px`,
        transform: `translate(0px, ${ty.toFixed(2)}px) rotateX(${rotX.toFixed(3)}deg) scale(${scale.toFixed(5)})`,
        transformStyle: 'preserve-3d',
      }}>
        <div style={{...floorStyle, opacity: 1 - 0.45 * clamp01(p)}} />
        {/* 接触影：药箱同形椭圆，随降落收紧变实 */}
        <div style={{
          position: 'absolute', left: BOX_C.x - 170, top: BOX_C.y + 96, width: 340, height: 52,
          borderRadius: '50%', background: COLOR.ink, opacity: shOp,
          filter: `blur(${shBlur.toFixed(1)}px)`,
          transform: `translate3d(${(shOff * 0.5).toFixed(1)}px, ${shOff.toFixed(1)}px, 1px) scale(${(1 + lift * 0.0004).toFixed(4)})`,
        }} />
        {/* 药箱本体：悬停 lift 高度，气垫段末尾触地 */}
        <div style={{position: 'absolute', inset: 0, transform: `translateZ(${lift.toFixed(2)}px)`}}>
          <Canvas>
            <InkFilter id="s6v2-box-edge" edge={roughFor(360)} grain={0.25} seed={5} />
            <g transform={`translate(${BOX_C.x} ${BOX_C.y})`} filter="url(#s6v2-box-edge)">
              <MaterialLayer items={boxItems(0, 0, 0.8)} material={{kind: 'paper', shadow: 8, shadowOpacity: 0.16}} palette={PALETTE} />
            </g>
          </Canvas>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── Q8 合影四代表（围住字标的真实槽位，落定后不悬浮漂移） ──
const SLOTS = [
  {x: 470, y: 215, from: [-380, -260], rot: -10, start: 25 + 20 / 30},        // 药盒 ← 左上
  {x: 1450, y: 215, from: [380, -260], rot: 10, start: 25 + 29 / 30},         // 药瓶 ← 右上
  {x: 470, y: 445, from: [-380, 260], rot: 8, start: 25 + 36.5 / 30},         // 清单卡 ← 左下
  {x: 1450, y: 445, from: [380, 260], rot: -8, start: 25 + 42.5 / 30},        // 警示章 ← 右下
];

const RepBox: React.FC = () => <PaperBox w={130} h={94} c={0} shadeC={1} edgeId="s6v2-repbox" />;
const RepBottle: React.FC = () => (
  <svg width={110} height={150} viewBox="-80 -125 160 215" style={{display: 'block', overflow: 'visible'}}>
    <MaterialLayer items={bottleItems(0, 0, 7, 8, '')} material={{kind: 'paper', shadow: 5, shadowOpacity: 0.16}} palette={PALETTE} />
  </svg>
);
const RepList: React.FC = () => (
  <div style={{
    width: 170, height: 112, background: COLOR.card, border: `2px solid ${COLOR.ink}`, borderRadius: 10,
    boxShadow: `5px 5px 0 ${alpha(COLOR.ink, 0.16)}`, boxSizing: 'border-box', padding: '14px 16px',
  }}>
    <svg width={34} height={34} viewBox="0 0 34 34">
      <rect x={1} y={1} width={32} height={32} rx={7} fill="none" stroke={COLOR.ink} strokeWidth={2.5} />
      <path d={checkD(17, 18, 0.85)} stroke={COLOR.green} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
    <div style={{height: 8, width: 118, background: COLOR.line, borderRadius: 4, marginTop: 10}} />
    <div style={{height: 8, width: 86, background: COLOR.line, borderRadius: 4, marginTop: 8}} />
  </div>
);
const RepSeal: React.FC = () => (
  <div style={{position: 'relative', width: 176, height: 66}}>
    <svg width={176} height={66} style={{position: 'absolute', inset: 0, mixBlendMode: 'multiply'}}>
      <rect width={176} height={66} rx={12} fill={COLOR.green} />
    </svg>
    <svg width={176} height={66} style={{position: 'absolute', inset: 0, mixBlendMode: 'multiply'}}>
      <rect width={176} height={66} rx={12} fill={COLOR.orange} />
    </svg>
    <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT_SANS, fontSize: 36, fontWeight: 700, color: COLOR.card, letterSpacing: '0.04em'}}>
      {COPY.s4badge}
    </div>
  </div>
);
const REPS = [RepBox, RepBottle, RepList, RepSeal];

export const Scene6: React.FC = () => {
  const frame = useCurrentFrame(); // Sequence from=750 → local 0..149
  const t = 25 + frame / 30;
  // 字标 slam：26.5 起 6f scale 1.12→1 + 3f 显影
  const lp = ramp(frame, 45, 6, PE.out);
  const lo = ramp(frame, 45, 3, PE.linear);
  const sloganP = prog(t, T2.slogan, 0.4, EASE.out);
  const featP = prog(t, T2.features, 0.4, EASE.out);
  // 落定后焦点：中心轻压暗（单点、暖墨色，非发光，Q4）
  const focus = ramp(frame, LAND_END - 6, 22, PE.out);
  return (
    <AbsoluteFill>
      {frame >= 4 && frame <= LAND_END ? (
        <CameraMotionBlur shutterAngle={200} samples={8}>
          <DiveWorld />
        </CameraMotionBlur>
      ) : (
        <DiveWorld />
      )}
      {focus > 0 && (
        <AbsoluteFill style={{
          pointerEvents: 'none', opacity: focus,
          background: `radial-gradient(900px 620px at 50% 42%, ${alpha(COLOR.ink, 0)} 48%, ${alpha(COLOR.ink, 0.1)} 100%)`,
        }} />
      )}
      {/* 品牌字标（hold ≥1s：28.0–30.0 全静） */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 128, display: 'flex', justifyContent: 'center',
        opacity: lo, transform: `scale(${(1.12 - 0.12 * lp).toFixed(4)})`, transformOrigin: '50% 50%',
      }}>
        <span style={{fontFamily: FONT, fontSize: 150, fontWeight: 900, color: COLOR.ink, letterSpacing: '0.04em', lineHeight: 1.1}}>{COPY.s6title}</span>
      </div>
      <div style={{position: 'absolute', left: 0, right: 0, top: 336, display: 'flex', justifyContent: 'center'}}>
        <Letters
          text={COPY.s6slogan} t={t} start={T2.slogan} stagger={0.04} dur={0.4} ease={EASE.out}
          style={(p) => ({fontFamily: FONT, fontSize: 60, fontWeight: 600, color: COLOR.green, opacity: p, transform: `translateY(${(1 - p) * 26}px)`})}
          box={{opacity: sloganP > 0 ? 1 : 0}}
        />
      </div>
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 428, textAlign: 'center',
        fontFamily: FONT_SANS, fontSize: 36, fontWeight: 500, color: COLOR.ink,
        opacity: featP * 0.7, transform: `translateY(${((1 - featP) * 18).toFixed(1)}px)`,
      }}>{COPY.s6features}</div>
      {/* Q8 合影：四方飞入，间隔加速（0.3→0.25→0.2），overshoot 落位后静止 */}
      {SLOTS.map((s, i) => {
        const p = prog(t, s.start, 0.35, PE.overshoot);
        if (p <= 0) return null;
        const Rep = REPS[i];
        return (
          <div key={i} style={{
            position: 'absolute', left: s.x, top: s.y, opacity: Math.min(1, p * 3),
            transform: `translate(-50%,-50%) translate(${(s.from[0] * (1 - p)).toFixed(1)}px, ${(s.from[1] * (1 - p)).toFixed(1)}px) rotate(${(s.rot * (1 - p)).toFixed(2)}deg) scale(${(0.7 + 0.3 * p).toFixed(3)})`,
          }}>
            <Rep />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};