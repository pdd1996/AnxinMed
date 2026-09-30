# @anxin/mobile — 安心用药 RN 安卓客户端

M5 安卓迁移的患者端（Android-only，Expo 本地打 APK 真实模拟，不上商店）。
任务书：[docs/specs/05-M5-安卓迁移与服务端上云.md](../../../docs/specs/05-M5-安卓迁移与服务端上云.md)——T3 脚手架 / T4 骨架 / T5 界面移植 / T8 提醒。

## 常用命令（在 app/ 下执行）

```bash
pnpm --filter @anxin/mobile android:dev      # metro 真机调试（自动探测电脑局域网 IP，见下节）
pnpm --filter @anxin/mobile android:release  # release 构建；APK 产物在 android/app/build/outputs/apk/release/
pnpm --filter @anxin/mobile start            # 仅起 metro（配合已装的 dev client）
pnpm --filter @anxin/mobile env:print        # 只打印探测到的 API 地址，不起服务
pnpm --filter @anxin/mobile machine:id       # 打印本机指纹（主机名/系统/内存/有无模拟器），状态表标机器用
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

`EXPO_PUBLIC_API_URL` 由构建期注入，core 侧经 `setApiBaseUrl` 装配（M5-T4 接缝：RN 没有「同源」概念）。
优先级（高 → 低），实现见 `scripts/with-lan-url.mjs`：

1. shell 里已有的 `EXPO_PUBLIC_API_URL`（临时指别处）；
2. `ANXIN_LAN_IP`（多网卡 / 挂着 VPN 时点名某张卡，例：`ANXIN_LAN_IP=192.168.110.22 pnpm --filter @anxin/mobile android:dev`）；
3. `.env.local` 里的显式值（手工固定，默认已注释掉——**换 Wi-Fi 不再需要改文件**）；
4. 本机探测的局域网 IPv4 + `ANXIN_API_PORT`（默认 8787），Wi-Fi 网卡优先。

release 走另一条：`pnpm --filter @anxin/mobile android:release` = `scripts/release-apk.mjs`，
地址只认 shell 里的 `EXPO_PUBLIC_API_URL` 或 `.env.production.local`（指向火山），**不做** LAN 探测——
以免把开发机地址打进发布包。两条硬拦：没有地址就拒绝出包；值是 `10.0.2.2`/`localhost`/`127.0.0.1` 也拒绝出包。
未配置时首页会红字显示「还没配好服务器地址」——禁静默失败。

### release 包的两条收紧（写在 prebuild 插件里，不是手改 android/）

`android/` 整目录被 `.gitignore` 忽略、由 `expo prebuild` 生成——手改既进不了版本库，也会在下次 prebuild 被抹掉。
所以下两条落在 `plugins/with-release-hardening.js`（已在 `app.json` 的 `plugins` 注册），换机 prebuild 后自动就位。

1. **不带开发者菜单**：`expo-dev-*` 一族的 `expo-module.config.json` 只在 iOS 侧标了 `debugOnly`，Android 侧
   autolinking 不分变体——直接 `expo run:android --variant release` 打出来的包里就有 `DevLauncherPackage`
   与 `exp+<slug>://` 深链（外部 intent 可拉起它去连任意 metro 地址）。插件往 `settings.gradle` 注入一段
   「读 `ANXIN_RELEASE_BUILD` 环境变量 → 给 `expoAutolinking.exclude` 填这四个包名」；出包脚本置位，
   dev 出包不置位 → 调试链路不变。
   自检：`aapt dump xmltree app-release.apk AndroidManifest.xml | grep exp+` 应无输出。
2. **双 ABI**：`expo run:android` 只在 **debug** 变体按已连设备的 ABI 传 `-PreactNativeArchitectures`，
   release 变体用 `android/gradle.properties` 里的值。模板值若只有 `x86_64`，release 包装进 ARM64 真机会报
   `INSTALL_FAILED_NO_MATCHING_ABIS`（现象是「装不上」，与代码无关）。插件把它写成 `arm64-v8a,x86_64`。
   自检：`unzip -l app-release.apk | grep -oE "lib/[A-Za-z0-9_-]+/" | sort -u` 两行都要在（**注意**用 `[A-Za-z0-9_-]`——`arm64-v8a` 带连字符，`[a-z0-9_]` 会漏掉它，看着像「只有 x86_64」）。

