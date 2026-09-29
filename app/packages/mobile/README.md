# @anxin/mobile — 安心用药 RN 安卓客户端

M5 安卓迁移的患者端（Android-only，Expo 本地打 APK 真实模拟，不上商店）。
任务书：[docs/specs/05-M5-安卓迁移与服务端上云.md](../../../docs/specs/05-M5-安卓迁移与服务端上云.md)——T3 脚手架 / T4 骨架 / T5 界面移植 / T8 提醒。

## 常用命令（在 app/ 下执行）

```bash
pnpm --filter @anxin/mobile android:dev      # metro 真机调试（自动探测电脑局域网 IP，见下节）
pnpm --filter @anxin/mobile android:release  # release 构建；APK 产物在 android/app/build/outputs/apk/release/
pnpm --filter @anxin/mobile start            # 仅起 metro（配合已装的 dev client）
pnpm --filter @anxin/mobile env:print        # 只打印探测到的 API 地址，不起服务
```

## API 地址（禁止硬编码）

`EXPO_PUBLIC_API_URL` 由构建期注入，core 侧经 `setApiBaseUrl` 装配（M5-T4 接缝：RN 没有「同源」概念）。
优先级（高 → 低），实现见 `scripts/with-lan-url.mjs`：

1. shell 里已有的 `EXPO_PUBLIC_API_URL`（临时指别处）；
2. `ANXIN_LAN_IP`（多网卡 / 挂着 VPN 时点名某张卡，例：`ANXIN_LAN_IP=192.168.110.22 pnpm --filter @anxin/mobile android:dev`）；
3. `.env.local` 里的显式值（手工固定，默认已注释掉——**换 Wi-Fi 不再需要改文件**）；
4. 本机探测的局域网 IPv4 + `ANXIN_API_PORT`（默认 8787），Wi-Fi 网卡优先。

release 走另一条：`.env.production.local` 指向火山（`EXPO_PUBLIC_API_URL=http://<IP>:8787`），
`android:release` **不做** LAN 探测，以免把开发机地址打进发布包。
未配置时首页会红字显示「还没配好服务器地址」——禁静默失败。

## 页面与里程碑边界（M5-T4 现状）

`src/app/` 下：`index`（首页三入口）· `intake`（拍药盒 → 层检测 → 识别 → 草稿）·
`drafts/[id]`（唯一闸门：确认建档）· `box`（药箱最简列表）· `probe`（T3 的网络探测页）。

- 六步流转的**决策**全在 `@anxin/core` 的 `transitionIntakeFlow`（纯函数、已单测），本包只做动作解释与渲染；
- **一期不做本地质量预检**（05 任务书 T2/T4 允许降级：预检只是建议不拦用户），二期用 expo 侧像素统计补 `compute_stats` 分支；
- 处方笺入口 T6、五页全量与 fontScale T5、提醒 T8、图表与 Maestro T9 —— 见 `T4-真机验收.md` 与任务书 05。

## workspace 源码引用与 Metro（改坏了会在 bundling 期才炸）

`@anxin/core` / `@anxin/shared` 的 `exports` 直接指向 `src/*.ts`（前端不产 dist），故 Metro 需要：

1. `watchFolders` 含 workspace 根、`nodeModulesPaths` 含 `app/node_modules`（hoisted 布局）；
2. **`.js` 后缀回落 `.ts`**：shared/core 是 NodeNext 风格相对导入（`export * from './enums.js'` 指向 `enums.ts`），
   node/Vite 能映射，Metro 默认不能 → `metro.config.js` 的 `resolveRequest` 在解析失败时换扩展名重试。
   验证命令（不需要真机）：`npx expo export --platform android --output-dir /tmp/anxin-bundle-check`。

`tsconfig.json` 显式 `"types": ["node"]`：core 的 `import type { AppType } from '@anxin/api'` 会把 api 源码拉进类型图，
那些文件 `import 'node:fs'`（与 web/api 包同款处理，本机祖先链有损坏的隐式 @types 残留）。

## 本机工具链与构建环境（换机/prebuild --clean 后必读）

- `ANDROID_HOME=D:\Android\SDK`（adb 37.0.1 / build-tools 36 / platforms android-37）；JDK **必须 17**（官方文档明确「更高版本可能出问题」，勿升 21/25）
- pnpm 布局：workspace 根 `pnpm-workspace.yaml` 已设 `nodeLinker: hoisted`（npm 同款扁平布局）——隔离布局下 babel 转译器解析不到传递依赖、C++ 编译超 Windows 260 字符路径，勿改回
- **新增带原生模块的依赖时不必 prebuild**：`android/` 走 expo-modules 自动链接（库自带的 AndroidManifest 会合并权限，
  例：expo-image-picker 声明 `CAMERA`）。直接重跑 `android:release` 即可。
  真要点 prebuild 时注意：`expo prebuild --platform android` **默认就会先删 `android/`**（不加 `--clean` 也一样），
  目录被 Gradle/编辑器占住时报 `EBUSY: resource busy or locked` 并中止——先关掉占用的进程再动，
  且 `android/` 不入 git，删了只能靠 prebuild + 下面三个补丁重建。
- `prebuild --clean` 会重生成 android/，届时需重打三个补丁：
  1. `android/build.gradle` 两个 repositories 块在 `mavenCentral()` 前插一行 `maven { url 'https://maven.aliyun.com/repository/public' }`
  2. `android/gradle/wrapper/gradle-wrapper.properties` 的 `distributionUrl` 换腾讯镜像 `https://mirrors.cloud.tencent.com/gradle/gradle-9.3.1-bin.zip`（官方源本机仅 ~40KB/s）
  3. `android/gradle.properties` 追加 `systemProp.socksProxyHost=127.0.0.1` / `systemProp.socksProxyPort=10808`（v2rayN；境外源走梯子，国内源按路由直连。**代理没开时 Gradle 一切外连都会挂**，本机 09-29 实测：v2rayN 未运行时靠 `~/.gradle` 缓存照旧能出包）
- 过渡期 `usesCleartextTraffic: true`（app.json expo-build-properties），切 HTTPS 后关闭
