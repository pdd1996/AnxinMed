// film.tsx — 本片的形状构建器（E##），模块级一次构建；变形双方同点数（96）。
import {Item, Pt, circle, toPath, shadeHex} from './motion';
import {BOX_HOME, COLOR, FONT_SANS, T} from '../spec';

// 材质色板：0 墨绿 1 墨绿暗 2 卡面 3 深褐 4 暖橙 5 暖红 6 浅褐线 7 牛皮纸 8 牛皮暗 9 暖橙暗
export const PALETTE = [
  COLOR.green, shadeHex(COLOR.green, 0.78), COLOR.card, COLOR.ink, COLOR.orange,
  COLOR.red, COLOR.line, '#A89B85', shadeHex('#A89B85', 0.78), shadeHex(COLOR.orange, 0.82),
];

// 矩形轮廓按周长均匀取 n 点（顺时针，自左上角），保证任意两矩形可逐点变形。
export const rectPts = (cx: number, cy: number, w: number, h: number, n = 96): Pt[] => {
  const per = 2 * (w + h), x0 = cx - w / 2, y0 = cy - h / 2;
  const segs: [number, number, number, number][] = [[x0, y0, w, 0], [x0 + w, y0, 0, h], [x0 + w, y0 + h, -w, 0], [x0, y0 + h, 0, -h]];
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    let d = (i / n) * per;
    for (const [sx, sy, dx, dy] of segs) {
      const len = Math.abs(dx) + Math.abs(dy);
      if (d <= len) { out.push([sx + (dx * d) / len, sy + (dy * d) / len]); break; }
      d -= len;
    }
  }
  return out;
};
const rectItem = (cx: number, cy: number, w: number, h: number, c: number): Item => ({d: toPath(rectPts(cx, cy, w, h)), c});

// E01 药盒：盒身 + 盖缝 + 标签带 + 两条抽象文字线（不新增文案）
export const medBoxItems = (cx: number, cy: number, w: number, h: number, c: number, shadeC: number): Item[] => [
  rectItem(cx, cy, w, h, c),
  rectItem(cx, cy - h / 2 + h * 0.09, w, h * 0.18, shadeC),
  rectItem(cx, cy + h * 0.08, w * 0.72, h * 0.42, 2),
  rectItem(cx - w * 0.05, cy + h * 0.02, w * 0.44, h * 0.05, 3),
  rectItem(cx - w * 0.1, cy + h * 0.16, w * 0.28, h * 0.05, 3),
];

// E02 药箱（载体）：提手 + 箱身 + 盖缝 + 锁扣 + 十字标 + 底足。身份色 = 墨绿 + 卡面十字。
export const boxItems = (cx: number, cy: number, s: number): Item[] => {
  const W = 360 * s, H = 260 * s;
  return [
    rectItem(cx, cy - H / 2 - 13 * s, 120 * s, 26 * s, 1),
    rectItem(cx, cy, W, H, 0),
    rectItem(cx, cy - H / 2 + 70 * s, W, 10 * s, 1),
    rectItem(cx, cy - H / 2 + 70 * s, 46 * s, 26 * s, 1),
    rectItem(cx, cy + 30 * s, 36 * s, 110 * s, 2),
    rectItem(cx, cy + 30 * s, 110 * s, 36 * s, 2),
    rectItem(cx - 120 * s, cy + H / 2 + 6 * s, 50 * s, 12 * s, 1),
    rectItem(cx + 120 * s, cy + H / 2 + 6 * s, 50 * s, 12 * s, 1),
  ];
};

// E03 药瓶：瓶盖 + 瓶颈 + 瓶身 + 标签 + 药名
export const bottleItems = (cx: number, cy: number, c: number, shadeC: number, name: string): Item[] => [
  rectItem(cx, cy - 95, 80, 30, shadeC),
  rectItem(cx, cy - 72, 60, 16, c),
  rectItem(cx, cy, 130, 150, c),
  rectItem(cx, cy + 5, 110, 70, 2),
  {text: name, x: cx, y: cy + 16, size: 26, font: FONT_SANS, weight: 700, c: 3, anchor: 'middle'},
];

// E04 打勾路径（drawOn 用）
export const checkD = (cx: number, cy: number, s = 1) =>
  `M${cx - 16 * s} ${cy} L${cx - 4 * s} ${cy + 12 * s} L${cx + 18 * s} ${cy - 14 * s}`;

// E05 八盒药布局：医院 3 · 药店 3 · 网购 2（S01 的「8 种药 3 来源」逐字落地）
export type BoxSpec = {x: number; y: number; w: number; h: number; c: number; shadeC: number; group: number};
export const BOX_LAYOUT: BoxSpec[] = [
  {x: 480, y: 470, w: 160, h: 116, c: 7, shadeC: 8, group: 0},
  {x: 645, y: 545, w: 150, h: 108, c: 0, shadeC: 1, group: 0},
  {x: 505, y: 665, w: 140, h: 100, c: 4, shadeC: 9, group: 0},
  {x: 905, y: 455, w: 170, h: 120, c: 0, shadeC: 1, group: 1},
  {x: 1065, y: 540, w: 150, h: 110, c: 7, shadeC: 8, group: 1},
  {x: 925, y: 660, w: 145, h: 104, c: 4, shadeC: 9, group: 1},
  {x: 1335, y: 485, w: 160, h: 112, c: 7, shadeC: 8, group: 2},
  {x: 1460, y: 605, w: 140, h: 100, c: 0, shadeC: 1, group: 2},
];
export const SCAN_INDEX = 3; // 被扫描的是药店那盒绿药盒 = 阿托伐他汀钙片（与 S3 清单第三行一致）