prebuild 之后先验这两条再出包（插件确实跑到了）：`grep -c ANXIN_RELEASE_BUILD android/settings.gradle` 应为 `1`；
`grep ^reactNativeArchitectures android/gradle.properties` 应为 `arm64-v8a,x86_64`。

## 页面与里程碑边界（M5-T5a 现状）

`src/app/` 根 stack：`(patient)`（五 tab：今日/药箱/记录/我的/设置；分组内不走系统头部，页内自出标题）·
`intake`（拍药盒 → 层检测 → 识别 → 草稿）· `drafts/[id]`（唯一闸门：确认建档）· `probe`（T3 的网络探测页）。
今日/记录/我的 目前是**按分片占位**（真机可见「路由 /xxx · 真实实现见 M5-T5x」，不是假按钮），设置页的字号两档已真实生效。
分组不改变 URL：`/box`、`/intake`、`/probe` 等路径与 T4 一致，旧链接与 `router.push("/box")` 全部照用。

- 六步流转的**决策**全在 `@anxin/core` 的 `transitionIntakeFlow`（纯函数、已单测），本包只做动作解释与渲染；
- **一期不做本地质量预检**（05 任务书 T2/T4 允许降级：预检只是建议不拦用户），二期用 expo 侧像素统计补 `compute_stats` 分支；
- 处方笺入口 T6、Home/Box/Records/Profile 全量移植 T5b~T5e、提醒 T8、图表与 Maestro T9 —— 见 `T4-真机验收.md` 与任务书 05。

## 字号全局缩放（M5-T5a 接线，改这三处前两读）

NativeWind v4 的 rem 有两条路：**编译期内联**（`inlineRem` 是数字 → `1rem` 直接烤成常数，运行时改不动）与
**运行时可观察量**（`inlineRem: false` → 每个 rem 值留成 `["rem", n]` 描述符，`rem.set()` 一改全 app 重解析）。
本项目走后者，与 web 的 `html{font-size}` 驱动 rem 同语义，三处必须同时成立：

1. `metro.config.js`：`withNativeWind(config, { input, inlineRem: false })`——**去掉这个参数就静默退回内联 14**，字号档切换立刻失效（不报错、不改样式表现，只是没反应）；
2. `src/global.css`：`:root { font-size: 17px }` 是 normal 档首帧初值（persist 水合前也走它）；
3. `src/components/FontScaleSync.tsx`：`FONT_ROOT_DP = { normal: 17, large: 20 }`，订阅 core 的字号 store 执行 `rem.set()`；store 在 `src/stores/fontScale.ts`（AsyncStorage 持久化，键 `anxin-font-scale`）。

副作用要知道：rem 从烤死的 14 变成活的 17，**所有 rem 基准的文字与间距整体放大约 21%**（写死 px 的 `min-h-[44px]` 一族不受影响）。
自检（**不需要真机**，看产物里 rem 是否还是活的）：

```bash
cd app/packages/mobile && npx expo export --platform android --dev --no-bytecode --output-dir /tmp/anxin-rem-check
grep -o 'rem:[0-9.]*' /tmp/anxin-rem-check/_expo/static/js/android/*.js | head -1   # 预期 rem:17
grep -c '"rem"' /tmp/anxin-rem-check/_expo/static/js/android/*.js                    # 预期 >0（描述符仍在）
```

只剩烤死的数字、`rem` 计数归零，就是内联被改回来了。

## workspace 源码引用与 Metro（改坏了会在 bundling 期才炸）

`@anxin/core` / `@anxin/shared` 的 `exports` 直接指向 `src/*.ts`（前端不产 dist），故 Metro 需要：

1. `watchFolders` 含 workspace 根、`nodeModulesPaths` 含 `app/node_modules`（hoisted 布局）；
2. **`.js` 后缀回落 `.ts`**：shared/core 是 NodeNext 风格相对导入（`export * from './enums.js'` 指向 `enums.ts`），
   node/Vite 能映射，Metro 默认不能 → `metro.config.js` 的 `resolveRequest` 在解析失败时换扩展名重试。
   验证命令（不需要真机）：`npx expo export --platform android --output-dir /tmp/anxin-bundle-check`。

