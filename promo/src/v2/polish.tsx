// polish.tsx — copy 自 video-shotcraft demos/_fixtures/Polish.tsx + Look.tsx（TextReveal/type/alpha/stagger）
// + Motion.tsx（DesignStage）+ assets/lib/helpers/rand.ts（mulberry32），按本项目需要裁剪。
// 改皮点：type() 的字体换成本片自托管的 Noto Serif SC / Noto Sans SC；其余缓动/质感参数原样保留。
// 全部是 props / frame 的纯函数，确定性渲染（无 Math.random / Date.now）。
import React from 'react';
import {useCurrentFrame, useVideoConfig, AbsoluteFill} from 'remotion';
import {FONT, FONT_SANS} from '../spec';

// ───────────────────────── 缓动（Polish.tsx 原样） ─────────────────────────
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export const bezier = (x1: number, y1: number, x2: number, y2: number) => {
  if (x1 === y1 && x2 === y2) return (t: number) => clamp01(t);
  const ax = 1 - 3 * x2 + 3 * x1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 1 - 3 * y2 + 3 * y1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  const solve = (x: number) => {
    let u = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(u) - x;
      if (Math.abs(err) < 1e-7) return u;
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0, hi = 1;
    u = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(u);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = u; else hi = u;
      u = (lo + hi) / 2;
    }
    return u;
  };
  return (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : sy(solve(t)));
};

export const EASE = {
  snappy: bezier(0.16, 1, 0.3, 1),
  out: bezier(0.22, 1, 0.36, 1),
  smooth: bezier(0.65, 0, 0.35, 1),
  swift: bezier(0.4, 0, 0.2, 1),
  exit: bezier(0.7, 0, 0.84, 0),
  anticip: bezier(0.5, -0.32, 0.25, 1),
  overshoot: bezier(0.34, 1.45, 0.64, 1),
  linear: (t: number) => clamp01(t),
};

export const ramp = (frame: number, start: number, dur: number, ease: (t: number) => number = EASE.snappy) =>
  ease(clamp01((frame - start) / Math.max(1e-6, dur)));

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export const velocity = (f: (frame: number) => number, frame: number) => f(frame + 0.5) - f(frame - 0.5);

// ───────────────────────── 字体（改皮：Noto） ─────────────────────────
export const tracking = (size: number, caps = false) => {
  const base = size >= 96 ? -0.04 : size >= 56 ? -0.03 : size >= 28 ? -0.02 : size >= 16 ? -0.008 : 0.01;
  return `${(base + (caps ? 0.03 : 0)).toFixed(3)}em`;
};

export const type = (size: number, weight = 650, opts: {caps?: boolean; serif?: boolean} = {}): React.CSSProperties => ({
  fontFamily: opts.serif ? FONT : FONT_SANS,
  fontSize: size,
  fontWeight: weight,
  letterSpacing: tracking(size, opts.caps),
  lineHeight: size >= 90 ? 0.94 : size >= 50 ? 1.05 : 1.3,
  textTransform: opts.caps ? 'uppercase' : undefined,
  fontVariantNumeric: 'tabular-nums',
});

// ───────────────────────── 表面材质（Polish.tsx 原样） ─────────────────────────
const rgb = (hex: string) => {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(f, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};
export const alpha = (hex: string, a: number) => `rgba(${rgb(hex)},${a})`;
const r1 = (x: number) => Math.round(x * 10) / 10;

export const softShadow = (elevation: number, opts: {color?: string; strength?: number} = {}) => {
  const e = Math.max(0, elevation);
  const c = rgb(opts.color ?? '#10121a');
  const s = opts.strength ?? 1;
  const contactA = (0.12 * s) / (1 + e / 24);
  const ambientA = (0.08 + (Math.min(e, 64) / 64) * 0.22) * s;
  return `0 ${r1(0.5 + e * 0.06)}px ${r1(1 + e * 0.18)}px rgba(${c},${contactA.toFixed(3)}), ` +
    `0 ${r1(e * 0.55)}px ${r1(e * 1.3)}px ${r1(-e * 0.22)}px rgba(${c},${ambientA.toFixed(3)})`;
};

// ───────────────────────── 叠层（Polish.tsx 原样） ─────────────────────────
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const grainCache = new Map<string, string>();
const grainTile = (variant: number, tile: number, freq: number) => {
  const key = `${variant}|${tile}|${freq}`;
  const hit = grainCache.get(key);
  if (hit) return hit;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}'>` +
    `<filter id='g' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='2' seed='${variant * 17 + 3}' stitchTiles='stitch'/>` +
    `<feColorMatrix type='matrix' values='0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 0 1'/>` +
    `<feComponentTransfer><feFuncR type='linear' slope='2.4' intercept='-0.7'/><feFuncG type='linear' slope='2.4' intercept='-0.7'/><feFuncB type='linear' slope='2.4' intercept='-0.7'/></feComponentTransfer></filter>` +
    `<rect width='100%' height='100%' filter='url(#g)'/></svg>`;
  const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  grainCache.set(key, url);
  return url;
};

