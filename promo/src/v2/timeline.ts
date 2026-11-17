// timeline.ts — v2 时间块（局部覆盖 spec.T，不改 v1）。
// 节奏：120 BPM（beat 0.5s = 15f，整数帧），场景边界 5s 仍落拍；6 场景 × 5s 不变。
// 所有关键秒尽量落 0.25s 网格；demo 内部结构帧（riso 44f 震荡、flock 10f 吸入等）按原参数保留。
export const BPM2 = 120;
export const fr = (t: number) => Math.round(t * 30);

export const T2 = {
  // S1 问题：depth-layer 巡览（drive 0.2–4.2s）+ 主角浮起 + hold
  s1: 0, headline: 0.5, sub: 1.5, driveStart: 0.2, driveDur: 4.0, lift: 4.0,
  // S2 录入：扫描（5.0–6.75，5 趟光带）→ 文档退场 → flock 翻飞（7.0–8.4）→ 慢转 → 吸入（8.6667–9.0）
  //         → 墨点环 + 药箱落定（9.0）→ 字幕/计数（9.25）→ 0.5s rest
  s2: 5, scanWin: 1.75, docOut: 6.75, flock: 7.0, flightDur: 1.4, suckStart: 8 + 2 / 3, ring: 9.0,
  boxLand: 9.0, cap2: 9.25,
  // S3 依从：卡入场 → 发牌式硬加速错峰（间隔 0.4 → 0.25）→ 满板 0.5s rest → 打勾落拍
  s3: 10, card3: 10.25, deals: [10.75, 11.15, 11.4], ticks: [12.25, 12.75, 13.25], cap3: 13.75,
  // S4 冲突：crash-zoom（整画面冲击#1）→ 两瓶相遇顿挫 → 警示章 slam（17.0 = local f60）
  //         → 44f 裂版震荡 → 硬切套准（local f104 = 18.4667）+ 核对圆章 → 核对卡 → 字幕
  s4: 15, bottles: 15.5, meet: 16.5, hit: 17.0, snap: 15 + 104 / 30, card4: 18.6, cap4: 18.8,
  // S5 效期：标签逐字印出 → 提醒卡 slam → 窗口条加速走满 → 字幕 → 0.5s rest
  s5: 20, label5: 20.5, card5: 22.0, bar5: 22.25, barDur: 1.25, cap5: 23.75,
  // S6 落版：drone-dive（整画面冲击#2，local f15–45）→ 26.5 落定 → 字标 slam → 口号/功能
  //         → Q8 四方飞入（26.6667–27.8）→ 28.0 起全静 hold 2s（R1）
  s6: 25, land: 26.5, logo: 26.5, slogan: 27.0, features: 27 + 4 / 15, rest: 28.0,
};

// flock 落定中心 = 药箱 S2  home（与 FilmV2 持久层一致）
export const FLOCK_C = {x: 960, y: 540};