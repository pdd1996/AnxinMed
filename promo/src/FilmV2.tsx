// FilmV2.tsx — 动效升级 v2 主时间线（900f = 30s × 30fps）。
// 与 v1 的差异：转场 = 硬切卡点（120 BPM 网格，场景边界 5s 落拍），仅 S1→S2 切点用一次 FlashCut（R4 名额#3）；
// 整画面/相机级冲击全片 3 处：S4 crash-zoom（15s）、S6 drone-dive（25s）、S1→S2 FlashCut（5s），相邻间隔 10s = 16 拍 ✓。
// 持久药箱载体：S2 flock 吸入后 9.0s 落定生长（bounce 0.2，spec 唯一允许处）→ 9.5–10.0 缩至左下锚点
// → S3–S5 静止锚点 → S6 交给 DiveWorld（硬切掩盖交接，俯冲起点为上帝视角远景）。
// 配乐：public/score-v2.wav（scripts/cues-v2.json 生成，不覆盖 v1 score.wav）。
import React from 'react';
import {AbsoluteFill, Audio, Img, Sequence, getInputProps, staticFile} from 'remotion';
import {Canvas, EASE, InkFilter, MaterialLayer, mix, prog, roughFor, settle, useTime} from './lib/motion';
import {PALETTE, boxItems} from './lib/film';
import {ANCHOR, COLOR, COPY, FILM, FONT} from './spec';
import {Scene1} from './v2/Scene1';
import {Scene2} from './v2/Scene2';
import {Scene3} from './v2/Scene3';
import {Scene4} from './v2/Scene4';
import {Scene5} from './v2/Scene5';
import {Scene6} from './v2/Scene6';
import {FlashCut} from './v2/lib/FlashCut';
import {FLOCK_C, T2} from './v2/timeline';

const boxPos2 = (t: number): {x: number; y: number; s: number} | null => {
  if (t < T2.boxLand) return null;
  if (t < 9.5) return {x: FLOCK_C.x, y: FLOCK_C.y, s: 1};
  if (t < T2.s3) {
    const p = prog(t, 9.5, 0.5, EASE.inOut);
    return {x: mix(FLOCK_C.x, ANCHOR.x, p), y: mix(FLOCK_C.y, ANCHOR.y, p), s: mix(1, ANCHOR.s, p)};
  }
  if (t < T2.s6) return {x: ANCHOR.x, y: ANCHOR.y, s: ANCHOR.s};
  return null; // S6：药箱在 DiveWorld 里俯冲落定
};

export const FilmV2: React.FC = () => {
  const {t} = useTime();
  const {bgm = true} = getInputProps() as {bgm?: boolean};
  const pos = boxPos2(t);
  const grow = prog(t, T2.boxLand, 0.3, EASE.out);
  const land = 1 + 0.05 * (1 - settle(t, FILM.fps, T2.boxLand, {lead: 0.1, dur: 0.5, bounce: 0.2}));
  const scale = pos ? mix(0.3, 1, grow) * pos.s * land : 0;
  const bugP = prog(t, T2.boxLand, 0.5, EASE.out);
  return (
    <AbsoluteFill style={{backgroundColor: COLOR.bg}}>
      <Img src={staticFile('paper.png')} style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}} />
      <Scene1 t={t} />
      {t >= T2.s2 && t < T2.s3 && <Scene2 t={t} />}
      <Scene3 t={t} />
      <Scene4 t={t} />
      <Scene5 t={t} />
      {t >= T2.s6 && (
        <Sequence from={Math.round(T2.s6 * FILM.fps)} layout="none">
          <Scene6 />
        </Sequence>
      )}
      {pos && scale > 0.001 && (
        <Canvas>
          <InkFilter id="box-edge-v2" edge={roughFor(360)} grain={0.25} seed={5} />
          <g transform={`translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)}) scale(${scale.toFixed(4)})`} filter="url(#box-edge-v2)">
            <MaterialLayer items={boxItems(0, 0, 1)} material={{kind: 'paper', shadow: 8, shadowOpacity: 0.16}} palette={PALETTE} />
          </g>
        </Canvas>
      )}
      {t >= T2.boxLand && (
        <div style={{position: 'absolute', left: 170, top: 100, fontFamily: FONT, fontSize: 36, fontWeight: 600, letterSpacing: '0.15em', color: COLOR.ink, opacity: 0.65 * bugP, transform: `translateX(${((1 - bugP) * -320).toFixed(1)}px)`}}>
          {COPY.bug}
        </div>
      )}
      {/* R4 冲击#3：S1→S2 切点暖白闪核（10f），其余切点纯硬切 */}
      <Sequence from={Math.round(T2.s2 * FILM.fps)} durationInFrames={10} layout="none">
        <FlashCut duration={10} />
      </Sequence>
      {FILM.sound && <Audio src={staticFile(bgm ? 'score-v2.wav' : 'score-v2-sfx.wav')} />}
    </AbsoluteFill>
  );
};