export const Grain: React.FC<{
  opacity?: number; step?: number; scale?: number; freq?: number;
  blend?: React.CSSProperties['mixBlendMode']; style?: React.CSSProperties;
}> = ({opacity = 0.06, step = 2, scale = 1, freq = 0.85, blend = 'overlay', style}) => {
  const frame = useCurrentFrame();
  const k = Math.floor(frame / Math.max(1, step));
  const tile = 256;
  const ox = Math.floor(hash(k * 3 + 1) * tile);
  const oy = Math.floor(hash(k * 7 + 2) * tile);
  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', opacity, mixBlendMode: blend,
      backgroundImage: grainTile(k % 6, tile, freq), backgroundSize: `${tile * scale}px ${tile * scale}px`,
      backgroundPosition: `${ox}px ${oy}px`, ...style,
    }} />
  );
};

export const Vignette: React.FC<{
  strength?: number; inner?: number; color?: string; cx?: number; cy?: number; style?: React.CSSProperties;
}> = ({strength = 0.35, inner = 0.5, color = '#0b0c12', cx = 0.5, cy = 0.46, style}) => {
  const c = rgb(color);
  const mid = inner + (1 - inner) * 0.55;
  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
      background: `radial-gradient(ellipse 72% 72% at ${cx * 100}% ${cy * 100}%, rgba(${c},0) ${inner * 100}%, ` +
        `rgba(${c},${(strength * 0.32).toFixed(3)}) ${(mid * 100).toFixed(1)}%, rgba(${c},${strength.toFixed(3)}) 100%), ` +
        `radial-gradient(ellipse 100% 100% at ${cx * 100}% ${cy * 100}%, rgba(${c},0) 60%, rgba(${c},${(strength * 0.6).toFixed(3)}) 100%)`,
      ...style,
    }} />
  );
};

export const SpeedBlur: React.FC<{
  vx: number; vy?: number; amount?: number; max?: number; children: React.ReactNode; style?: React.CSSProperties;
}> = ({vx, vy = 0, amount = 0.45, max = 36, children, style}) => {
  const rid = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  const speed = Math.hypot(vx, vy);
  const sd = Math.min(max, speed * amount);
  const fill: React.CSSProperties = {position: 'absolute', inset: 0};
  if (sd < 0.35) return <div style={{...fill, ...style}}>{children}</div>;
  const deg = (Math.atan2(vy, vx) * 180) / Math.PI;
  const id = `speedblur-${rid}`;
  return (
    <div style={{...fill, ...style}}>
      <svg width={0} height={0} style={{position: 'absolute'}} aria-hidden>
        <filter id={id} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation={`${sd.toFixed(2)} 0`} edgeMode="none" />
        </filter>
      </svg>
      <div style={{...fill, transform: `rotate(${deg}deg)`, filter: `url(#${id})`}}>
        <div style={{...fill, transform: `rotate(${-deg}deg)`}}>{children}</div>
      </div>
    </div>
  );
};

// ───────────────────────── 错峰（Look.tsx 原样） ─────────────────────────
export const stagger = (i: number, n: number, span: number, ease: (t: number) => number = EASE.linear) =>
  n <= 1 ? 0 : ease(i / (n - 1)) * span;

// ───────────────────────── 文字揭示（Look.tsx TextReveal 原样） ─────────────────────────
type RevealVariant = 'rise' | 'blur' | 'drop' | 'scale' | 'track';

