// Scene3.tsx — S3 依从（10–15s）。复用 v1 Scene03 版式，升级三处：
// ① 行入场 = 发牌式硬加速错峰（deals 间隔 0.4→0.25s，EASE.in 指数加速，末段硬着陆）；
// ② 满板后 0.55s 静止（11.7 满板 → 12.25 首勾）再打勾，打勾带 impact 微震（只震卡片元素层，R4）；
// ③ 计数改 DigitRoll（assets/lib 同源，v2/lib copy），每勾一次重滚 0→n。
// 字高升级（Q11）：标题 44→56、药名 34→40、剂量 26→32、字幕 44→60、类目戳 22→28。
import React from 'react';
import {AbsoluteFill, Sequence} from 'remotion';
import {EASE, Letters, drawOn, prog} from '../lib/motion';
import {checkD} from '../lib/film';
import {COLOR, COPY, FONT, FONT_SANS} from '../spec';
import {DigitRoll} from './lib/DigitRoll';
import {T2, fr} from './timeline';

const CARD = {left: 660, top: 264, w: 820, h: 486};

// 打勾 impact 微震：三次衰减余弦叠加，振幅 3px、周期 0.12s、τ 0.08s，0.3s 窗口外精确 0。
const shakeAt = (t: number) => {
  let s = 0;
  for (const ti of T2.ticks) {
    const dt = t - ti;
    if (dt >= 0 && dt < 0.3) s += 3 * Math.cos((2 * Math.PI * dt) / 0.12) * Math.exp(-dt / 0.08);
  }
  return s;
};

export const Scene3: React.FC<{t: number}> = ({t}) => {
  if (t < T2.s3 || t >= 15) return null;
  const cardP = prog(t, T2.card3, 0.4, EASE.out);
  const done = T2.ticks.filter((ti) => t >= ti).length;
  const shake = shakeAt(t);
  const capP = prog(t, T2.cap3, 0.35, EASE.out);
  return (
    <AbsoluteFill>
      <div style={{
        position: 'absolute', left: CARD.left, top: CARD.top, width: CARD.w, height: CARD.h,
        background: COLOR.card, border: `2px solid ${COLOR.ink}`, borderRadius: 14,
        boxShadow: '9px 9px 0 rgba(62,54,44,0.16)', boxSizing: 'border-box', padding: '28px 44px',
        fontFamily: FONT_SANS, opacity: cardP > 0 ? 1 : 0,
        transform: `translate(${((1 - cardP) * 1200 + shake).toFixed(2)}px, 0)`,
      }}>
        {/* 表头：类目戳 + 标题 + 完成计数（DigitRoll） */}
        <div style={{display: 'flex', alignItems: 'center', gap: 18, height: 76}}>
          <span style={{background: COLOR.green, color: COLOR.card, fontSize: 36, fontWeight: 700, padding: '5px 14px', borderRadius: 6}}>{COPY.s3stamp}</span>
          <span style={{fontFamily: FONT, fontSize: 56, fontWeight: 900, color: COLOR.ink}}>{COPY.s3title}</span>
          <span style={{flex: 1}} />
          <span style={{fontSize: 36, fontWeight: 500, color: COLOR.ink, opacity: 0.55}}>{COPY.s3done}</span>
          {done === 0 ? (
            <span style={{fontSize: 44, fontWeight: 700, color: COLOR.green, fontVariantNumeric: 'tabular-nums'}}>0</span>
          ) : (
            <Sequence from={fr(T2.ticks[done - 1])} layout="none">
              <DigitRoll value={String(done)} fontSize={44} color={COLOR.green} />
            </Sequence>
          )}
          <span style={{fontSize: 36, color: COLOR.ink, opacity: 0.6}}>/{COPY.s3items.length}</span>
        </div>
        {/* 三行发牌：硬加速错峰（间隔 0.4 → 0.25），expoIn 末段硬着陆 */}
        {COPY.s3items.map(([name, dose], i) => {
          const rp = prog(t, T2.deals[i], 0.3, EASE.in);
          const tickP = prog(t, T2.ticks[i], 0.22, EASE.snap);
          return (
            <div key={name} style={{
              display: 'flex', alignItems: 'center', gap: 22, height: 108,
              borderTop: i > 0 ? `1px solid ${COLOR.line}` : 'none', marginTop: i === 0 ? 14 : 0,
              opacity: rp > 0 ? Math.min(1, rp * 4) : 0,
              transform: `translateX(${((1 - rp) * 1100).toFixed(1)}px) rotate(${((1 - rp) * 2.5).toFixed(2)}deg)`,
            }}>
              <span style={{position: 'relative', width: 46, height: 46, border: `2.5px solid ${COLOR.ink}`, borderRadius: 10, flexShrink: 0, boxSizing: 'border-box'}}>
                <svg width={46} height={46} style={{position: 'absolute', left: -2.5, top: -2.5}}>
                  <path d={checkD(23, 24, 1.15)} stroke={COLOR.green} strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" fill="none" {...drawOn(checkD(23, 24, 1.15), tickP)} />
                </svg>
              </span>
              <span style={{fontSize: 40, fontWeight: 700, color: COLOR.ink, opacity: 1 - 0.45 * prog(t, T2.ticks[i], 0.3)}}>{name}</span>
              <span style={{marginLeft: 'auto', fontSize: 36, fontWeight: 400, color: COLOR.ink, opacity: 0.6}}>{dose}</span>
            </div>
          );
        })}
      </div>
      {/* 字幕 60px（Q11） */}
      <div style={{position: 'absolute', left: 0, right: 0, top: 880, display: 'flex', justifyContent: 'center'}}>
        <Letters
          text={COPY.s3cap} t={t} start={T2.cap3} stagger={0.035} dur={0.35} ease={EASE.out}
          style={(p) => ({fontFamily: FONT, fontSize: 60, fontWeight: 700, color: COLOR.ink, opacity: p, transform: `translateY(${(1 - p) * 22}px)`})}
          box={{opacity: capP > 0 ? 1 : 0}}
        />
      </div>
    </AbsoluteFill>
  );
};