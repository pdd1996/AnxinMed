// Scene1.tsx — S1 问题（0–5s）。copy 自 video-shotcraft demos/camera/depth-layer-moves/MultiplaneReal.tsx，改皮。
// 保留的调校参数：三层系数 0.35 / 0.7 / 1.4 + 0x 字层；drive 缓动 bezier(0.45,0,0.18,1)（起步柔、中段匀、落位软）；
// 远景退焦 5px + 降饱和 + 暖色空气薄雾；近景 blur 7 + SpeedBlur(amount 0.2, max 10) 按速度横向拖影；
// 主角浮起晚于位置收敛 ~8f（lift 122→120f 起，out 曲线）+ 描边 + 角标；落定后远景极缓漂移 4px。
// 改皮：真实页面三层 → 8 盒剪纸药盒（远 3 / 中 3 / 近 2）+ 近景 3 枚来源胶囊（医院/药店/网购，纹理层）；
// sand look → 本片暖纸色板；标题 = COPY.s1a（衬线 96px）+ COPY.s1b（60px，Q11）。主角 = 盒群巡览。
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {COLOR, COPY, FONT, FONT_SANS} from '../spec';
import {EASE as PE, SpeedBlur, TextReveal, alpha, bezier, mix, ramp, type, velocity} from './polish';
import {PaperBox} from './PaperBox';
import {FlyingWordsTunnel} from './FlyingWordsTunnel';
import {T2} from './timeline';

const DRIVE_EASE = bezier(0.45, 0, 0.18, 1);
// 中景行：3 盒，步距 760；hero = 中间绿盒（阿托伐他汀，与 S2 扫描 / S3 清单一致）
const MID_W = 200, MID_H = 145, GAP = 760, ROW_X = 420, ROW_Y = 560;
const HERO = 1;
const MID_END = 960 - (ROW_X + HERO * GAP + MID_W / 2); // −320：落定时 hero 中心恰在屏心
const DRIVE = -MID_END / 0.7;
const driveAt = (f: number) => DRIVE * ramp(f, 6, 120, DRIVE_EASE) + 4 * ramp(f, 126, 24, PE.smooth);

// 远景 3 盒（退焦环境层）
const FAR = [
  {x: 260, y: 350, w: 130, h: 94, c: 7, shadeC: 8},
  {x: 980, y: 300, w: 120, h: 87, c: 0, shadeC: 1},
  {x: 1720, y: 380, w: 126, h: 91, c: 4, shadeC: 9},
];
// 中景 3 盒（主阅读层，绝对清晰）
const MID = [
  {c: 7, shadeC: 8}, {c: 0, shadeC: 1}, {c: 4, shadeC: 9},
];
// 中景三盒 = 三来源各一盒（左药店/中医院/右网购），清晰来源戳早于主角浮起出现，语义闭合呼应标题「3 个来源」
const MID_SRC = [1, 0, 2];
const MID_SRC_BG = [COLOR.ink, COLOR.green, COLOR.orange];
// 近景 2 盒（放大掠过镜头，景深虚化）
const NEAR = [
  {x: 1800, y: 760, w: 272, h: 196, c: 0, shadeC: 1},
  {x: 2620, y: 170, w: 250, h: 180, c: 7, shadeC: 8},
];
// 近景来源胶囊（COPY.sources，纹理层：虚化 + 低对比，观众不去读）
const PILLS = [
  {t: COPY.sources[0], x: 1400, y: 880, bg: COLOR.green, fg: COLOR.card},
  {t: COPY.sources[1], x: 2200, y: 240, bg: COLOR.ink, fg: COLOR.card},
  {t: COPY.sources[2], x: 3000, y: 860, bg: COLOR.orange, fg: COLOR.card},
];

