# DESIGN-NOTES — 《安心用药》动效升级 v2（FilmV2，900f / 30s / 30fps / 1920×1080）

主时间线 `src/FilmV2.tsx`；场景 `src/v2/Scene1..6.tsx`；时间块 `src/v2/timeline.ts`（T2，120 BPM 网格）。
v1（`src/Film.tsx` + `src/scenes/`）未改，仍可渲染；`public/score.wav` 未覆盖（v2 用 `score-v2.wav`）。

## 0. 偏离记录（有意识违反 / 选择，逐条理由）

1. **温暖纸感皮肤 + spec.ts COPY 全保留**：偏离 shotcraft「视觉从产品 tokens 生长」的默认路线。
   理由 = 用户已批准纸感品牌片（任务书硬约束），文案一字不改。
2. **节奏网格 120 BPM**（T2 / cues-v2.json），spec.FILM.bpm=96 不改：场景边界 5s 同时落 96 与 120 的拍点；
   任务书允许 96–120 BPM groove。转场硬切全部落在 5s 边界（= 96 BPM 第 8 拍整数倍）。
3. **FlashCut 放在 S1→S2 切点（5s）而非 S2 收束（9s）**：R4 要求相邻整画面冲击间隔 ≥16 拍。
   9s→15s 仅 12 拍（@120）/ 9.6 拍（@96）不达标；5s→15s→25s 各隔 10s = 16 拍 @120 ✓。
   S2 收束闪核保留为**局部**径向核（CardFlock CoreFlash，840px，不作用整画面），不占 R4 名额。
4. **riso demo 的整页 1.2% 顿挫 kick 弃用**：S4 的整画面名额已给 crash-zoom；裂版震荡 / slam / 套准脉冲
   只作用警示章元素层（R4「其余拍点只动元素层」）。
5. **裂版期白字保持套准**（选择记录）：「相互作用」白字单独一层、不随绿×橙印版错位，
   裂版 44f 期间始终可读（Q11 不允许「想让人读但读不清」的中间态）；套准即恢复双版重合深墨色。
6. **S6 俯冲压缩到 45f（1.5s）**：任务书时间表指定 local f15–45、26.5s 落定。R3「主体动作弧 ≥3s」
   适用于主体动作（S1 巡览 4s、S2 扫描+翻飞 4s、S4 推近→套准 3.47s、S5 印字→走满 3s 均达标）；
   俯冲是相机级冲击而非主体弧，落定后字标 hold 2s 补偿呼吸。
7. **S2 计数加纸感 scrim**（卡面小条 + 硬偏移投影）：墨点环扩张扫过计数区，垫底保证对比度（Q11）。
8. **S4 药瓶标签的 paper 材质投影残影保留**：与 v1 同一皮肤语法（剪纸硬投影作用于全部 item 含文字），
   读作印刷偏移而非 bug；不改 lib/film 以免影响 v1。
9. **S5 音效偏移未实测补偿（S5 准则）**：合成 score 的攻击峰在事件头（无源文件峰值滞后），
   但 AAC priming ≈1.3f 的输出偏移未做交叉相关实测（v1 同管线同口径）。如实记录为未做项。
10. **CameraMotionBlur 仅在相机运动窗 f4–45 启用**：首渲在 f846（hold 段）挂起——hold 无运动却仍跑
    8 重采样（6720×3300 点阵地面+mask+3D+blur）拖死渲染。改为运动窗外包 blur、窗内直接渲；
    dive 期间 shutter200/samples8 不降档（守命门），落定帧运动≈0 故切换无缝。重渲 concurrency=2。
