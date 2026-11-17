# 安心用药 · 30s 品牌片

温暖纸感剪纸风 Remotion 动效工程。成片 `out/film.mp4`（1920×1080 · 30fps · 30s · 96 BPM）。
设计契约与全部文案/数值在 `src/spec.ts`（S/X/E 账 + T 时间块）；六个场景在 `src/scenes/`。

## 首次准备（clone 后）

字体子集与纸纹是可再生的大二进制，**不进 git**，需先本地生成：

```bash
npm install
npm run fonts    # 下载 Noto Serif/Sans SC 子集到 src/fonts/（约 11MB，需联网）
npm run paper    # 预渲染纸纹到 public/paper.png（避免正片逐帧 turbulence）
```

## 渲染与自查

```bash
npm run render   # 出 out/film.mp4（prerender 自动合成配乐）
npm run check    # 格式/首帧/响度/频谱/运动曲线/关键帧，报告在 out/check/
npm run studio   # 交互预览
```

## 本机环境注意（Windows）

- **Temp 写入限制**：本机安全策略禁止 Remotion 内置 ffmpeg 写系统 Temp，渲染后 EPIPE/Permission denied。
  渲染前把临时目录指到工程内：`export TMP=$PWD/.tmp TEMP=$PWD/.tmp`（Git Bash），再 `npm run render`。
- **精简版 ffmpeg**：Remotion 内置 ffmpeg 无 rawvideo/ssim/spectrogram 等滤镜，故自查用 `scripts/check.mjs`
  （Node + image2pipe/png 等价实现），而非 skill 原版 `scripts/check.sh`（后者留作完整 ffmpeg 机器参考）。
- **并发**：`--concurrency=4` 稳定；过高并发曾在重滤镜帧崩溃浏览器。纸纹已改静态图，正片不再逐帧算 turbulence。

## 结构

```
src/spec.ts        设计契约 + 文案/数值账 + 时间块（改片子从这里入手）
src/lib/film.tsx   药盒/药箱/药瓶等形状构建器（E##）
src/lib/motion.tsx skill 提供的动效/材质工具（勿改）
src/scenes/        Scene01–06，绝对时间戳
src/Film.tsx       主时间线 + 持久药箱载体
scripts/score.mjs  配乐合成（cues.json → public/score.wav）
scripts/check.mjs  自查
scripts/fetch-fonts.mjs  字体自托管
```