export const Scene1: React.FC<{t: number}> = ({t}) => {
  if (t >= 5) return null;
  const f = t * 30;
  const drive = driveAt(f);
  const vFg = -1.4 * velocity(driveAt, f);
  const lift = ramp(f, 120, 22, PE.out);
  const ring = ramp(f, 126, 16, PE.snappy);
  const sub = ramp(f, 45, 18, PE.out);

  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      {/* 关键词隧道垫底（背景层，低不透明度） */}
      <FlyingWordsTunnel t={t} />

      {/* 远景 0.35x：缩小一档、退焦、降饱和 */}
      <div style={{position: 'absolute', left: 0, top: 0, transform: `translateX(${(-drive * 0.35).toFixed(2)}px)`, filter: 'blur(5px) saturate(0.7)', opacity: 0.75}}>
        {FAR.map((b, i) => (
          <div key={i} style={{position: 'absolute', left: b.x, top: b.y}}>
            <PaperBox w={b.w} h={b.h} c={b.c} shadeC={b.shadeC} />
          </div>
        ))}
      </div>
      {/* 空气透视：远景之上暖纸薄雾，上部更浓 */}
      <div style={{position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${alpha(COLOR.bg, 0.82)} 0%, ${alpha(COLOR.bg, 0.62)} 50%, ${alpha(COLOR.bg, 0.55)} 100%)`}} />
      {/* 桌面：一条极淡的地平线光 */}
      <div style={{position: 'absolute', left: 0, right: 0, top: 720, height: 340, background: `linear-gradient(180deg, ${alpha(COLOR.ink, 0)}, ${alpha(COLOR.ink, 0.05)} 40%, ${alpha(COLOR.ink, 0.02)})`}} />

      {/* 中景 0.7x：主阅读层（无 blur），hero 落定后浮起 + 暖橙描边 + 来源角标 */}
      <div style={{position: 'absolute', left: 0, top: 0, transform: `translateX(${(-drive * 0.7).toFixed(2)}px)`}}>
        {MID.map((b, k) => {
          const hero = k === HERO;
          const sp = ramp(f, 27 + k * 5, 10, PE.out);
          return (
            <div key={k} style={{
              position: 'absolute', left: ROW_X + k * GAP, top: ROW_Y - MID_H / 2, borderRadius: 6,
              transform: hero ? `translateY(${(-14 * lift).toFixed(2)}px) scale(${(1 + 0.035 * lift).toFixed(4)})` : undefined,
              boxShadow: hero ? `0 0 0 ${(2.5 * ring).toFixed(2)}px ${alpha(COLOR.orange, 0.9)}` : undefined,
            }}>
              <PaperBox w={MID_W} h={MID_H} c={b.c} shadeC={b.shadeC} edgeId={hero ? 's1v2-hero' : `s1v2-mid${k}`} />
              <div style={{
                position: 'absolute', left: '50%', top: -56,
                transform: `translateX(-50%) translateY(${((1 - sp) * 10).toFixed(1)}px)`,
                opacity: sp, background: MID_SRC_BG[k], color: COLOR.card, ...type(32, 700),
                padding: '4px 18px', borderRadius: 24, whiteSpace: 'nowrap',
                boxShadow: `3px 3px 0 ${alpha(COLOR.ink, 0.14)}`,
              }}>{COPY.sources[MID_SRC[k]]}</div>
            </div>
          );
        })}
      </div>

      {/* 近景 1.4x：放大药盒 + 来源胶囊掠过镜头（景深虚化，快段横向拖影） */}
      <SpeedBlur vx={vFg} amount={0.2} max={10}>
        <div style={{position: 'absolute', inset: 0, transform: `translateX(${(-drive * 1.4).toFixed(2)}px)`}}>
          {NEAR.map((b, i) => (
            <div key={`b${i}`} style={{position: 'absolute', left: b.x, top: b.y, filter: 'blur(7px)', opacity: 0.92}}>
              <PaperBox w={b.w} h={b.h} c={b.c} shadeC={b.shadeC} shadow={10} />
            </div>
          ))}
          {PILLS.map((p) => (
            <div key={p.t} style={{
              position: 'absolute', left: p.x, top: p.y, height: 128, padding: '0 56px', borderRadius: 64, display: 'flex', alignItems: 'center',
              background: p.bg, color: p.fg, fontFamily: FONT_SANS, fontSize: 64, fontWeight: 700, letterSpacing: '0.1em',
              filter: 'blur(7px)', opacity: 0.85, boxShadow: `0 40px 70px -10px ${alpha(COLOR.ink, 0.3)}`,
            }}>{p.t}</div>
          ))}
        </div>
      </SpeedBlur>

      {/* 0x 字层：固定在画框上的标题（字不动、世界在动） */}
      <div style={{position: 'absolute', left: 150, top: 110}}>
        <div style={{...type(96, 900, {serif: true}), color: COLOR.ink, letterSpacing: '0.02em'}}>
          <TextReveal text={COPY.s1a} by="char" variant="rise" start={15} each={12} gap={3} />
        </div>
        <div style={{marginTop: 26, fontFamily: FONT_SANS, fontSize: 60, fontWeight: 500, lineHeight: 1.2, color: COLOR.ink, opacity: sub * 0.85, transform: `translateY(${((1 - sub) * 14).toFixed(1)}px)`}}>
          {COPY.s1b}
        </div>
      </div>
    </AbsoluteFill>
  );
};