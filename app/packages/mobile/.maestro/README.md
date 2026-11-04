# Maestro 冒烟（M5-T9-2）

5 条 flow：启动→药箱、录入一条、咨询一条、提醒设置、字号缩放。

## 前置

1. Maestro CLI（本机实测 2.12.0，Java 17）：
   ```bash
   ~/.maestro/bin/maestro --version
   ```
2. 安卓模拟器在线（本机 `Medium_Phone_API_36` / Android 36），已装 release 包：
   ```bash
   adb install -r android/app/build/outputs/apk/release/app-release.apk
   ```
3. 录入样张进相册（PhotoPicker 只认 `is_pending=0` 的媒体行，`adb push` 后必须逐文件广播）：
   ```bash
   MSYS_NO_PATHCONV=1 adb push "C:/Users/Paddy/Desktop/AnxinMed/app/fixtures/drug-box-labeled.png" /sdcard/DCIM/Camera/t9-box.png
   MSYS_NO_PATHCONV=1 adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/DCIM/Camera/t9-box.png
   ```
4. 通知权限已预授（否则提醒设置 flow 只断到「通知权限」文案，不弹系统窗）：
   ```bash
   adb shell pm grant com.anxin.mobile android.permission.POST_NOTIFICATIONS
   ```
5. 首次引导已确认、API 地址可达（release 包指向火山）。

## 运行

```bash
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
~/.maestro/bin/maestro test --udid emulator-5554 \
  .maestro/00-launch-box.yaml \
  .maestro/01-intake-box.yaml \
  .maestro/02-consult.yaml \
  .maestro/03-notification-settings.yaml \
  .maestro/04-font-scale.yaml
```

## 说明

- 冷启动今日页会按顺序弹出到点提醒弹窗，`helpers/dismiss-reminders.yaml` 用可访问性标签 `Close` 逐个关闭（坐标点在相册/弹窗不同布局下不稳）。
- 底部 tab 用坐标点（`30% / 50% / 70% / 90%, 96%`）：tab 的文字节点与页面正文重名（如正文里的「药箱」），文本选择器会点错。
- 相册缩略图用 `Photo taken on.*` 选择（PhotoPicker 不暴露文件名）；要求样张是相册第一张。
- **副作用**：`01-intake-box` 每条会新建 1 个药（确认建档），`02-consult` 每条会新建 1 个咨询会话；跑完按验收单 §6 回读并清理/登记。
- 提醒弹窗/相册选择/系统权限弹窗都依赖真机或模拟器 UI 文案，ROM 改版后需同步改选择器。