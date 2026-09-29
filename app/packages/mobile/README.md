# @anxin/mobile — 安心用药 RN 安卓客户端

M5 安卓迁移的患者端（Android-only，Expo 本地打 APK 真实模拟，不上商店）。
任务书：[docs/specs/05-M5-安卓迁移与服务端上云.md](../../../docs/specs/05-M5-安卓迁移与服务端上云.md)——T3 脚手架 / T4 骨架 / T5 界面移植 / T8 提醒。

## 常用命令（在 app/ 下执行）

```bash
pnpm --filter @anxin/mobile android:dev      # metro 真机调试（手机开 USB 调试插电脑）
pnpm --filter @anxin/mobile android:release  # release 构建；APK 产物在 android/app/build/outputs/apk/release/
pnpm --filter @anxin/mobile start            # 仅起 metro（配合已装的 dev client）
```

### metro 调试白屏：先查 8081 是否被上次会话遗留的 metro 占着

`expo run:android` / `expo start` 会**复用**已在 8081 上的 dev server，而不是新起一个。若上一次会话的 metro 已成僵尸（端口在听、打包请求不返回），debug 包装上后就是**一直白屏**——现象与「代码有问题」极像，实际是连不上可用打包服务。

```bash
netstat -ano | grep ":8081" | grep LISTENING      # 看占用者 PID
powershell -NoProfile -Command "Get-Process -Id <PID> | Select Id,ProcessName,StartTime"  # 确认是哪个会话留下的
taskkill //PID <PID> //F                          # Git Bash 下双斜杠；cmd 里是 /PID <PID> /F
```

结束后可选端口起服务避开残留：`npx expo start --port 8082`，再用深链把 dev client 指过去：
`adb shell am start -a android.intent.action.VIEW -d 'exp+anxin-medication://expo-development-client/?url=http://10.0.2.2:8082'`（模拟器用 10.0.2.2 访问宿主机；真机填电脑局域网 IP）。

模拟器卡在 `offline` 是另一回事：跑过 `adb kill-server` 之后，正在运行的模拟器会一直显示 offline——guest 其实早就开好了（`getprop sys.boot_completed` 为 1、AVD 目录落了 `bootcompleted.ini`），是 adb 与模拟器的注册断了且不会自动重连，`adb reconnect offline` 无效。解法是重启模拟器（别再动 adb server）。

## API 地址（禁止硬编码）

`EXPO_PUBLIC_API_URL` 环境化：`.env.local` 指向电脑局域网 IP（dev 真机连 LAN）；release 复制 `.env.example` 为 `.env.production.local` 指向火山。首页内置网络探测页，对 `/api/health` 打通为准。

## 本机工具链与构建环境（换机/prebuild --clean 后必读）

- `ANDROID_HOME` 指向本机 Android SDK（路径因机而异，勿照抄）；查法：PowerShell `[Environment]::GetEnvironmentVariable('ANDROID_HOME','Machine')`
- 版本号（platform-tools / build-tools / platforms）由 Expo SDK 决定，不必与文档对齐：构建时 gradle 会打印实际采用的 `compileSdk / targetSdk / buildTools / ndk / kotlin`，以它为准；本机 SDK 装的是哪些版本用 `sdkmanager --list` 查
- JDK **必须 17**（官方文档明确「更高版本可能出问题」，勿升 21/25）
- pnpm 布局：workspace 根 `pnpm-workspace.yaml` 已设 `nodeLinker: hoisted`（npm 同款扁平布局）——隔离布局下 babel 转译器解析不到传递依赖、C++ 编译超 Windows 260 字符路径，勿改回
- `prebuild --clean` 会重生成 android/，届时需重打三个补丁：
  1. `android/build.gradle` 两个 repositories 块在 `mavenCentral()` 前插一行 `maven { url 'https://maven.aliyun.com/repository/public' }`
  2. `android/gradle/wrapper/gradle-wrapper.properties` 的 `distributionUrl` 换腾讯镜像 `https://mirrors.cloud.tencent.com/gradle/gradle-9.3.1-bin.zip`（官方源本机仅 ~40KB/s）
  3. `android/gradle.properties` 追加 `systemProp.socksProxyHost=127.0.0.1` / `systemProp.socksProxyPort=10808`（v2rayN；境外源走梯子，国内源按路由直连）
- 过渡期 `usesCleartextTraffic: true`（app.json expo-build-properties），切 HTTPS 后关闭
- 已知版本漂移（实测不影响构建与运行，暂不动）：`react-native-svg` 装 15.15.5，Expo 57 期望 15.15.4，而 `package.json` 写的 `^15.15.5` 永远解析不到它。**下次重建原生层时顺路归位**：`npx expo install react-native-svg --fix`（改的是原生模块，须与重建同批做，单独改会留下 manifest 与 node_modules 不一致）
