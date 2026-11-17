// Sample.tsx — 动效升级对比样片：旧S2 → 新S2 → 旧S4 → 新S4，各 5s，左上角标注。
import React from 'react';
import {AbsoluteFill, Img, staticFile} from 'remotion';
import {Canvas, EASE, MaterialLayer, prog, settle, useTime} from './lib/motion';
import {ANCHOR, BOX_HOME, COLOR, FILM, FONT_SANS} from './spec';
import {PALETTE, boxItems, boxParts} from './lib/film';
import {Scene02} from './scenes/Scene02';
import {Scene02v2} from './scenes/Scene02v2';
import {Scene04} from './scenes/Scene04';
import {Scene04v2} from './scenes/Scene04v2';

const PARTS = boxParts();
const oldGrow = (t: number) => Math.sqrt(PARTS.reduce((s, p) => s + prog(t, p.arrive - 0.5, 0.5, EASE.in), 0) / 8);

const Label: React.FC<{text: string}> = ({text}) => (
  <div style={{position: 'absolute', left: 170, top: 100, fontFamily: FONT_SANS, fontSize: 28, fontWeight: 700, color: COLOR.ink, background: COLOR.card, border: `2px solid ${COLOR.line}`, borderRadius: 8, padding: '6px 18px', boxShadow: '4px 4px 0 rgba(62,54,44,0.12)'}}>{text}</div>
);

export const Sample: React.FC = () => {
  const {t} = useTime();
  const seg = Math.floor(t / 5);
  const lt = t - seg * 5;
  return (
    <AbsoluteFill style={{backgroundColor: COLOR.bg}}>
      <Img src={staticFile('paper.png')} style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}} />
      {seg === 0 && (
        <>
          <Scene02 t={5 + lt} />
          <Canvas>
            <g transform={`translate(${BOX_HOME.x} ${BOX_HOME.y}) scale(${oldGrow(5 + lt) * (1 + 0.05 * (1 - settle(5 + lt, FILM.fps, 8.5, {lead: 0.125, dur: 0.5, bounce: 0.3})))})`}>
              <MaterialLayer items={boxItems(0, 0, 1)} material={{kind: 'paper', shadow: 8, shadowOpacity: 0.16}} palette={PALETTE} />
            </g>
          </Canvas>
          <Label text="旧版 · 单线扫描 + 平移汇聚" />
        </>
      )}
      {seg === 1 && (<><Scene02v2 t={lt} /><Label text="新版 · 往复扫描 + 3D 翻飞汇聚" /></>)}
      {seg === 2 && (
        <>
          <Scene04 t={15 + lt} />
          <Canvas><g transform={`translate(${ANCHOR.x} ${ANCHOR.y}) scale(${ANCHOR.s})`}><MaterialLayer items={boxItems(0, 0, 1)} material={{kind: 'paper', shadow: 8, shadowOpacity: 0.16}} palette={PALETTE} /></g></Canvas>
          <Label text="旧版 · 徽章弹出" />
        </>
      )}
      {seg === 3 && (<><Scene04v2 t={lt} /><Label text="新版 · 推近 + 套印套准" /></>)}
    </AbsoluteFill>
  );
};