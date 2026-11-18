# 图标（唯一真相源 + 派生产物）

产品图标：白色圆角底板 + 绿色药丸 + 白色对勾（药丸中间一道「掰开缝」）。

## 真相源

`anxin_icon.png`（2048×2048）。注意它的四个圆角是**被导出压平成黑色的透明区**，不是设计上的黑色；
生成脚本会把它还原成 alpha。

## 重新生成

```bash
# 任意 Python 3 + Pillow + numpy 环境（DSH 运行时自带）
python app/icons/make_icons.py
# 可选：多输出一张人眼验收预览板（掩模 / 深色 / 小尺寸放大）
python app/icons/make_icons.py --preview %TEMP%\anxin-icon-preview
```

脚本做三件事：

1. **还原 alpha**：圆角底板（`黑角 → 透明`）与药丸（含掰开缝、对勾镂空）各得一份覆盖率；
2. **纯平色重建**：按实测主色把源图 ±2 级噪点抹平成纯色（重建误差 mean 0.37/255），小尺寸才不糊；
3. **按平台口径派生**：见下表。

**不要手改派生文件**：改图标就改 `anxin_icon.png` 或脚本参数，然后重跑。

## 配色

| 用途 | 值 |
|---|---|
| 底板（含 Android 自适应背景色） | `#F5F7F4` |
| 药丸 | `#127A58` |

## 产物

### 移动端（`app/packages/mobile/assets/images/`，由 `app.json` 引用）

| 文件 | 尺寸 | 口径 |
|---|---|---|
| `icon.png` | 1024 | 不透明满铺（iOS / 商店 / legacy launcher；**不允许透明角**） |
| `android-icon-foreground.png` | 1024 | 透明底药丸，缩到自适应安全区（见下） |
| `android-icon-monochrome.png` | 1024 | Android 13 主题图标：纯白剪影 + 对勾镂空，同安全区 |
| `notification-icon.png` | 1024 | 通知栏小图标：不进 launcher 安全区，药丸放大到 1.187× |
| `splash-icon.png` | 1024 | 启动图（源图比例，不缩安全区），配 `backgroundColor: #F5F7F4` |

`app.json` 摘要：`android.adaptiveIcon.backgroundColor = #F5F7F4`（不再用背景图）、
`expo-splash-screen.backgroundColor = #F5F7F4` + `imageWidth: 150`、
`expo-notifications.icon = notification-icon.png`。

### Web（`app/packages/web/public/`，Vite `publicDir` 默认，构建时整目录拷进 `dist/`）

| 文件 | 尺寸 | 用途 |
|---|---|---|
| `favicon.ico` | 16/32/48 | 浏览器标签页 |
| `favicon-16x16.png` / `favicon-32x32.png` | 16 / 32 | 同上（按尺寸声明） |
| `apple-touch-icon.png` | 180 | iOS 添加到主屏幕（不透明满铺） |
| `icon-192.png` / `icon-512.png` | 192 / 512 | PWA `any` |
| `icon-maskable-512.png` | 512 | PWA `maskable`（满铺底色 + 药丸缩进安全区） |
| `site.webmanifest` | — | PWA 清单（名称 / 主题色 `#25695b` / 图标） |

`index.html` 里对应 `<link rel="icon|apple-touch-icon|manifest">` 与 `theme-color`。

## 关键口径

- **Android 自适应安全区**：图层 108dp、安全区是中心 66dp 直径圆 → 药丸最远点须 ≤ `33/108 ≈ 0.306` 图层边长。
  源图里该比例是 `0.388`，故前景 / 单色统一缩 `0.788`；不放大会被圆形掩模削掉药丸两头（Pixel 等圆掩模启动器）。
- **favicon / PWA any**：保留源图圆角外形（透明角），并用上面同一套安全区缩放 —— 16px 下药丸也够大。
- **通知栏图标**：系统按 24dp 渲染且不经 launcher 掩模，所以反过来放大（`0.46 / 0.388 = 1.187`），否则状态栏里太小。
- 主题色 `theme_color` 用项目令牌 `#25695b`（Web 端 `--primary`），与图标绿 `#127A58` 是两个用途，别混用。

## 验收

跑 `--preview` 后看 `icon-preview.png`：满铺图标、圆角 favicon、圆形 / 方圆形掩模下的自适应前景、
深底单色、启动图模拟、PWA maskable、16/32px favicon 实际像素 ×8。脚本自带两条硬校验，不过就退出：

- **源图重建误差**（底板区 mean 必须 < 2/255，实测 0.37）；
- **药丸剪影外的游离像素必须为 0**——源图圆角抗锯齿边投影到「白→绿」线上会留下极淡假 alpha，
  不清掉就会在自适应前景 / 单色层里出现圆角鬼影弧线（历史踩坑，已按「底板剪影内缩 80px + 开运算」拦掉）。