`tsconfig.json` 显式 `"types": ["node"]`：core 的 `import type { AppType } from '@anxin/api'` 会把 api 源码拉进类型图，
那些文件 `import 'node:fs'`（与 web/api 包同款处理，本机祖先链有损坏的隐式 @types 残留）。

## 本机工具链与构建环境（换机/prebuild --clean 后必读）

- **本仓库在两台 Windows 机器上跑，构建/装机/网络探测的结论全是分机器的**：一条「盘上有几个 ABI」「代理通不通」如果不标机器就无法复盘。**约定：任何验收状态表记实测事实时，同时记 `pnpm --filter @anxin/mobile machine:id` 输出的 `Host` 值**（该脚本只读，打印主机名 / Windows 版本（靠 build 号分 10 与 11）/ 内存 / 有无 AVD / ANDROID_HOME）。已知两台：`Robot`（Win 11，带模拟器 `Medium_Phone_API_36`），另一台 Win 10 / 8GB **不带模拟器**（只能真机联调，其 Host 待该机自报后补进此处与状态表）。

- `ANDROID_HOME` 指向本机 Android SDK（路径因机而异，勿照抄）；查法：PowerShell `[Environment]::GetEnvironmentVariable('ANDROID_HOME','Machine')`
- 版本号（platform-tools / build-tools / platforms）由 Expo SDK 决定，不必与文档对齐：构建时 gradle 会打印实际采用的 `compileSdk / targetSdk / buildTools / ndk / kotlin`，以它为准；本机 SDK 装的是哪些版本用 `sdkmanager --list` 查
- JDK **必须 17**（官方文档明确「更高版本可能出问题」，勿升 21/25）
- pnpm 布局：workspace 根 `pnpm-workspace.yaml` 已设 `nodeLinker: hoisted`（npm 同款扁平布局）——隔离布局下 babel 转译器解析不到传递依赖、C++ 编译超 Windows 260 字符路径，勿改回
- **新增带原生模块的依赖时不必 prebuild**：`android/` 走 expo-modules 自动链接（库自带的 AndroidManifest 会合并权限，
  例：expo-image-picker 声明 `CAMERA`）。直接重跑 `android:release` 即可。
  真要点 prebuild 时注意：`expo prebuild --platform android` **默认就会先删 `android/`**（不加 `--clean` 也一样），
  目录被 Gradle/编辑器占住时报 `EBUSY: resource busy or locked` 并中止——先关掉占用的进程再动，
  且 `android/` 不入 git，删了只能靠 prebuild + 下面三个补丁重建。
- `prebuild --clean` 会重生成 android/，届时需重打三个**网络镜像类**补丁（插件不管这些）：
  1. `android/build.gradle` 两个 repositories 块在 `mavenCentral()` 前插一行 `maven { url 'https://maven.aliyun.com/repository/public' }`
  2. `android/gradle/wrapper/gradle-wrapper.properties` 的 `distributionUrl` 换腾讯镜像 `https://mirrors.cloud.tencent.com/gradle/gradle-9.3.1-bin.zip`（官方源本机仅 ~40KB/s）
  3. `android/gradle.properties` 追加 `systemProp.socksProxyHost=127.0.0.1` / `systemProp.socksProxyPort=10808`（v2rayN；境外源走梯子，国内源按路由直连。**代理没开时 Gradle 一切外连都会挂**，本机 09-29 实测：v2rayN 未运行时靠 `~/.gradle` 缓存照旧能出包）
- 过渡期 `usesCleartextTraffic: true`（app.json expo-build-properties），切 HTTPS 后关闭
- 已知版本漂移（实测不影响构建与运行，暂不动）：`react-native-svg` 装 15.15.5，Expo 57 期望 15.15.4，而 `package.json` 写的 `^15.15.5` 永远解析不到它。**下次重建原生层时顺路归位**：`npx expo install react-native-svg --fix`（改的是原生模块，须与重建同批做，单独改会留下 manifest 与 node_modules 不一致）