11. **终检必须修复项落实（独立审查 abb4faa9 回报后）**：
    - Q11：辅助字 32/34 档统一提至 36（S3 戳/已完成//3/剂量、S4 示例、S5 戳/窗口标注/标签、S6 合影章/功能行、
      S2 后缀、品牌小字），ScanBracketDoc 设计坐标 8→9 / 10.5→11（×4 栅格化后 ≥36），使有效 ink ≥32。
    - A7/S声1：cues-v2 的 7 处 drop（正弦扫频 bloop，游戏感）全部换 knock（木质敲击拟音），保留动作语义。
    - A8：新增 bgm inputProp；cues-v2-sfx.json（仅 events、无 bed/patterns）→ public/score-v2-sfx.wav；
      交付带 BGM（film-v2.mp4）与无 BGM 保留 SFX（film-v2-nobgm.mp4）两版，同一时间线。v1 score.wav 已还原。
    - A10：音源为工程内原创合成（scripts/score.mjs，seed=7），无外部采样/Freesound 素材，故无素材页/许可/哈希
      要求；记录豁免理由=用户批准的合成配乐方向，非第三方音源。
12. **删除 S2 墨点环（用户反馈裁决）**：multiply 墨色湍流环在暖纸上读作灰褐脏烟圈（介质翻译错误：原 demo
    为暗场 screen 极光环），罩脏主角与计数、违反 Q4。整组件 InkRing 删除；落定重量改由落锤回弹+接触影收紧+
    knock 木音承担（原本已有）。局部暖白闪核 CoreFlash 保留（6f、不占 R4 名额）。重渲双版本。
13. **中景三盒补来源戳（用户反馈裁决）**：原中景左/右两盒无标注、来源胶囊在近景虚化层，语义悬空读作装饰
    （违反 Q1/F3 表达明确性）。改为三盒=三来源各一盒：左药店(ink)/中医院(green,hero)/右网购(orange)，
    清晰 32px 戳于 ~0.9s 错峰出现（早于主角浮起），呼应标题「3 个来源」；删除原 hero 单独大角标避免「医院」重复。
    主角弧保留浮起+暖橙描边。重渲双版本。
14. **flock 段可读性包（用户反馈裁决：7s「看不懂」）**：① C1 解说字幕 COPY.s2flock「医院、药店、网购——收进一个箱」
    60px 于 7.0–8.6s（退场让位 9s 品牌句）；② 站定间距 135→200（>盒宽190，8 盒水平完全分离可数）+ ±46 双排错开；
    ③ 收束提前 0.3s（CARD_OUT 50–60→47–57，RING_T0 同步），压缩哑巴窗口。数量守恒与落定计数不变。重渲双版本。
15. **药物形态重做（用户反馈裁决：「药样子不明显」，提议圆/胶囊）**：原 medBox 剪影像信封。新增五种一眼可认的
    药物形态（lib/film：capsuleItems 双色胶囊 / tabletItems 刻痕圆片 / blisterItems 铝塑泡罩 / cartonItems 带十字+胶囊图标药盒 /
    bottle），PaperBox 增 form prop；8 药分配 MED_FORMS（hero=铝塑板，与扫描单/中景一致），S1 远中近景混合形态。
    v1 的 medBoxItems 不动（v1 保持原样）。删除 flock 偶数盒灰衬底（圆片后垫灰卡显脏）。重渲双版本。

## 1. 镜头 → demo / 组件映射（P4：一种手法只当一次主角）

