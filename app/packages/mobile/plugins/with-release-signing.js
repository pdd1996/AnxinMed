/**
 * G8 · release APK 正式签名（expo config plugin）
 *
 * 背景：`android/` 整目录被 .gitignore 忽略、由 `expo prebuild` 生成。Expo 模板的
 * `android/app/build.gradle` 里 release 变体默认 `signingConfig signingConfigs.debug`，
 * 于是打出来的 APK 是 debug 证书（CN=Android Debug）签名——不可分发，装了旧包的机器也无法
 * 覆盖升级。手改 android/ 既进不了版本库，也会在下次 prebuild 时被抹掉，所以这条必须住在插件里。
 *
 * 本插件在 prebuild 期往 `android/app/build.gradle` 注入两块内容（都带 MARKER 注释）：
 *  1. `signingConfigs { release { ... } }`：四个凭据全部从 Gradle project properties 读；
 *  2. `buildTypes { release { signingConfig signingConfigs.release } }`：release 不再用 debug 签名。
 *
 * 凭据通道（本机与 CI 同一套）：
 *  · `scripts/release-apk.mjs` 读 `.credentials/release-signing.env`，以
 *    `ORG_GRADLE_PROJECT_ANXIN_RELEASE_*` 环境变量传给 gradlew——这是 Gradle 认的
 *    project property 环境变量前缀，密码不落命令行、不进仓库；CI 把 secret 映射成同名环境变量即可；
 *  · 这里用 `providers.gradleProperty(...)` 读取（不用 System.getenv：复用的 Gradle daemon
 *    里 getenv 可能是 daemon 启动时的旧环境，读不到本次构建传入的值）。
 *
 * 失败可见（fail-closed）：
 *  · 只有 **release 类任务**（assembleRelease / bundleRelease / build / assemble 等）在缺凭据时
 *    于配置期抛 GradleException（中文指引），绝不静默回退 debug 签名；
 *  · `assembleDebug` 等不含 release 的任务不受影响：release signingConfig 用占位值满足 AGP 的
 *    配置期解析要求，debug 构建仍只用 `signingConfigs.debug`，行为与改动前完全一致；
 *  · 凭据齐全但 keystore 文件不存在时同样在配置期报错（中文，指向路径与修复办法）。
 *
 * 幂等：`applyAppBuildGradle` 见到 MARKER 直接返回原文，重复 prebuild / 重复 apply 不会重复注入。
 * 自验：`node scripts/verify-release-signing-plugin.mjs`（对样例 build.gradle 直接断言注入形状、
 * 幂等、debug 不变；不需要 prebuild、不需要真机）。
 */
const { withAppBuildGradle } = require("@expo/config-plugins");

const MARKER = "// ── ANXIN_RELEASE_SIGNING_V1 ──";

const SIGNING_BLOCK = `        ${MARKER}
        // G8 正式签名：四个凭据只从 Gradle project properties 读取（release-apk.mjs 以
        // ORG_GRADLE_PROJECT_ANXIN_RELEASE_* 环境变量传入，CI 同一套映射）。仓库里不落任何密码。
        release {
            // 只拦 release 类任务；assembleDebug 等任务不触发，debug 签名路径完全不变。
            def anXinRequestedTasks = gradle.startParameter.taskNames
            def anXinReleaseRequested = anXinRequestedTasks.any { anXinTask ->
                def anXinName = (anXinTask ?: '').toLowerCase()
                anXinName.contains('release') ||
                    anXinName == 'build' || anXinName.endsWith(':build') ||
                    anXinName == 'assemble' || anXinName.endsWith(':assemble')
            }
            def anXinStoreFile = providers.gradleProperty('ANXIN_RELEASE_STORE_FILE')
            def anXinStorePassword = providers.gradleProperty('ANXIN_RELEASE_STORE_PASSWORD')
            def anXinKeyAlias = providers.gradleProperty('ANXIN_RELEASE_KEY_ALIAS')
            def anXinKeyPassword = providers.gradleProperty('ANXIN_RELEASE_KEY_PASSWORD')
            def anXinMissing = []
            if (!anXinStoreFile.isPresent()) anXinMissing << 'ANXIN_RELEASE_STORE_FILE'
            if (!anXinStorePassword.isPresent()) anXinMissing << 'ANXIN_RELEASE_STORE_PASSWORD'
            if (!anXinKeyAlias.isPresent()) anXinMissing << 'ANXIN_RELEASE_KEY_ALIAS'
            if (!anXinKeyPassword.isPresent()) anXinMissing << 'ANXIN_RELEASE_KEY_PASSWORD'
            if (anXinReleaseRequested && !anXinMissing.isEmpty()) {
                throw new GradleException('缺少 release 签名凭据：' + anXinMissing.join(', ') + '\\n' +
                    '  正式 APK 必须用 .credentials/ 下的 keystore 签名，禁止回退 debug 签名（CN=Android Debug 不可分发）。' + '\\n' +
                    '  1) 本机首次：cd app/packages/mobile && node scripts/gen-release-keystore.mjs' + '\\n' +
                    '  2) 正常出包：cd app && pnpm --filter @anxin/mobile android:release（自动读凭据并注入 ORG_GRADLE_PROJECT_*）' + '\\n' +
                    '  3) 直接调 gradlew 时需自行设置四个 ORG_GRADLE_PROJECT_ANXIN_RELEASE_* 环境变量（映射见 app/packages/mobile/SIGNING.md）')
            }
            if (!anXinMissing.isEmpty()) {
                // 非 release 任务（如 assembleDebug）：AGP 配置期要求 signingConfig 可解析，这里用占位值。
                // release 任务已在上面 fail-closed，绝不会用占位值签名（debug.keystore 只属 debug 变体）。
                storeFile file('debug.keystore')
                storePassword 'unused'
                keyAlias 'unused'
                keyPassword 'unused'
            } else {
                def anXinStore = file(anXinStoreFile.get())
                if (anXinReleaseRequested && !anXinStore.exists()) {
                    throw new GradleException('ANXIN_RELEASE_STORE_FILE 指向的 keystore 不存在：' + anXinStore + '\\n' +
                        '  检查 .credentials/release-signing.env 的 ANXIN_RELEASE_STORE_FILE（须为绝对路径），或重新生成：' + '\\n' +
                        '  cd app/packages/mobile && node scripts/gen-release-keystore.mjs')
                }
                storeFile anXinStore
                storePassword anXinStorePassword.get()
                keyAlias anXinKeyAlias.get()
                keyPassword anXinKeyPassword.get()
            }
        }`;

