// ScanBracketDoc.tsx — copy 自 video-shotcraft demos/effects/scan-bracket-sweep/ScanBracketSweep.tsx，改皮。
// 保留的调校参数：文档弹入 scale 0.86→1（snappy）+ 透明度提前满亮；四角括号错峰 0.022 + overshoot ~8% 落位；
// 5 趟往复光带（每趟末尾 12% 完全停顿、两端慢中间快 inOutSin）；拖尾长度随速度伸缩（趟末收成 0）；
// 行照亮 = 光芯距离的高斯（纯空间函数，文档完全静止）；光带裁进文档同圆角内（Q4）。
// 改皮：靛蓝扫描光 → 暖橙（唯一光色，给主角文档一次）；分镜清单文档 → 药品识别单（medBox + COPY.fields 身份字段）；
// 柔光底 → 暖纸底（透明，正片纸纹在上）；设计坐标 480×270 raster=zoom 保留（小字按成片尺寸栅格化，Q2）。
// 时间压缩：demo 150f → 52.5f（5.0–6.75s），5 趟结构不变、单趟变快（30s 六场景的硬约束，见 DESIGN-NOTES）。
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {EASE, prog} from '../lib/motion';
import {MaterialLayer} from '../lib/motion';
import {PALETTE, medBoxItems} from '../lib/film';
import {COLOR, COPY, FONT_SANS} from '../spec';
import {DesignStage, EASE as PE, mix} from './polish';
import {T2} from './timeline';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const inOutSin = (x: number) => 0.5 - Math.cos(Math.PI * clamp01(x)) / 2;
const seg = (t: number, t0: number, t1: number, ease: (x: number) => number = PE.linear) =>
  ease(clamp01((t - t0) / (t1 - t0)));

const SCAN = '224,138,60'; // 暖橙扫描光（rgb 分量）
const DW = 300, DH = 178;
const DX = (440 - DW) / 2, DY = (240 - DH) / 2;
const WIN = T2.scanWin; // 1.75s = 52.5f
const PASSES = 5;
const TAIL = 82;

const scanAt = (t: number) => {
  const sp = seg(t, 0.17, 0.95);
  const raw = sp * PASSES;
  const pi = Math.min(PASSES - 1, Math.floor(raw));
  const local = clamp01((raw - pi) / 0.88);
  const dir = pi % 2 === 0 ? 1 : -1;
  const p = inOutSin(local);
  return {y: dir > 0 ? p * DH : DH - p * DH, dir};
};

const CS = 36;
const CORNERS = [
  {left: -8, top: -8, d: 'M1 35V1h34', dx: 1, dy: 1},
  {left: DW + 8 - CS, top: -8, d: 'M1 1h34v34', dx: -1, dy: 1},
  {left: DW + 8 - CS, top: DH + 8 - CS, d: 'M35 1v34H1', dx: -1, dy: -1},
  {left: -8, top: DH + 8 - CS, d: 'M35 35H1V1', dx: 1, dy: -1},
];

// 身份字段行（design 坐标）：label 8px→32px 屏幕、value 11px→44px 屏幕（Q11 辅助 ≥32 ✓）
const ROW_TOP = 48, ROW_H = 34;
const rowCy = (i: number) => ROW_TOP + i * ROW_H + 12;
// 第一趟下行光芯经过行中心的近似时刻 → 该行绿勾「确认」
const crossT = (i: number) => T2.s2 + WIN * (0.17 + (0.78 / PASSES) * 0.88 * (rowCy(i) / DH));