export const TextReveal: React.FC<{
  text: string; start?: number; by?: 'char' | 'word' | 'line'; variant?: RevealVariant;
  each?: number; gap?: number; ease?: (t: number) => number; style?: React.CSSProperties; unitStyle?: (i: number) => React.CSSProperties;
  out?: {start: number; dur?: number};
}> = ({text, start = 0, by = 'char', variant = 'rise', each = 18, gap, ease = EASE.snappy, style, unitStyle, out}) => {
  const frame = useCurrentFrame();
  const units = by === 'line' ? text.split('\n') : by === 'word' ? text.split(/(\s+)/) : Array.from(text);
  const g = gap ?? (by === 'char' ? 1.6 : by === 'word' ? 4 : 7);
  let k = 0;
  const outT = out ? clamp01((frame - out.start) / (out.dur ?? 12)) : 0;
  const outE = EASE.exit(outT);
  return (
    <span style={{display: by === 'line' ? 'block' : 'inline', whiteSpace: 'pre', ...style}}>
      {units.map((u, i) => {
        if (by !== 'line' && /^\s+$/.test(u)) return <span key={i}>{u}</span>;
        const idx = k++;
        const p = ease(clamp01((frame - start - idx * g) / each));
        const inner: React.CSSProperties = {display: 'inline-block', willChange: 'transform'};
        if (variant === 'rise') {
          inner.transform = `translateY(calc(${((1 - p) * 105 - outE * 105).toFixed(2)}% + ${((1 - p) * 0.3 - outE * 0.3).toFixed(3)}em))`;
        } else if (variant === 'blur') {
          inner.opacity = p * (1 - outE);
          inner.filter = `blur(${((1 - p) * 14 + outE * 10).toFixed(2)}px)`;
          inner.transform = `translateY(${((1 - p) * 0.25 - outE * 0.15).toFixed(3)}em)`;
        } else if (variant === 'drop') {
          const s = clamp01((frame - start - idx * g) / each);
          inner.opacity = clamp01(s * 3) * (1 - outE);
          inner.transform = `translateY(${((1 - EASE.overshoot(s)) * -0.6).toFixed(3)}em)`;
        } else if (variant === 'scale') {
          inner.opacity = clamp01(p * 2) * (1 - outE);
          inner.transform = `scale(${(1 + (1 - p) * 0.6 + outE * 0.2).toFixed(3)})`;
          inner.filter = p < 1 ? `blur(${((1 - p) * 8).toFixed(2)}px)` : undefined;
        } else {
          inner.opacity = p * (1 - outE);
          inner.marginRight = `${((1 - p) * 0.5).toFixed(3)}em`;
        }
        const clip = variant === 'rise';
        const body = <span style={{...inner, ...(unitStyle ? unitStyle(idx) : null)}}>{u}</span>;
        return clip ? (
          <span key={i} style={{display: by === 'line' ? 'block' : 'inline-block', overflow: 'hidden', verticalAlign: 'top', padding: '0.06em 0.02em 0.22em', margin: '-0.06em -0.02em -0.22em'}}>
            {body}
          </span>
        ) : (
          <React.Fragment key={i}>{body}</React.Fragment>
        );
      })}
    </span>
  );
};

// ───────────────────────── 设计坐标容器（Motion.tsx DesignStage 原样） ─────────────────────────
export const DesignStage: React.FC<{
  w?: number; h?: number; bg?: string; raster?: 'scale' | 'zoom'; children: React.ReactNode;
}> = ({w = 480, h = 270, bg, raster = 'scale', children}) => {
  const {width} = useVideoConfig();
  const scale = width / w;
  return (
    <AbsoluteFill style={{background: bg ?? '#000', overflow: 'hidden'}}>
      <div
        style={{
          position: 'absolute', left: 0, top: 0, width: w, height: h, overflow: 'hidden',
          ...(raster === 'zoom'
            ? {zoom: scale}
            : {transform: `scale(${scale})`, transformOrigin: 'top left'}),
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

// ───────────────────────── 确定性 PRNG（helpers/rand.ts 原样） ─────────────────────────
export const mulberry32 = (seed: number) => {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};