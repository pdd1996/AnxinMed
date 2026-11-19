// CardFlock.tsx — copy 自 video-shotcraft demos/transition/card-flock-tumble/CardFlockTumble.tsx，改皮到纸感。
// 保留的调校参数：Catmull-Rom 样条位姿插值（u<0.55 分段）+ out cubic；侧棱 ry≈88° 薄边起手；
// 站定后慢转不停（ry +0.34°/f，平方缓入衔接）；收束 10f ease-in(quad) 吸入中心、透明度前 55% 满格；
// 吸入到点同一帧闪核（6f 衰减）；落定重量靠回弹+接触影+knock 木音。
// 改皮：aurora 霓虹暗场 → 暖纸亮场；3 张 UI 页卡 → 8 盒剪纸药盒（BOX_LAYOUT 身份色，数量守恒 8→8）；
// 原 demo 烟雾环删除（用户反馈：multiply 墨环在暖纸上读作脏烟圈，违反 Q4；落定冲击改由回弹/接触影/木音承担）；
// 闪核去掉全屏微曝层（只留局部径向核，保住 R4 整画面冲击名额）；巨字 CINEMATIC → Scene2 的 COPY.s2cap 字幕（不在本组件内）。
import React from 'react';
import {AbsoluteFill, Easing, interpolate} from 'remotion';
import {COLOR} from '../spec';
import {BOX_LAYOUT, MED_FORMS, MedForm} from '../lib/film';
import {alpha} from './polish';
import {PaperBox} from './PaperBox';
import {FLOCK_C} from './timeline';

const FLIGHT: [number, number] = [0, 42];
const CARD_OUT: [number, number] = [47, 57];
const RING_T0 = 57;
const BW = 190, BH = 137;

type Pose = {x: number; y: number; rx: number; ry: number; rz: number; s: number};
const POSE_KEYS: (keyof Pose)[] = ['x', 'y', 'rx', 'ry', 'rz', 's'];

const catmull = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};
const splinePose = (keys: Pose[], u: number): Pose => {
  const seg = u < 0.55 ? 0 : 1;
  const lt = seg === 0 ? u / 0.55 : (u - 0.55) / 0.45;
  const out = {} as Pose;
  for (const k of POSE_KEYS) {
    out[k] = catmull(keys[Math.max(0, seg - 1)][k], keys[seg][k], keys[seg + 1][k], keys[Math.min(2, seg + 2)][k], lt);
  }
  return out;
};
const lerpPose = (a: Pose, b: Pose, t: number): Pose => {
  const out = {} as Pose;
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
};

// 8 盒：k0 侧棱薄边（散开）→ k1 翻飞中段 → k2 扇形阶梯站定；conv 吸入药箱中心
const BOXES: {c: number; shadeC: number; form: MedForm; k: [Pose, Pose, Pose]; conv: Pose}[] = BOX_LAYOUT.map((b, i) => {
  // 站定间距 200 > 盒宽 190 → 8 盒水平完全分离可数；±46 双排错开给景深（用户反馈：原 135 间距挤叠不可数）
  const sx = (i - 3.5) * 200, sy = i % 2 ? 46 : -46;
  return {
    c: b.c, shadeC: b.shadeC, form: MED_FORMS[i],
    k: [
      {x: sx * 1.7, y: i % 2 ? 150 : -150, rx: 9, ry: 88, rz: 12, s: 0.92},
      {x: sx * 1.25, y: i % 2 ? 60 : -60, rx: 14, ry: 42, rz: -7, s: 1.04},
      {x: sx, y: sy, rx: 3, ry: i % 2 ? 11 : 13, rz: i % 2 ? -2 : 2, s: 1.0},
    ],
    conv: {x: sx * 0.06, y: 0, rx: 0, ry: 55, rz: 4, s: 0.12},
  };
});

const idleAt = (f: number) => {
  const t = Math.min(f, CARD_OUT[0]) - FLIGHT[1] * 0.86;
  if (t <= 0) return {ry: 0, rx: 0, rz: 0};
  const r = Math.min(1, t / 14) ** 2;
  return {ry: t * 0.34 * r, rx: t * -0.1 * r, rz: t * 0.05 * r};
};

// 闪核（局部）：吸入到点同一帧的暖白核，6f 衰减；不做全屏微曝（R4）
const CoreFlash: React.FC<{f: number}> = ({f}) => {
  const t = f - RING_T0;
  if (t < -1 || t > 14) return null;
  const a = t < 0 ? 0.4 : Math.exp(-t / 3.2);
  return (
    <div style={{
      position: 'absolute', left: FLOCK_C.x - 420, top: FLOCK_C.y - 420, width: 840, height: 840, borderRadius: '50%',
      pointerEvents: 'none', mixBlendMode: 'screen',
      background: `radial-gradient(circle, rgba(255,250,240,${a.toFixed(3)}) 0%, rgba(255,244,224,${(0.85 * a).toFixed(3)}) 9%, ${alpha(COLOR.orange, 0.3 * a)} 22%, ${alpha(COLOR.card, 0.18 * a)} 44%, ${alpha(COLOR.card, 0)} 70%)`,
    }} />
  );
};

export const CardFlock: React.FC<{t: number}> = ({t}) => {
  const f = (t - 7) * 30;
  return (
    <AbsoluteFill>
      {f < CARD_OUT[1] + 2 && (
        <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', perspective: 1400}}>
          {BOXES.map((c, i) => {
            let pose: Pose;
            let op = 1;
            const drift = idleAt(f);
            if (f < FLIGHT[0]) {
              pose = c.k[0];
            } else if (f < CARD_OUT[0]) {
              const raw = Math.min(1, (f - FLIGHT[0]) / (FLIGHT[1] - FLIGHT[0]));
              pose = splinePose(c.k, Easing.out(Easing.cubic)(raw));
              pose = {...pose, ry: pose.ry + drift.ry, rx: pose.rx + drift.rx, rz: pose.rz + drift.rz};
            } else {
              const r = Math.min(1, (f - CARD_OUT[0]) / (CARD_OUT[1] - CARD_OUT[0]));
              const e = Easing.in(Easing.quad)(r);
              const from = {...c.k[2], ry: c.k[2].ry + drift.ry, rx: c.k[2].rx + drift.rx, rz: c.k[2].rz + drift.rz};
              pose = lerpPose(from, c.conv, e);
              op = 1 - Easing.in(Easing.cubic)(Math.max(0, (r - 0.55) / 0.45));
            }
            return (
              <div key={i} style={{
                position: 'absolute', opacity: op, zIndex: 10 + i,
                transform: `translate3d(${pose.x.toFixed(2)}px, ${pose.y.toFixed(2)}px, 0) rotateX(${pose.rx.toFixed(2)}deg) rotateY(${pose.ry.toFixed(2)}deg) rotateZ(${pose.rz.toFixed(2)}deg) scale(${pose.s.toFixed(4)})`,
              }}>
                <PaperBox w={BW} h={BH} c={c.c} shadeC={c.shadeC} edgeId={`flock-${i}`} form={c.form} />
              </div>
            );
          })}
        </AbsoluteFill>
      )}
      <CoreFlash f={f} />
    </AbsoluteFill>
  );
};