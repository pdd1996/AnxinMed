// Film.tsx — 主时间线。纸底 + 六个场景（硬边擦入）+ 持久药箱载体 + 品牌小字 + 配乐。
// 药箱只在此处绘制一次：S2 汇聚生长 → S3 起缩为左下锚点 → S6 回中央，全程无跳变。
import React from 'react';
import {AbsoluteFill, Audio, Img, staticFile} from 'remotion';
import {Canvas, EASE, InkFilter, MaterialLayer, Reveal, mix, prog, roughFor, settle, useTime} from './lib/motion';
import {PALETTE, boxItems, boxParts} from './lib/film';
import {ANCHOR, BOX_END, BOX_HOME, COLOR, COPY, FILM, FONT, T, WIPE} from './spec';
import {Scene01} from './scenes/Scene01';
import {Scene02} from './scenes/Scene02';
import {Scene03} from './scenes/Scene03';
import {Scene04} from './scenes/Scene04';
import {Scene05} from './scenes/Scene05';
import {Scene06} from './scenes/Scene06';

const PARTS = boxParts();
const arrivedMass = (t: number) => PARTS.reduce((s, p) => s + prog(t, p.arrive - 0.5, 0.5, EASE.in), 0);

const boxPos = (t: number) => {
  if (t < T.s3) return {x: BOX_HOME.x, y: BOX_HOME.y, s: 1};
  if (t < T.s3 + WIPE) {
    const p = prog(t, T.s3, WIPE, EASE.inOut);
    return {x: mix(BOX_HOME.x, ANCHOR.x, p), y: mix(BOX_HOME.y, ANCHOR.y, p), s: mix(1, ANCHOR.s, p)};
  }
  if (t < T.s6) return {x: ANCHOR.x, y: ANCHOR.y, s: ANCHOR.s};
  if (t < T.s6 + WIPE) {
    const p = prog(t, T.s6, WIPE, EASE.inOut);
    return {x: mix(ANCHOR.x, BOX_END.x, p), y: mix(ANCHOR.y, BOX_END.y, p), s: mix(ANCHOR.s, BOX_END.s, p)};
  }
  return {x: BOX_END.x, y: BOX_END.y, s: BOX_END.s};
};

export const Film: React.FC = () => {
  const {t} = useTime();
  const pos = boxPos(t);
  const grow = Math.sqrt(arrivedMass(t) / 8);
  const land = 1 + 0.05 * (1 - settle(t, FILM.fps, T.boxLand, {lead: 0.125, dur: 0.5, bounce: 0.3}));
  const scale = grow * pos.s * land;
  const bugP = prog(t, T.boxLand, 0.5, EASE.out);
  return (
    <AbsoluteFill style={{backgroundColor: COLOR.bg}}>
      <Img src={staticFile('paper.png')} style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}} />
      <Scene01 t={t} />
      <Reveal p={prog(t, T.s2, WIPE, EASE.inOut)} from="left"><Scene02 t={t} /></Reveal>
      <Reveal p={prog(t, T.s3, WIPE, EASE.inOut)} from="left"><Scene03 t={t} /></Reveal>
      <Reveal p={prog(t, T.s4, WIPE, EASE.inOut)} from="left"><Scene04 t={t} /></Reveal>
      <Reveal p={prog(t, T.s5, WIPE, EASE.inOut)} from="left"><Scene05 t={t} /></Reveal>
      <Reveal p={prog(t, T.s6, WIPE, EASE.inOut)} from="left"><Scene06 t={t} /></Reveal>
      {scale > 0.001 && (
        <Canvas>
          <InkFilter id="box-edge" edge={roughFor(360)} grain={0.25} seed={5} />
          <g transform={`translate(${pos.x} ${pos.y}) scale(${scale})`} filter="url(#box-edge)">
            <MaterialLayer items={boxItems(0, 0, 1)} material={{kind: 'paper', shadow: 8, shadowOpacity: 0.16}} palette={PALETTE} />
          </g>
        </Canvas>
      )}
      {t >= T.boxLand && (
        <div style={{position: 'absolute', left: 170, top: 100, fontFamily: FONT, fontSize: 30, fontWeight: 600, letterSpacing: '0.15em', color: COLOR.ink, opacity: 0.65, transform: `translateX(${(1 - bugP) * -320}px)`}}>
          {COPY.bug}
        </div>
      )}
      {FILM.sound && <Audio src={staticFile('score.wav')} />}
    </AbsoluteFill>
  );
};