| 镜头 | 秒 | 主角手法 | 来源 demo / 组件 | 复用件 |
|---|---|---|---|---|
| S1 问题 | 0–5 | depth-layer 视差巡览（只 S1） | demos/camera/depth-layer-moves/MultiplaneReal.tsx → `v2/Scene1.tsx`（前任） | `FlyingWordsTunnel`（demos/typography/flying-words 改皮，垫底）、`PaperBox` |
| S2 录入 | 5–10 | card-flock 翻飞汇聚（只 S2） | demos/transition/card-flock-tumble → `v2/CardFlock.tsx`；demos/effects/scan-bracket-sweep → `v2/ScanBracketDoc.tsx`（前任） | `v2/lib/DigitRoll`（assets/lib 同源 copy）、墨点环、局部闪核 |
| S3 依从 | 10–15 | 发牌式硬加速错峰 + 打勾 impact | v1 Scene03 版式升级；发牌隐喻 = aesthetic-rules R2 判例 | `v2/lib/DigitRoll` 每勾重滚 |
| S4 冲突 | 15–20 | riso 裂版套准（只 S4）+ crash-zoom | demos/effects/riso-print-hits/RisoMisregistrationHit.tsx 改皮 → `v2/Scene4.tsx` | 绿×橙双版 multiply、44f 衰减震荡、f104 硬切 + 脉冲 + 核对圆章 |
| S5 效期 | 20–25 | 逐字印出 + slam + 加速窗口条 | v1 Scene05 元素升级 → `v2/Scene5.tsx` | 橙盒 / 标签 / 提醒卡 / 90 天条 |
| S6 落版 | 25–30 | drone-dive-landing（只 S6）+ Q8 合影 | demos/camera/space-camera-moves/DroneDiveLanding.tsx 改皮 → `v2/Scene6.tsx` | CameraMotionBlur(200°,8)、点阵地面、接触影、四方飞入四代表 |
| 转场 | 5/10/15/20/25 | 硬切卡点；仅 5s 一次 FlashCut | assets/lib/FlashCut.tsx → `v2/lib/FlashCut` | 替代 v1 匀速左擦 |

## 2. 整画面 / 相机级冲击清单（R4 ≤3，相邻 ≥16 拍）

| # | 帧 | 秒 | 手法 | 强度 |
|---|---|---|---|---|
| 1 | 150 | 5.0 | FlashCut 暖白闪核 10f（S1→S2 硬切） | 峰值 opacity 0.85 |
| 2 | 450–464 | 15.0 | crash-zoom 整画面 scale 1.3→1（14f）+ 方向性拖影 | S4 开场推近 |
| 3 | 750–795 | 25.0–26.5 | drone-dive 相机三轴俯冲（rotX 72→0 / scale 0.42→1）+ CameraMotionBlur | S6 落定 |

间隔 150→450→750 各 300f = 10s = 16 拍 @120 ✓。其余全部拍点（slam / 微震 / 裂版 / 脉冲 / 发牌 / 打勾）只动元素层。
S2 收束 CoreFlash 为局部 840px 径向核，不计入。

## 3. 审美逐条自检（aesthetic-rules）

- **Q11 ✓** 字幕全 60px 档：S2 cap 60 衬线、S3/S4/S5 cap 60、S6 slogan 60。辅助 ≥32：S3 药名 40 / 剂量 32 /
  类目戳 32 / 计数 44 / 「/3」32；S4 白字 56 / 核对 40 / 示例 32 / 核对卡 36；S5 标签 34 / 卡题 48 / 戳 32 /
  窗口标注 32；S6 功能行 34 / 迷你章 32；S2 计数 44 / 后缀 34 / 扫描单字段 44 / 标签 32（design 8×zoom4）；
  S1 副题 60 / 角标 32。纹理态文字（S1 来源胶囊 64px blur7、隧道词 opacity≤0.34、S6 迷你清单卡线条）明显虚化/无字，不诱读。
  验收帧：out/v2-check/s1-f90 / s2-f280 / s3-f430 / s4-f560 / s5-f705 / s6-f880。
- **R1 ✓** 字标 26.5 slam 落定，28.0–30.0 全静 hold 2s（≥1s）；f820 与 f880 逐像素同构图（仅 slogan 显影差）。
- **R2 ✓** 发牌间隔 0.4→0.25s 硬加速（EASE.in 末段硬着陆）+ 满板 11.7→首勾 12.25 静 0.55s；
  窗口条 EASE.in 加速走满；S5 走满 23.5→切点 25 静 ≥0.8s；S3 尾静 ≥0.8s；S6 hold 2s。无匀速主体运动
  （隧道/墨环为环境层缓动曲线，非匀速直线）。
