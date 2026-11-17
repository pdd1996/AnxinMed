// film.tsx — 本片的形状构建器（E##），模块级一次构建；变形双方同点数（96）。
import {Item, Pt, toPath, shadeHex} from './motion';
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