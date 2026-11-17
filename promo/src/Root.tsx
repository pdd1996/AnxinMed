import React from 'react';
import {Composition} from 'remotion';
import {Film} from './Film';
import {FilmV2} from './FilmV2';
import {Sample} from './Sample';
import {Paper} from './lib/motion';
import {COLOR, FILM} from './spec';

// Paper 单帧合成：用于把纸纹预渲染成 public/paper.png（npm run paper），正片用静态图避免逐帧 turbulence。
const PaperStill: React.FC = () => <Paper color={COLOR.bg} grain={0.1} fibre={0.08} seed={2} />;

export const Root: React.FC = () => (
  <>
    <Composition id="Film" component={Film} durationInFrames={Math.round(FILM.duration * FILM.fps)}
      fps={FILM.fps} width={FILM.width} height={FILM.height} />
    <Composition id="FilmV2" component={FilmV2} durationInFrames={Math.round(FILM.duration * FILM.fps)}
      fps={FILM.fps} width={FILM.width} height={FILM.height} />
    <Composition id="Paper" component={PaperStill} durationInFrames={1} fps={FILM.fps} width={FILM.width} height={FILM.height} />
    <Composition id="Sample" component={Sample} durationInFrames={20 * FILM.fps} fps={FILM.fps} width={FILM.width} height={FILM.height} />
  </>
);