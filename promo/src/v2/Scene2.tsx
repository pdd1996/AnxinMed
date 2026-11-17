// Scene2.tsx — S2 录入（5–10s）。主角 = flock 收束（P4：翻飞只在 S2 主演一次）。
// 前半 ScanBracketDoc（scan-bracket-sweep 改皮），后半 CardFlock（card-flock-tumble 改皮）。
// 落定后：计数 DigitRoll（assets/lib 同源）0→8 + COPY.boxCountSuffix；字幕 COPY.s2cap 60px（Q11）。
import React from 'react';
import {AbsoluteFill, Sequence} from 'remotion';
import {COLOR, COPY, FONT, FONT_SANS} from '../spec';
import {EASE, Letters, prog} from '../lib/motion';
import {alpha} from './polish';
import {ScanBracketDoc} from './ScanBracketDoc';
import {CardFlock} from './CardFlock';
import {DigitRoll} from './lib/DigitRoll';
import {T2, fr} from './timeline';

export const Scene2: React.FC<{t: number}> = ({t}) => {
  const capP = prog(t, T2.cap2, 0.4, EASE.out);
  const cntP = prog(t, T2.cap2, 0.25, EASE.out);
  // flock 段解说字幕（C1：纯动画段落配解说）；7.0 起、8.6 前退场让位品牌句
  const fcIn = prog(t, T2.flock, 0.3, EASE.out);
  const fcOut = prog(t, 8.3, 0.3, EASE.in);
  return (
    <AbsoluteFill>
      {t < T2.flock ? <ScanBracketDoc t={t} /> : <CardFlock t={t} />}
      {t >= T2.flock && fcOut < 1 && (
        <div style={{position: 'absolute', left: 0, right: 0, top: 880, display: 'flex', justifyContent: 'center'}}>
          <Letters
            text={COPY.s2flock} t={t} start={T2.flock} stagger={0.03} dur={0.35} ease={EASE.out}
            style={(p) => ({
              fontFamily: FONT_SANS, fontSize: 60, fontWeight: 500, color: COLOR.ink,
              opacity: p * (1 - fcOut), transform: `translateY(${((1 - p) * 22 + fcOut * 30).toFixed(1)}px)`,
            })}
            box={{opacity: fcIn > 0 ? 1 : 0}}
          />
        </div>
      )}
      {/* 计数：8 种药已入箱（DigitRoll 从 0 滚到 8，22f 恰好在 10.0 落定）
          纸感 scrim：墨点环扩张会扫过计数区，垫一层卡面硬投影小条保证对比度（Q11） */}
      {t >= T2.cap2 && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 730, display: 'flex', justifyContent: 'center',
          alignItems: 'baseline', gap: 6, opacity: cntP, transform: `translateY(${(1 - cntP) * 14}px)`,
        }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 6, background: COLOR.card, borderRadius: 10,
            padding: '6px 20px', boxShadow: `4px 4px 0 ${alpha(COLOR.ink, 0.14)}`,
          }}>
            <Sequence from={fr(T2.cap2)} layout="none">
              <DigitRoll value="8" fontSize={44} color={COLOR.green} />
            </Sequence>
            <span style={{fontFamily: FONT, fontSize: 36, color: COLOR.ink}}>{COPY.boxCountSuffix}</span>
          </div>
        </div>
      )}
      {/* 字幕 60px（v1 44px → 60，Q11） */}
      <div style={{position: 'absolute', left: 0, right: 0, top: 880, display: 'flex', justifyContent: 'center'}}>
        <Letters
          text={COPY.s2cap} t={t} start={T2.cap2} stagger={0.035} dur={0.35} ease={EASE.out}
          style={(p) => ({
            fontFamily: FONT, fontSize: 60, fontWeight: 700, color: COLOR.green,
            opacity: p, transform: `translateY(${(1 - p) * 22}px)`,
          })}
          box={{opacity: capP > 0 ? 1 : 0}}
        />
      </div>
    </AbsoluteFill>
  );
};