- **R3 ✓** 主体弧：S1 drive 0.2–4.2s（4s）+ 浮起收束；S2 扫描 1.75s + 翻飞 1.4s + 吸入 = 4s 弧；
  S4 15.0→18.47 = 3.47s；S5 20.5→23.5 = 3s。S6 俯冲 1.5s 为相机冲击（见偏离 6）。
- **R4 ✓** 见 §2，3 处、间隔 16 拍；无逐拍整画面泵（kick 只进音轨不进画面）。
- **Q3 ✓** 零手持抖动；微震 = 打勾/slam 的元素层衰减余弦（3px、τ0.08s、0.3s 窗口外精确 0），叙事性 impact 非相机噪声。
- **Q4 ✓** 光效单点：S2 扫描光带一次、裁进文档 10px 圆角；CoreFlash 局部径向核一次；无群发 glint、无发光皮肤。
- **Q5 ✓** S1 单主角 = 中景绿盒（hero 浮起 + 橙描边 + 来源角标一条完整弧）；8 盒是其景深环境、隧道是垫底纹理。
- **Q2 ✓** ScanBracketDoc DesignStage raster=zoom（4× 布局级栅格化）；PaperBox/药箱/药瓶全 SVG 矢量，俯冲放大不糊。
- **Q8 ✓** 结尾合影：药盒(S1)/药瓶(S4)/清单卡(S3)/警示章(S4) 四代表自四角飞入围住字标，间隔 0.3→0.25→0.2 加速，
  27.77 全部落位真实槽位（Q9：落定即静止坐标，不悬浮漂移）。
- **P4 ✓** flock 只 S2、riso 只 S4、depth-layer 只 S1、drone-dive 只 S6；六镜头各给新信息（问题/录入/依从/冲突/效期/品牌）。
- **确定性 ✓** v2 全链路无 Math.random / Date.now：polish hash / mulberry32 固定种子、FlyingWords sin-hash、
  InkFilter 固定 seed、score.mjs seed=7。
- **S2（声音准则）✓** 连发阶梯递减 + 间隔加速：见 §4 表（发牌 0.16→0.13→0.10 / 0.4→0.25s；
  合影 0.12→0.10→0.08→0.06 / 0.3→0.25→0.2s；flock 0.10→0.07 / 0.35→0.3→0.25s）。
- **S5（声音准则）✗（未做）** 输出音轨 AAC priming 偏移未实测补偿，见偏离 9。

## 4. SFX 钉帧表（帧号 = 秒×30；音源/音量 = scripts/cues-v2.json；画面动作逐条注释）

 groove 层（patterns）：pluck 旋律 every 2 拍全片（D4 F4 A4 G4，0.14）+ pad D3/A2 bed；
 kick every 2 拍 f150–840（0.20）· hat 反拍 every 1 拍 f157.5 起（0.05）· clap every 4 拍 f180 起（0.09）——f840(28s) 鼓层撤出留 hold。