export const ScanBracketDoc: React.FC<{t: number}> = ({t}) => {
  const u = (t - T2.s2) / WIN;
  const dt = 1 / (WIN * 30 - 1);
  const dp = seg(u, 0, 0.11, PE.snappy);
  const out = prog(t, T2.docOut, 0.25, EASE.in); // 6.75–7.0 文档退场（让位给 flock）
  const {y, dir} = scanAt(u);
  const speed = Math.abs(scanAt(u + dt / 2).y - scanAt(u - dt / 2).y);
  const PEAK = (DH * Math.PI) / 2 / (((0.78 * WIN * 30) / PASSES) * 0.88);
  const sNorm = clamp01(speed / PEAK);
  const tail = TAIL * Math.pow(sNorm, 0.75);
  const clipOp = seg(u, 0.16, 0.2) * (1 - seg(u, 0.93, 0.99));
  const lit = (cy: number) => clipOp * Math.exp(-Math.pow((y - cy) / 7, 2));

  return (
    <AbsoluteFill>
      <DesignStage bg="transparent" raster="zoom">
        <div style={{
          position: 'absolute', left: '50%', top: '50%', width: 440, height: 240, margin: '-120px 0 0 -220px',
          transform: `scale(${mix(1, 0.86, out).toFixed(4)})`, opacity: 1 - out,
        }}>
          <div style={{position: 'absolute', left: DX, top: DY, width: DW, height: DH}}>
            {/* 文档卡片：纸感 = 实色卡面 + 发丝线 + 硬偏移投影（随弹入收紧） */}
            <div style={{
              position: 'absolute', inset: 0, background: COLOR.card, borderRadius: 10,
              boxShadow: `inset 0 0 0 0.5px ${COLOR.line}, ${(4 + 4 * dp).toFixed(1)}px ${(4 + 4 * dp).toFixed(1)}px 0 rgba(62,54,44,${(0.1 + 0.04 * dp).toFixed(3)})`,
              overflow: 'hidden', transformOrigin: '50% 50%', transform: `scale(${mix(0.86, 1, dp).toFixed(4)})`,
              opacity: clamp01(dp * 3), fontFamily: FONT_SANS, color: COLOR.ink, fontVariantNumeric: 'tabular-nums',
            }}>
              {/* 页眉：类目小戳（录入）+ 药名标题 + 示例 chip */}
              <div style={{position: 'absolute', left: 14, top: 10, padding: '2px 6px', borderRadius: 3, background: COLOR.green, color: COLOR.card, fontSize: 9, fontWeight: 700, lineHeight: 1.2}}>录入</div>
              <div style={{position: 'absolute', left: 52, top: 11, fontSize: 11, fontWeight: 700, lineHeight: 1}}>{COPY.fields[0][1]}</div>
              <div style={{position: 'absolute', right: 14, top: 11, padding: '2px 6px', borderRadius: 3, background: COLOR.bg, boxShadow: `inset 0 0 0 0.4px ${COLOR.line}`, fontSize: 9, color: COLOR.ink, opacity: 0.7, lineHeight: 1.2}}>{COPY.s4eg}</div>
              <div style={{position: 'absolute', left: 14, right: 14, top: 32, height: 0.5, background: COLOR.line}} />

              {/* 左：被扫描的药盒（剪纸，静止） */}
              <svg width={100} height={80} viewBox="0 0 100 80" style={{position: 'absolute', left: 14, top: 52}}>
                <MaterialLayer items={medBoxItems(50, 40, 96, 70, 0, 1)} material={{kind: 'paper', shadow: 3, shadowOpacity: 0.16}} palette={PALETTE} />
              </svg>

              {/* 右：身份字段三行（光芯经过时整行被轻微照亮，文档本身不动） */}
              {COPY.fields.map(([k, v], i) => {
                const top = ROW_TOP + i * ROW_H;
                const L = lit(rowCy(i));
                const cp = prog(t, crossT(i), 0.15, EASE.out);
                return (
                  <React.Fragment key={k}>
                    <div style={{position: 'absolute', left: 120, right: 8, top: top - 4, height: ROW_H - 4, borderRadius: 3, background: `rgba(${SCAN},${(L * 0.14).toFixed(3)})`}} />
                    <div style={{position: 'absolute', left: 126, top, fontSize: 9, fontWeight: 500, color: COLOR.ink, opacity: 0.55, lineHeight: 1}}>{k}</div>
                    <div style={{position: 'absolute', left: 126, top: top + 12, fontSize: 11, fontWeight: 700, lineHeight: 1}}>{v}</div>
                    {cp > 0 && (
                      <svg width={16} height={16} viewBox="0 0 16 16" style={{position: 'absolute', right: 14, top: top + 4, opacity: cp}}>
                        <path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke={COLOR.green} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </React.Fragment>
                );
              })}

              {/* 页脚：核对完成行 */}
              <div style={{position: 'absolute', left: 14, right: 14, top: 152, height: 0.5, background: COLOR.line}} />
              <div style={{position: 'absolute', left: 14, top: 160, fontSize: 9, fontWeight: 700, color: COLOR.green, lineHeight: 1}}>说明书已核对</div>
              <div style={{position: 'absolute', right: 14, top: 160, fontSize: 9, color: COLOR.ink, opacity: 0.55, lineHeight: 1}}>20mg · 片剂</div>
            </div>

            {/* 扫描光带（裁在文档同 10px 圆角内）：细亮芯 + 柔辉 + 朝来向的色调拖尾 */}
            <div style={{position: 'absolute', inset: 0, borderRadius: 10, overflow: 'hidden', pointerEvents: 'none', opacity: clipOp}}>
              <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: 0, transform: `translateY(${y.toFixed(3)}px)`}}>
                <div style={{
                  position: 'absolute', left: 0, right: 0, height: tail, top: dir > 0 ? -tail : 0, mixBlendMode: 'multiply',
                  background: dir > 0
                    ? `linear-gradient(180deg, rgba(${SCAN},0) 0%, rgba(${SCAN},0.07) 55%, rgba(${SCAN},0.22) 100%)`
                    : `linear-gradient(0deg, rgba(${SCAN},0) 0%, rgba(${SCAN},0.07) 55%, rgba(${SCAN},0.22) 100%)`,
                }} />
                <div style={{position: 'absolute', left: 0, right: 0, top: -5, height: 10, background: `linear-gradient(180deg, rgba(${SCAN},0) 0%, rgba(${SCAN},0.22) 50%, rgba(${SCAN},0) 100%)`}} />
                <div style={{
                  position: 'absolute', left: 0, right: 0, top: -0.6, height: 1.2,
                  background: `linear-gradient(90deg, rgba(${SCAN},0.55) 0%, rgb(${SCAN}) 18%, #F2B279 50%, rgb(${SCAN}) 82%, rgba(${SCAN},0.55) 100%)`,
                  boxShadow: `0 0 2.5px rgba(${SCAN},0.7)`,
                }} />
              </div>
            </div>

            {/* 四角取景括号：交错落位，从外侧 8px 带一次轻过冲收进来 */}
            {CORNERS.map((c, i) => {
              const t0 = 0.08 + i * 0.022;
              const a = seg(u, t0, t0 + 0.03);
              const p = PE.overshoot(clamp01((u - t0) / 0.055));
              const off = (1 - p) * 8;
              return (
                <svg key={i} width={CS} height={CS} viewBox={`0 0 ${CS} ${CS}`} style={{
                  position: 'absolute', left: c.left, top: c.top, overflow: 'visible', opacity: a,
                  transform: `translate(${(-off * c.dx).toFixed(3)}px,${(-off * c.dy).toFixed(3)}px)`,
                }}>
                  <path d={c.d} fill="none" stroke={COLOR.ink} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              );
            })}
          </div>
        </div>
      </DesignStage>
    </AbsoluteFill>
  );
};