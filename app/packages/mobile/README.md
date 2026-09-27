# @anxin/mobile — 安心用药 RN 安卓客户端

M5 安卓迁移的患者端（Android-only，Expo 本地打 APK 真实模拟，不上商店）。
任务书：[docs/specs/05-M5-安卓迁移与服务端上云.md](../../../docs/specs/05-M5-安卓迁移与服务端上云.md)——T3 脚手架 / T4 骨架 / T5 界面移植 / T8 提醒。

## 常用命令（在 app/ 下执行）

```bash
pnpm --filter @anxin/mobile android:dev      # metro 真机调试（手机开 USB 调试插电脑）
pnpm --filter @anxin/mobile android:release  # release 构建；APK 产物在 android/app/build/outputs/apk/release/
pnpm --filter @anxin/mobile start            # 仅起 metro（配合已装的 dev client）
```

## API 地址（禁止硬编码）

`EXPO_PUBLIC_API_URL` 环境化：`.env.local` 指向电脑局域网 IP（dev 真机连 LAN）；release 复制 `.env.example` 为 `.env.production.local` 指向火山。首页内置网络探测页，对 `/api/health` 打通为准。

## 本机工具链与构建环境（换机/prebuild --clean 后必读）

- `ANDROID_HOME=D:\Android\SDK`（adb 37.0.1 / build-tools 36 / platforms android-37）；JDK **必须 17**（官方文档明确「更高版本可能出问题」，勿升 21/25）
- pnpm 布局：workspace 根 `pnpm-workspace.yaml` 已设 `nodeLinker: hoisted`（npm 同款扁平布局）——隔离布局下 babel 转译器解析不到传递依赖、C++ 编译超 Windows 260 字符路径，勿改回
- `prebuild --clean` 会重生成 android/，届时需重打三个补丁：
  1. `android/build.gradle` 两个 repositories 块在 `mavenCentral()` 前插一行 `maven { url 'https://maven.aliyun.com/repository/public' }`
  2. `android/gradle/wrapper/gradle-wrapper.properties` 的 `distributionUrl` 换腾讯镜像 `https://mirrors.cloud.tencent.com/gradle/gradle-9.3.1-bin.zip`（官方源本机仅 ~40KB/s）
  3. `android/gradle.properties` 追加 `systemProp.socksProxyHost=127.0.0.1` / `systemProp.socksProxyPort=10808`（v2rayN；境外源走梯子，国内源按路由直连）
- 过渡期 `usesCleartextTraffic: true`（app.json expo-build-properties），切 HTTPS 后关闭
