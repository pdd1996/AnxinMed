// spec.ts — 《安心用药》30s 品牌片的设计契约。所有数值/文案只在此处定义一次，场景只读不硬编码。
//
// 设计契约（温暖纸感 · 剪纸品牌片）
// - 世界：暖纸桌面。所有元素是「剪出来的纸」：实色填充 + 硬偏移投影 + 微粗糙边，无渐变无发光。
// - 色板（角色）：bg 暖纸 / card 卡面 / ink 深褐文字与描边 / green 墨绿=品牌·药箱·完成 /
//   orange 暖橙=提醒·高亮 / red 暖红=仅风险警示 / line 浅褐分隔线。
// - 字体：标题 Noto Serif SC 600/900（书卷气、可信）；正文与 UI Noto Sans SC 400/500/700；数字 tabular。
// - 构图：安全边距 x150 y90；场景内容居中偏左；药箱锚点 (250,860)；字幕 lower-third y≈900 ≥44px。
// - 动效性格：到达 EASE.out / 离开 EASE.in / 擦换 EASE.inOut / UI 打勾 EASE.snap；仅药箱落地允许 bounce 0.2。
// - 转场语法：每小节（2.5s 的偶数倍）新场景以 Reveal from=left 硬边擦入，历时一拍 0.625s；无交叉淡化。
// - 载体：药箱 S2 汇聚成形 → 缩为左下锚点贯穿 S3–S5 → S6 回到中央。身份（墨绿+十字标）全程不变。
// - 三个 recurring 细节：药箱十字标 / 卡片左上角类目小戳（录入·依从·相互作用·效期）/ 左上角品牌小字。
// - 禁用：渐变、发光、emoji、-stock 图标、占位文案、镜头抖动、未要求的交叉淡化、火柴人默认造型。
//
// 节奏：96 BPM，拍 0.625s，小节 2.5s，全片 12 小节 = 6 场景 × 2 小节。
// 字体本地自托管：src/fonts/ + src/fonts.css（scripts/fetch-fonts.mjs 生成），渲染零网络请求。
export const FILM = {duration: 30, fps: 30, width: 1920, height: 1080, bpm: 96, sound: true}; // S01
export const SAFE = {x: 150, y: 90};                                                        // S02
export const FONT = 'Noto Serif SC';                                                        // S03 标题
export const FONT_SANS = 'Noto Sans SC';                                                    // S04 正文/UI
export const COLOR = {                                                                      // S05
  bg: '#F6EFE3', card: '#FBF7EE', ink: '#3E362C', green: '#3D6B57',
  orange: '#E08A3C', red: '#C0523F', line: '#D8CDBB',
};

export const COPY = {                                                                       // S06 全部文案
  s1a: '一天 8 种药，3 个来源',
  s1b: '吃得对吗？记得住吗？',
  sources: ['医院', '药店', '网购'],
  s2scan: '拍一下，认得出',
  fields: [['通用名', '阿托伐他汀钙片'], ['规格', '20mg'], ['剂型', '片剂']],
  s2cap: '所有药，一个药箱',
  s2flock: '医院、药店、网购——收进一个箱',
  boxCountSuffix: ' 种药已入箱',
  s3title: '今日服药',
  s3stamp: '依从',
  s3done: '已完成',
  s3items: [
    ['苯磺酸氨氯地平片', '5mg · 早 1 片'],
    ['二甲双胍缓释片', '0.5g · 早 1 片'],
    ['阿托伐他汀钙片', '20mg · 晚 1 片'],
  ],
  s3cap: '吃没吃，一眼看清',
  s4a: '华法林', s4b: '阿司匹林', s4eg: '示例',
  s4badge: '相互作用',
  s4card: '已按规则库核对 · 建议咨询医生',
  s4cap: '冲突先知道',
  s5label: '有效期至 2026.12',
  s5card: '3 盒药 · 90 天内到期',
  s5stamp: '效期',
  s5bar: ['今天', '90 天'],
  s5cap: '到期提前提醒',
  s6title: '安心用药',
  s6slogan: '所有药，一个药箱',
  s6features: '管依从 · 管冲突 · 管效期',
  bug: '安心用药',
};

// T 块：关键时间（秒），全部落在 96 BPM 拍点上（0.625 的整数倍）。
export const T = {
  s1: 0, headline: 1.0, sub: 2.5,
  s2: 5.0, scan: 5.625, fields: [6.25, 6.5, 6.75], converge: 7.0,
  arrivals: [7.5, 7.625, 7.75, 7.875, 8.0, 8.125, 8.25, 8.375],
  boxLand: 8.5, cap2: 8.5,
  s3: 10.0, card3: 10.625, ticks: [11.25, 11.875, 12.5], cap3: 13.125,
  s4: 15.0, bottles: 15.625, meet: 16.875, badge: 17.5, cap4: 18.125,
  s5: 20.0, label5: 20.625, card5: 22.5, cap5: 23.125,
  s6: 25.0, logo: 25.625, slogan: 26.875, features: 27.5, rest: 29.5,
};

export const SCENES: [number, number][] = [[0, 5], [5, 10], [10, 15], [15, 20], [20, 25], [25, 30]]; // S07
export const WIPE = 0.625;                                                                  // S08 一拍擦换
export const ANCHOR = {x: 250, y: 860, s: 0.34};                                            // S09 药箱锚点
export const BOX_HOME = {x: 960, y: 500};                                                   // S10 汇聚中心
export const BOX_END = {x: 960, y: 660, s: 0.8};                                            // S11 落版位置