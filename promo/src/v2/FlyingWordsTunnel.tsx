// FlyingWordsTunnel.tsx — copy 自 video-shotcraft demos/typography/flying-words/FlyingWords.tsx，改皮到暖纸色板。
// 保留的调校参数：P=4400 手算透视、z −7000→+3200、黄金角铺位、生命周期曲线 [0,1,0.5,0.2,0]、
// 远端雾 / 近端失焦、按屏幕速度的 6 层方向拖尾、±2.5° 周期滚转、CYCLES=2 整数圈。
// 改皮：深蓝夜 → 暖纸（透明底，垫在 S1 盒群巡览之下）；词表 = 药名 / 来源词；墨绿 / 暖橙低不透明度；
// 去掉电光蓝泛光（纸感禁发光），拖尾保留（是运动残影不是光效）；去掉 demo 前景字标（S1 有自己的 0x 字层）。
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {COLOR, FONT, FONT_SANS} from '../spec';
import {alpha} from './polish';

const D = 5; // 场景秒数（150f）
const CYCLES = 2;

// 词表：8 种药名 + 来源 / 概念词（全部来自本片语境，无 demo 品牌词）
const WORDS = ['阿托伐他汀', '二甲双胍', '氨氯地平', '华法林', '阿司匹林', '美托洛尔', '奥美拉唑', '氯吡格雷',
  '医院', '药店', '网购', '处方', '说明书', '用法用量', '相互作用', '有效期', '依从', '药箱'];
const N = WORDS.length;
const ACCENT = new Set([3, 8, 14, 15]); // 华法林 / 药店 / 相互作用 / 有效期 → 暖橙
const SERIF_IDX = new Set([1, 4, 9, 12, 16]);
const INKS = [COLOR.green, COLOR.ink, COLOR.green];
const OPACITY = 0.34; // 背景层整体压低，不遮前景（任务约束）

const P = 4400;
const Z0 = -7000;
const Z1 = 3200;
const CX = 960;
const CY = 540;

const rand = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const ITEMS = WORDS.map((w, i) => {
  const a = i * 2.39996 + rand(i * 7 + 1) * 0.8;
  const r = 330 + rand(i * 13 + 2) * 660;
  const accent = ACCENT.has(i);
  return {
    text: w, accent, serif: SERIF_IDX.has(i),
    size: 64 + rand(i + 3) * 56,
    color: accent ? COLOR.orange : INKS[Math.floor(rand(i + 5) * 3)],
    x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6, rz: (rand(i + 21) - 0.5) * 12, ph: i / N,
  };
});

const DUST = Array.from({length: 56}, (_, i) => {
  const a = i * 2.39996 + rand(i * 5 + 77) * 1.2;
  const r = 180 + rand(i * 3 + 91) * 1500;
  return {x: Math.cos(a) * r, y: Math.sin(a) * r * 0.62, ph: rand(i * 9 + 13), w: 1 + rand(i + 50) * 1.6};
});

const RINGS = Array.from({length: 10}, (_, k) => ({ph: k / 10}));

const OP = [0, 1, 0.5, 0.2, 0];
const OT = [0, 0.25, 0.6, 0.85, 1];
const curve = (u: number) => {
  for (let k = 0; k < 4; k++) {
    if (u <= OT[k + 1]) return OP[k] + ((OP[k + 1] - OP[k]) * (u - OT[k])) / (OT[k + 1] - OT[k]);
  }
  return 0;
};

const project = (x: number, y: number, u: number, roll: number, drift = true) => {
  const z = Z0 + (Z1 - Z0) * u;
  const d = drift ? 0.5 + u * 1.35 : 1;
  const s = P / (P - z);
  const c = Math.cos(roll), sn = Math.sin(roll);
  const rx = x * c - y * sn, ry = x * sn + y * c;
  return {sx: CX + rx * d * s, sy: CY + ry * d * s, s};
};

export const FlyingWordsTunnel: React.FC<{t: number}> = ({t}) => {
  const u0 = t / D;
  const roll = (2.5 * Math.PI / 180) * Math.sin(u0 * Math.PI * 2);
  const du = CYCLES / (D * 30);
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {/* ① 隧道壁（发丝环，浅褐线色） + ② 光速流线（墨色尘埃） */}
      <svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
        {RINGS.map((rg, k) => {
          const u = (u0 * CYCLES + rg.ph) % 1;
          const p = project(0, 0, u, roll, false);
          const rx = 1150 * p.s;
          const op = Math.min(1, u / 0.3) * (1 - Math.min(1, Math.max(0, (u - 0.55) / 0.3)));
          if (op <= 0.01) return null;
          return (
            <ellipse key={`r${k}`} cx={CX} cy={CY} rx={rx} ry={rx * 0.6} fill="none"
              stroke={COLOR.line} strokeOpacity={op * 0.5} strokeWidth={1 + p.s * 0.8}
              transform={`rotate(${(roll * 180) / Math.PI} ${CX} ${CY})`} />
          );
        })}
        {DUST.map((d, i) => {
          const u = (u0 * CYCLES + d.ph) % 1;
          const ua = Math.max(0, u - du * 2.6);
          const a = project(d.x, d.y, ua, roll);
          const b = project(d.x, d.y, u, roll);
          const op = curve(u) * 0.75 * OPACITY;
          if (op <= 0.01) return null;
          return (
            <line key={`d${i}`} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke={COLOR.ink} strokeOpacity={op}
              strokeWidth={d.w * Math.min(2.4, b.s)} strokeLinecap="round" />
          );
        })}
      </svg>

      {/* ③ 关键词：远端雾、中段清晰、近端方向拖尾 + 失焦（低不透明度背景层） */}
      {ITEMS.map((it, i) => {
        const u = (u0 * CYCLES + it.ph) % 1;
        const p = project(it.x, it.y, u, roll);
        const q = project(it.x, it.y, Math.max(0, u - du), roll);
        const vx = p.sx - q.sx, vy = p.sy - q.sy;
        const op = curve(u) * OPACITY;
        if (op <= 0.005) return null;
        const fog = u < 0.22 ? (1 - u / 0.22) * 2.2 : 0;
        const near = u > 0.86 ? (u - 0.86) * 60 : 0;
        const blur = fog + near;
        const sp = Math.hypot(vx, vy);
        const trail = sp > 6
          ? [1, 2, 3, 4, 5, 6].map((j) => {
            const k = (j / 6) * 0.9 / p.s;
            return `${(-vx * k).toFixed(1)}px ${(-vy * k).toFixed(1)}px ${(j * 0.8).toFixed(1)}px ${alpha(it.color, 0.2 - j * 0.026)}`;
          }).join(', ')
          : '';
        return (
          <div key={i} style={{
            position: 'absolute', left: p.sx, top: p.sy, whiteSpace: 'nowrap', lineHeight: 1,
            transform: `translate(-50%,-50%) scale(${p.s.toFixed(4)}) rotate(${it.rz + (roll * 180) / Math.PI}deg)`,
            fontFamily: it.serif ? FONT : FONT_SANS, fontWeight: it.serif ? 600 : 700, fontSize: it.size,
            letterSpacing: it.serif ? '0.02em' : '0.04em',
            color: it.color, opacity: op,
            textShadow: trail || undefined,
            filter: blur > 0.05 ? `blur(${(blur / Math.max(0.6, p.s)).toFixed(2)}px)` : undefined,
          }}>
            {it.text}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};