// X01 汇聚：8 盒 → 药箱。被扫描盒从画面中心出发，其余从布局位置出发；数量守恒（8 进 8 出）。
export const boxParts = () =>
  BOX_LAYOUT.map((b, i) => ({
    pts: rectPts(i === SCAN_INDEX ? BOX_HOME.x : b.x, i === SCAN_INDEX ? BOX_HOME.y : b.y, b.w, b.h),
    arrive: T.arrivals[i], mass: 1, travel: 0.5,
  }));

// ── v2 药物形态（用户反馈：原 medBox 剪影像信封，药物特征不明显）──
// 胶囊/圆片/铝塑板/药盒/药瓶 五种一眼可认的药；纸感剪纸语法不变（实色+硬投影+粗糙边）。
export type MedForm = 'carton' | 'capsule' | 'tablet' | 'blister' | 'bottle';
const stadiumHalf = (cx: number, cy: number, w: number, h: number, side: 'L' | 'R') => {
  const r = h / 2, x0 = cx - w / 2, x1 = cx + w / 2;
  return side === 'L'
    ? `M${cx} ${cy - r} L${x0 + r} ${cy - r} A${r} ${r} 0 0 0 ${x0 + r} ${cy + r} L${cx} ${cy + r} Z`
    : `M${cx} ${cy - r} L${x1 - r} ${cy - r} A${r} ${r} 0 0 1 ${x1 - r} ${cy + r} L${cx} ${cy + r} Z`;
};
// 双色胶囊：左半身份色 + 右半纸白 + 中缝 + 高光
export const capsuleItems = (cx: number, cy: number, w: number, h: number, c: number, shadeC: number): Item[] => {
  const H = h * 0.46;
  return [
    {d: stadiumHalf(cx, cy, w, H, 'L'), c},
    {d: stadiumHalf(cx, cy, w, H, 'R'), c: 2},
    {d: toPath(rectPts(cx, cy, 3, H)), c: shadeC},
    {d: toPath(rectPts(cx - w * 0.24, cy - H * 0.24, w * 0.2, H * 0.14)), c: 2},
  ];
};
// 圆片：圆 + 中央刻痕 + 右下暗点（体积）
export const tabletItems = (cx: number, cy: number, w: number, h: number, c: number, shadeC: number): Item[] => {
  const r = Math.min(w, h) * 0.42;
  return [
    {d: toPath(circle(cx, cy, r)), c},
    {d: toPath(rectPts(cx, cy, r * 1.25, 4)), c: 2},
    {d: toPath(circle(cx + r * 0.36, cy + r * 0.36, r * 0.16)), c: shadeC},
  ];
};
// 铝塑泡罩：纸白箔底 + 顶封边 + 2×3 身份色药粒
export const blisterItems = (cx: number, cy: number, w: number, h: number, c: number, shadeC: number): Item[] => {
  const W = w * 0.92, H = h * 0.8;
  const items: Item[] = [
    {d: toPath(rectPts(cx, cy, W, H)), c: 2},
    {d: toPath(rectPts(cx, cy - H / 2 + H * 0.08, W, H * 0.16)), c: shadeC},
  ];
  for (let ry = 0; ry < 2; ry++) for (let k = 0; k < 3; k++) {
    items.push({d: toPath(circle(cx - W / 2 + W * (0.2 + k * 0.3), cy - H / 2 + H * (0.42 + ry * 0.34), Math.min(W, H) * 0.13)), c});
  }
  return items;
};
// 药盒（改进）：盒身+盖缝+十字标+标签带（带胶囊图标），读作药盒而非信封
export const cartonItems = (cx: number, cy: number, w: number, h: number, c: number, shadeC: number): Item[] => [
  {d: toPath(rectPts(cx, cy, w, h)), c},
  {d: toPath(rectPts(cx, cy - h / 2 + h * 0.09, w, h * 0.18)), c: shadeC},
  {d: toPath(rectPts(cx - w * 0.3, cy - h * 0.15, w * 0.06, h * 0.2)), c: 2},
  {d: toPath(rectPts(cx - w * 0.3, cy - h * 0.15, w * 0.2, h * 0.06)), c: 2},
  {d: toPath(rectPts(cx + w * 0.1, cy + h * 0.12, w * 0.62, h * 0.42)), c: 2},
  {d: stadiumHalf(cx + w * 0.1, cy + h * 0.06, w * 0.3, h * 0.16, 'L'), c},
  {d: stadiumHalf(cx + w * 0.1, cy + h * 0.06, w * 0.3, h * 0.16, 'R'), c: shadeC},
  {d: toPath(rectPts(cx + w * 0.1, cy + h * 0.26, w * 0.4, h * 0.05)), c: 3},
];
export const medItems = (form: MedForm, cx: number, cy: number, w: number, h: number, c: number, shadeC: number): Item[] =>
  form === 'capsule' ? capsuleItems(cx, cy, w, h, c, shadeC)
  : form === 'tablet' ? tabletItems(cx, cy, w, h, c, shadeC)
  : form === 'blister' ? blisterItems(cx, cy, w, h, c, shadeC)
  : form === 'bottle' ? bottleItems(cx, cy, c, shadeC, '')
  : cartonItems(cx, cy, w, h, c, shadeC);
// 8 种药的形态分配（hero=SCAN_INDEX=3 为铝塑板，与 S2 扫描单/S1 中景一致）
export const MED_FORMS: MedForm[] = ['capsule', 'tablet', 'blister', 'blister', 'capsule', 'tablet', 'blister', 'bottle'];