# 正式签名与分发（G8）

> 现状（G8 前）：`android/app/build.gradle` 的 release 变体沿用 Expo 模板的 `signingConfigs.debug`，
> 打出的 APK 是 **debug 证书**（`CN=Android Debug`）签名——不可对外分发，也无法覆盖升级。
> G8 起 release APK 用本目录 `.credentials/` 里的 **正式 PKCS12 keystore** 签名，签名注入住在
> expo config plugin 里（`android/` 不入 git，手改会被下次 prebuild 抹掉），出包后自动验签归档。
>
> 真相源：本文件 + `plugins/with-release-signing.js` + `scripts/gen-release-keystore.mjs` +
> `scripts/verify-release-apk.mjs`。相关背景见 [README.md](./README.md)「本机工具链与构建环境」。

## 1. 文件与职责

| 文件 | 职责 |
|---|---|
| `plugins/with-release-signing.js` | **签名注入的唯一真相**：prebuild 期给 `android/app/build.gradle` 注入 `signingConfigs.release`（凭据走 Gradle project properties）并把 `buildTypes.release` 从 debug 换成 release；缺凭据时配置期抛 GradleException（fail-closed）；幂等；debug 构建行为不变。已注册在 `app.json` 的 `plugins`。 |
| `scripts/gen-release-keystore.mjs` | 生成正式 keystore（PKCS12 / RSA 4096 / 10000 天）+ `.credentials/release-signing.env`（随机强密码，不打印）；拒绝覆盖（`--force` 才重建，先备份旧文件）。 |
| `scripts/release-apk.mjs` | 出包入口（`pnpm --filter @anxin/mobile android:release`）：加载凭据 → `ORG_GRADLE_PROJECT_*` 传给 gradlew → 构建 → 自动验签归档；缺凭据/keystore/未 prebuild 时**在构建前**拒绝。`--check` 只做前置检查。 |
| `scripts/verify-release-apk.mjs` | 验签：`apksigner verify --print-certs`（CN=AnxinMed、非 Android Debug、恰好 1 个签名者、v2/v3）+ `aapt dump badging`（包名 `com.anxin.mobile`、非 debuggable、ABI 含 arm64-v8a）+ APK SHA-256；通过后复制到 `dist/release/` 并写 `release-apk-info.json`。 |
| `scripts/verify-release-signing-plugin.mjs` | 插件自验：对样例 `build.gradle` 直接断言注入形状 / 幂等 / debug 不变 / fail-closed，不跑 prebuild、不需要真机与 Gradle。 |
| `.credentials/` | 本机签名材料（**整个目录 gitignore**）：`anxin-release.p12` + `release-signing.env`。 |
| `dist/release/` | 验签通过后的归档产物（`dist/` 已 gitignore）。 |

`.gitignore` 里的拦截面（`app/packages/mobile/.gitignore`）：

```gitignore
# 正式签名凭据（scripts/gen-release-keystore.mjs 生成；keystore 与密码绝不入库）
.credentials/
```

自检：`git check-ignore -v app/packages/mobile/.credentials/release-signing.env` 必须命中。

## 2. 一次性准备：生成正式 keystore

环境：JDK **17**（`JAVA_HOME` 或 `ANXIN_KEYTOOL=<keytool 绝对路径>`；本机 JDK 在
`D:\03Environments\jdk17`，PATH 里的 keytool 已指向它）。

```bash
cd app/packages/mobile
node scripts/gen-release-keystore.mjs          # 首次；已存在会拒绝覆盖
node scripts/gen-release-keystore.mjs --help   # 全部选项
```

产物（不打印密码）：

- `.credentials/anxin-release.p12`：PKCS12、RSA 4096、SHA384withRSA、有效期 10000 天、别名 `anxin-release`、`CN=AnxinMed`；
- `.credentials/release-signing.env`：四行 `KEY=VALUE`，密码为本地随机 32 字符：

```text
ANXIN_RELEASE_STORE_FILE=<仓库内 .credentials/anxin-release.p12 的绝对路径（正斜杠）>
ANXIN_RELEASE_STORE_PASSWORD=<随机强密码>
ANXIN_RELEASE_KEY_ALIAS=anxin-release
ANXIN_RELEASE_KEY_PASSWORD=<同上（PKCS12 的 key 密码与 store 密码一致）>
```

回读校验（不显示密码；`-storepass:env` 从环境变量取）：