/**
 * 找到 `openIndex` 处 `{` 对应的 `}`（跳过的行注释、块注释与单/双引号字符串不参与计数）。
 * 样例/模板 build.gradle 足够简单，这里只需要一个不误判字符串与注释的括号匹配。
 */
function findMatchingBrace(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "/" && next === "/") {
      const lineEnd = text.indexOf("\n", i);
      i = lineEnd === -1 ? text.length : lineEnd;
      continue;
    }
    if (ch === "/" && next === "*") {
      const blockEnd = text.indexOf("*/", i + 2);
      i = blockEnd === -1 ? text.length : blockEnd + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      for (i += 1; i < text.length; i += 1) {
        if (text[i] === "\\") i += 1;
        else if (text[i] === quote) break;
      }
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 幂等地把正式签名注入 `android/app/build.gradle` 文本。
 * 纯字符串变换，不依赖 Gradle/Expo 运行期，便于 scripts/verify-release-signing-plugin.mjs 直接断言。
 */
function applyAppBuildGradle(contents) {
  const text = contents ?? "";
  if (!text.trim()) return text;
  // 幂等：第二次 apply 直接返回原文（prebuild 反复跑、或插件被链两次都不会重复注入）。
  if (text.includes(MARKER)) return text;

  const signingConfigsMatch = /\bsigningConfigs\s*\{/.exec(text);
  if (!signingConfigsMatch) {
    throw new Error(
      "with-release-signing：android/app/build.gradle 里找不到 signingConfigs 块，无法注入正式签名（Expo 模板形状变了？）",
    );
  }
  const signingConfigsOpen = text.indexOf("{", signingConfigsMatch.index);
  if (findMatchingBrace(text, signingConfigsOpen) < 0) {
    throw new Error("with-release-signing：signingConfigs 块的花括号不配对，无法安全注入");
  }

  // 1) 在 signingConfigs 开头插入 release signingConfig
  let next = `${text.slice(0, signingConfigsOpen + 1)}\n${SIGNING_BLOCK}${text.slice(signingConfigsOpen + 1)}`;

  // 2) 把 buildTypes.release 的 signingConfig 从 debug 换成 release（只动 release 块，debug 不碰）
  const buildTypesMatch = /\bbuildTypes\s*\{/.exec(next);
  if (!buildTypesMatch) {
    throw new Error("with-release-signing：android/app/build.gradle 里找不到 buildTypes 块，无法切换 release 签名");
  }
  const buildTypesOpen = next.indexOf("{", buildTypesMatch.index);
  const buildTypesClose = findMatchingBrace(next, buildTypesOpen);
  if (buildTypesClose < 0) {
    throw new Error("with-release-signing：buildTypes 块的花括号不配对，无法安全注入");
  }
  const releaseMatch = /\brelease\s*\{/.exec(next.slice(buildTypesOpen, buildTypesClose));
  if (!releaseMatch) {
    throw new Error("with-release-signing：buildTypes 里找不到 release 块，无法切换 release 签名");
  }
  const releaseOpen = next.indexOf("{", buildTypesOpen + releaseMatch.index);
  if (releaseOpen < 0 || releaseOpen > buildTypesClose) {
    throw new Error("with-release-signing：buildTypes.release 块形状异常，无法安全注入");
  }
  const releaseClose = findMatchingBrace(next, releaseOpen);
  if (releaseClose < 0) {
    throw new Error("with-release-signing：buildTypes.release 块的花括号不配对，无法安全注入");
  }

  const releaseBody = next.slice(releaseOpen + 1, releaseClose);
  const debugSigning = /signingConfig\s+signingConfigs\.debug\b/;
  const releaseSigning = /signingConfig\s+signingConfigs\.release\b/;
  let nextReleaseBody;
  if (debugSigning.test(releaseBody)) {
    nextReleaseBody = releaseBody.replace(debugSigning, "signingConfig signingConfigs.release");
  } else if (releaseSigning.test(releaseBody)) {
    nextReleaseBody = releaseBody;
  } else {
    // 模板没写 signingConfig 行时的兜底：显式补一行（仍只作用于 release 变体）
    nextReleaseBody = `\n            signingConfig signingConfigs.release${releaseBody}`;
  }
  next = `${next.slice(0, releaseOpen + 1)}${nextReleaseBody}${next.slice(releaseClose)}`;
  return next;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults = { ...cfg.modResults, contents: applyAppBuildGradle(cfg.modResults?.contents) };
    return cfg;
  });
};

module.exports.transforms = { applyAppBuildGradle, findMatchingBrace, MARKER };