| 帧 | 秒 | 音源 | 音量 | 对应画面动作 |
|---|---|---|---|---|
| 15 | 0.5 | bell E5 | 0.14 | S1 主标题逐字起 |
| 45 | 1.5 | bell A4 | 0.10 | S1 副题浮起 |
| 120 | 4.0 | drop 700 | 0.08 | S1 hero 盒浮起起点 |
| 150 | 5.0 | whoosh | 0.22 | S1→S2 硬切 + FlashCut（冲击#1） |
| 153 | 5.1 | scratch | 0.07 | 扫描光带起趟 |
| 161/165/169 | 5.375/5.5/5.625 | tick 3000/3200/3400 | 0.12/0.10/0.08 | 扫描单三行绿勾确认（阶梯递减） |
| 202 | 6.75 | whoosh | 0.12 | 识别单退场让位 flock |
| 210 | 7.0 | whoosh | 0.18 | flock 翻飞起手 |
| 216/226/235/243 | 7.2/7.55/7.85/8.1 | tick 2400→3000 | 0.10/0.09/0.08/0.07 | 翻飞拍点（pan 交替 + 间隔 0.35→0.3→0.25 加速） |
| 260 | 8.6667 | whoosh | 0.16 | 10f 吸入药箱中心 |
| 270 | 9.0 | knock + bell D5 | 0.30/0.18 | 墨点环炸开 + 药箱落定（元素层 slam） |
| 277 | 9.25 | tick 3600 | 0.08 | 计数 DigitRoll 起滚 |
| 300 | 10.0 | whoosh | 0.18 | S2→S3 硬切 |
| 319 | 10.65 | knock 700 | 0.12 | 清单卡滑入着陆 |
| 331/343/351 | 11.05/11.45/11.7 | tick 2600/2900/3200 | 0.16/0.13/0.10 | 三行发牌硬着陆（间隔 0.4→0.25 加速 + 阶梯） |
| 367/382/397 | 12.25/12.75/13.25 | knock 620/660/700 | 0.18/0.15/0.12 | 三次打勾 impact（与卡片微震同帧） |
| 397 | 13.25 | bell A4 | 0.10 | 满板 3/3 |
| 412 | 13.75 | bell E5 | 0.08 | S3 字幕起 |
| 450 | 15.0 | whoosh + boom 40 | 0.26/0.22 | crash-zoom 推近（冲击#2） |
| 495 | 16.5 | knock 500 | 0.14 | 两瓶相遇顿挫合拢 |
| 510 | 17.0 | knock 440 | 0.32 | 警示章 slam + 同帧裂版 |
| 511 | 17.05 | scratch | 0.05 | 裂版震荡期印刷摩擦 |
| 554 | 18.4667 | tick 3600 + knock 800 | 0.14/0.12 | 硬切套准 + 核对圆章盖下 |
| 558 | 18.6 | drop 600 | 0.10 | 规则库核对卡落下 |
| 564 | 18.8 | bell A4 | 0.10 | S4 字幕起 |
| 600 | 20.0 | whoosh | 0.18 | S4→S5 硬切 |
| 615 | 20.5 | scratch | 0.07 | 效期标签逐字印出 |
| 660 | 22.0 | knock | 0.22 | 提醒卡 slam（微震同帧） |
| 705 | 23.5 | drop 900 | 0.12 | 90 天窗口条加速走满 |
| 712 | 23.75 | bell A4 | 0.10 | S5 字幕起 |
| 750 | 25.0 | whoosh 1.0s | 0.24 | 俯冲 rush（冲击#3 导入） |
| 795 | 26.5 | boom 38 + knock + bell D5 | 0.26/0.20/0.22 | 气垫落定 + 字标 slam（冲击#3 命中） |
| 810 | 27.0 | bell A4 + drop 760 | 0.14/0.12 | 口号起 + 合影代表①药盒落位 |
| 818 | 27.2667 | pluck D4 | 0.12 | 功能行起 |
| 819/826/832 | 27.3/27.55/27.75 | drop 820/880/940 | 0.10/0.08/0.06 | 合影代表②③④落位（间隔 0.25→0.2 加速 + 阶梯 + pan 交替） |
| 862 | 28.75 | bell D5 dur3 | 0.16 | hold 期尾音（28–30 全静画面） |

## 5. 验证记录

- `npx tsc -p .` 0 错。
- 逐场景 still 自检（P1）：out/v2-check/s1-f90、s2-f280、s3-f405、s3-f430、s4-f525、s4-f560、s5-f705、
  s6-f765、s6-f820、s6-f880（修字高/scrim 后 s2-f280、s6-f880 重渲）。
- 整片：`npx remotion render FilmV2 out/film-v2.mp4 --concurrency=4 --timeout=120000`；
  `node scripts/check.mjs out/film-v2.mp4` 结果见交付说明（运动曲线无长 dead spot：每场景均有 hold 但 ≤2s 且为 R1/R2 计划停顿）。