```bash
keytool -list -v -keystore .credentials/anxin-release.p12 \
  -alias anxin-release -storepass:env ANXIN_RELEASE_STORE_PASSWORD
# 期望：Alias name: anxin-release；Owner: CN=AnxinMed...；SHA256: <64 位指纹>；有效期 ~27 年
```

> **备份是硬要求**：keystore + 密码是「覆盖升级」的唯一凭证。备份到密码管理器/离线介质，至少两处；
> 不要只留这台机器。丢失后**已安装用户无法升级**，只能卸载重装（应用内数据会丢）。

## 3. 出包（prebuild 注入 → 构建 → 自动验签）

`android/` 不入 git，签名注入只在 prebuild 时生效。**换机/首次/插件变更后**：

```bash
cd app/packages/mobile
npx expo prebuild --platform android        # 会重生成 android/ 并执行 app.json 里的 plugins

# 确认插件确实注入（两条都应是 1 / 非空）：
grep -c ANXIN_RELEASE_SIGNING_V1 android/app/build.gradle
grep -n "signingConfig signingConfigs.release" android/app/build.gradle
```

> prebuild 会重建 `android/`，记得按 [README.md](./README.md)「本机工具链与构建环境」重打三个网络镜像补丁
> （阿里云 maven、腾讯 gradle 分发、SOCKS 代理）；否则 Gradle 依赖解析会失败。

前置检查（不构建，先确认地址/凭据/keystore/apksigner 就绪）：

```bash
cd app/packages/mobile
node scripts/release-apk.mjs --check
```

正式出包（在 `app/` 下）：

```bash
cd app
pnpm --filter @anxin/mobile android:release
# 等价：cd app/packages/mobile && node scripts/release-apk.mjs
```

流程与硬拦（任一步不满足都**非 0 退出、不产出可分发包**）：

1. `EXPO_PUBLIC_API_URL` 必须存在且不是模拟器/回环地址（沿用 M5-T4 两条硬拦）；
2. 签名凭据必须可加载、keystore 必须存在（`.credentials/` 缺失 → 提示先生成；绝不退回 debug 签名）；
3. `android/app/build.gradle` 必须已注入正式签名（未注入 → 提示先 prebuild，避免白跑一次 17 分钟构建）；
4. `gradlew assembleRelease`（`ANXIN_RELEASE_BUILD=1` 剔除 expo-dev 一族；凭据经
   `ORG_GRADLE_PROJECT_ANXIN_RELEASE_*` 传给 Gradle，**密码不上命令行**）；
5. 构建成功 → 自动执行 `scripts/verify-release-apk.mjs`，验签/断言不过同样非 0 退出。

Gradle 侧 fail-closed（插件注入）：直接调 `gradlew assembleRelease` 但缺凭据时，**配置期**抛

```text
缺少 release 签名凭据：ANXIN_RELEASE_STORE_FILE, ...
```

并附中文修复指引；`assembleDebug` 等不含 release 的任务不受影响（debug 仍用 `signingConfigs.debug`）。

## 4. 验签与证据

自动：`android:release` 构建成功后自动跑。手工：

```bash
cd app/packages/mobile
node scripts/verify-release-apk.mjs                 # 默认验 android/app/build/outputs/apk/release/app-release.apk
node scripts/verify-release-apk.mjs <APK>           # 位置参数直传（等同 --apk <APK>）
node scripts/verify-release-apk.mjs --apk <APK> --out-dir <目录>   # 指定归档目录（自测/复验用）
```

断言（任一失败 → 非 0，禁止分发）：

- `apksigner verify` 通过；签名方案含 v2/v3；**恰好 1 个签名者**；v1 不要求（minSdk 24）；
- 证书 DN 含 **`CN=AnxinMed`**，且**不得**出现 `Android Debug`；
- 包名 `com.anxin.mobile`；AndroidManifest 非 `application-debuggable`；
- 原生 ABI 含 **`arm64-v8a`**（真机主用 ABI，见 `plugins/with-release-hardening.js` 的双 ABI 收紧）。

通过后归档（`dist/` 已 gitignore）：

- `dist/release/anxin-medication-<versionName>-release.apk`；
- `dist/release/release-apk-info.json` —— 记录 APK 文件 SHA-256、大小、包名/版本/minSdk/targetSdk、
  ABI、`debuggable:false`、证书 DN 与证书 SHA-256、签名方案、apksigner/aapt 版本、`build.apiUrl`
  （出包时注入的后端地址；手工复验任意 APK 时可能为 null）。
  真机回归与分发记录引用这个 JSON 即可（证书指纹可公开，密码不可）。

手工旁证（可选）：

```bash
# 证书必须是 CN=AnxinMed（不是 CN=Android Debug）
$ANDROID_HOME/build-tools/36.0.0/apksigner.bat verify --print-certs <APK>
# ABI 两行都要在（注意 [A-Za-z0-9_-]，arm64-v8a 带连字符）
unzip -l <APK> | grep -oE "lib/[A-Za-z0-9_-]+/" | sort -u
```

## 5. 分发与覆盖升级

不上应用商店，内测分发（adb / 微信传文件）。**覆盖升级的前提是同一个签名证书**：

```bash
adb install -r dist/release/anxin-medication-1.0.0-release.apk
# 微信/文件管理器点 APK 安装：同样要求已装应用是同一证书，否则报 INSTALL_FAILED_UPDATE_INCOMPATIBLE
```

- 每次对外分发前把 `app.json` 的 `android.versionCode` 递增（版本号只增不减；降版安装会被系统拒绝）；
- `app.json` 的 `expo.version`（versionName）同步更新，归档文件名随 versionName 变化，便于区分；
- 同一证书签的新包可直接覆盖安装，**数据保留**；debug 签名的旧包 / 换过 keystore 的包**无法覆盖**——
  会报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，需先卸载（数据丢失）再装；
- 分发记录（渠道、日期、APK SHA-256、证书 SHA-256）抄 `dist/release/release-apk-info.json` 到任务书/验收文档。

## 6. 轮换 / 恢复

| 场景 | 做法 | 影响 |
|---|---|---|
| 只是密码丢了、keystore 还在 | 用 keytool 改 store 密码（`-storepasswd`），同步更新 `release-signing.env` 两处密码 | 无（证书不变） |
| keystore 丢失 / 泄露 | `node scripts/gen-release-keystore.mjs --force` 生成新 keystore（旧文件自动备份 `.bak-<时间戳>`），递增 versionCode 后重出包 | **新包无法覆盖旧包**：老用户必须卸载重装（数据丢失、需公告）；泄露场景应通知用户重装 |
| 换机器（仓库/`.credentials` 不在本机） | 从备份恢复 `.credentials/` 整目录（keystore + env），`release-signing.env` 里 `ANXIN_RELEASE_STORE_FILE` 若为绝对路径需按新机路径更新 | 无（证书不变） |
| 只想重建 keystore 换别名 | `--force --alias <别名>`，同步更新 env 的 `ANXIN_RELEASE_KEY_ALIAS` | 仅测试用；正式包换 key 等同轮换 |

> 轮换前先确认真的必要：换证书 = 所有用户卸载重装；不要为了「重置密码方便」轮换。

## 7. CI secret 映射（同一套 Gradle project properties）

Gradle 只认 `ORG_GRADLE_PROJECT_<name>` 环境变量；`release-apk.mjs` 的本机模式是把
`.credentials/release-signing.env` 转成这四行环境变量，CI 直接把 secret 映射成同名环境变量即可（**不落文件**）：

| CI secret（示例名） | 环境变量（release-apk.mjs / gradlew 读取） |
|---|---|
| `ANXIN_RELEASE_STORE_BASE64`（keystore 文件 base64） | 解码到临时文件后设 `ORG_GRADLE_PROJECT_ANXIN_RELEASE_STORE_FILE=<临时绝对路径>` |
| `ANXIN_RELEASE_STORE_PASSWORD` | `ORG_GRADLE_PROJECT_ANXIN_RELEASE_STORE_PASSWORD` |
| `ANXIN_RELEASE_KEY_ALIAS` | `ORG_GRADLE_PROJECT_ANXIN_RELEASE_KEY_ALIAS` |
| `ANXIN_RELEASE_KEY_PASSWORD` | `ORG_GRADLE_PROJECT_ANXIN_RELEASE_KEY_PASSWORD` |

GitHub Actions 片段（示意；四个 `ORG_GRADLE_PROJECT_*` 同时存在时 `release-apk.mjs` 走 CI 模式、不读
`.credentials/`）：

```yaml
- name: 解码 keystore（临时，job 结束即销毁）
  run: |
    echo "${{ secrets.ANXIN_RELEASE_STORE_BASE64 }}" | base64 -d > "$RUNNER_TEMP/anxin-release.p12"
    echo "ORG_GRADLE_PROJECT_ANXIN_RELEASE_STORE_FILE=$RUNNER_TEMP/anxin-release.p12" >> "$GITHUB_ENV"
    echo "ORG_GRADLE_PROJECT_ANXIN_RELEASE_STORE_PASSWORD=${{ secrets.ANXIN_RELEASE_STORE_PASSWORD }}" >> "$GITHUB_ENV"
    echo "ORG_GRADLE_PROJECT_ANXIN_RELEASE_KEY_ALIAS=${{ secrets.ANXIN_RELEASE_KEY_ALIAS }}" >> "$GITHUB_ENV"
    echo "ORG_GRADLE_PROJECT_ANXIN_RELEASE_KEY_PASSWORD=${{ secrets.ANXIN_RELEASE_KEY_PASSWORD }}" >> "$GITHUB_ENV"
- name: 出包 + 自动验签
  run: pnpm --filter @anxin/mobile android:release
  env:
    EXPO_PUBLIC_API_URL: ${{ secrets.ANXIN_PUBLIC_API_URL }}
```

CI 还需准备 JDK 17 + Android SDK（build-tools 含 apksigner/aapt）+ 仓库依赖缓存；密钥只进 CI secret，
**不要**把 `.credentials/` 拷进仓库或放进构建缓存。

## 8. 禁止提交 / 纪律

- **禁止**把 `.credentials/`（keystore、`release-signing.env`、任何密码/`.jks`/`.p12`/`.pem`）提交进 git，
  也不要贴到聊天、工单、日志、截图里；需要共享的是**证书 SHA-256 指纹**，不是密码。
- 密码只存在于：本机 `.credentials/release-signing.env`、密码管理器备份、CI secret 三处。
- 本机自检：`git status --porcelain | grep -i credentials` 应无输出（目录被忽略）；
  `git ls-files | grep -i "credentials\|\.keystore\|\.jks"` 应无输出。
- 任何构建脚本/CI 配置都不得把密码写成字面量；Gradle 侧只允许 `providers.gradleProperty(...)` 读取。
- 拿到新机器先确认 `git check-ignore` 生效，再生成/恢复凭据。

## 9. 故障排查

| 现象 | 原因 / 处理 |
|---|---|
| `[release] ✗ 没有正式签名凭据` | `.credentials/release-signing.env` 缺失：`node scripts/gen-release-keystore.mjs`；CI 检查四个 `ORG_GRADLE_PROJECT_*` |
| Gradle 报 `缺少 release 签名凭据：...` | 直接调了 `gradlew` 却未注入属性：用 `pnpm --filter @anxin/mobile android:release` 出包，或按 §7 自行设置四个环境变量 |
| `ANXIN_RELEASE_STORE_FILE 指向的 keystore 不存在` | env 里的绝对路径失效（搬家/换机）：更新路径或从备份恢复；不要改用 debug keystore |
| `[release] ✗ android/app/build.gradle 还没有注入正式签名` | 插件未生效：先 `npx expo prebuild --platform android`，再 `grep -c ANXIN_RELEASE_SIGNING_V1` 确认 |
| 验签失败 `签名证书是 debug 证书（DN 含 "Android Debug"）` | 同上报错：未 prebuild 或 prebuild 时插件未注册/被删；重跑 prebuild 并检查 `app.json` 的 plugins |
| 验签失败 `签名证书 DN 不含 CN=AnxinMed` | keystore 不是本项目正式 keystore（或 alias 不对）：核对 `.credentials/` 与 `ANXIN_RELEASE_KEY_ALIAS` |
| 验签失败 `APK 缺 arm64-v8a` | `android/gradle.properties` 的 `reactNativeArchitectures` 未含 arm64：重跑 prebuild 让 `with-release-hardening.js` 生效 |
| 装机报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | 已装包是 debug 签名或另一 keystore：卸载旧包再装（数据丢失） |
| 装机报 `INSTALL_FAILED_VERSION_DOWNGRADE` | `android.versionCode` 未递增：改 `app.json` 后重出包 |
| 不想看 `dist/` 旧产物 | `dist/` gitignored，可直接删；本次验签会重新生成 `dist/release/` |
