#!/usr/bin/env node
/**
 * M5-T3/T4 · release APK 出包（G8：正式签名 + 构建后自动验签）。
 *
 * 为什么不复用 with-lan-url.mjs（两条都不适用）：
 *  1. release 绝不能做局域网探测——把开发机 IP 烙进发布包，真机出去必然连不上；
 *     地址只认 shell 里的 EXPO_PUBLIC_API_URL 或 `.env.production.local`，两者都没有就直接失败。
 *  2. release 要剔除 expo-dev-* 一族（开发者菜单 + `exp+<slug>://` 深链）。
 *     Android 侧的 autolinking 没有 debugOnly 概念，靠 `ANXIN_RELEASE_BUILD=1`
 *     触发 `android/settings.gradle` 里的排除段——那段是 `plugins/with-release-hardening.js`
 *     在 prebuild 期注入的（android/ 不入 git，手改会被下次 prebuild 抹掉）。
 *
 * G8 正式签名（与 plugins/with-release-signing.js 约定）：
 *  · 凭据来源：`.credentials/release-signing.env`（`node scripts/gen-release-keystore.mjs` 生成，
 *    目录已 gitignore）；CI 可不出文件，直接把四个 `ORG_GRADLE_PROJECT_ANXIN_RELEASE_*` 环境变量
 *    注入进来（映射见 SIGNING.md）；
 *  · 本脚本把凭据以 `ORG_GRADLE_PROJECT_*` 传给 gradlew（Gradle 认的 project property 环境变量
 *    前缀，密码不上命令行），由注入了 `providers.gradleProperty(...)` 的 app/build.gradle 在配置期读取；
 *  · 缺凭据/keystore 不存在/原生工程未注入正式签名 → 在这里就拒绝出包（绝不静默退回 debug 签名，
 *    debug 证书打的包不可分发、无法覆盖升级）；
 *  · 构建成功后自动跑 `scripts/verify-release-apk.mjs`（CN=AnxinMed / 非 Android Debug /
 *    arm64-v8a / 包名 / 非 debuggable），验签不过同样非 0 退出，产物归档到 `dist/release/`。
 *
 * 构建走 `gradlew assembleRelease` 而不是 `expo run:android --variant release`：后者要求先有
 * 已连设备/模拟器，且会顺手 `install`；出包给真机（adb install 或微信传文件）不需要这些。
 *
 * 用法：
 *   pnpm --filter @anxin/mobile android:release              # 构建 + 验签 + 归档
 *   node scripts/release-apk.mjs --check                     # 只做前置检查（地址/凭据/keystore/工具链），不构建
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveBuildTools } from "./verify-release-apk.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = path.join(projectRoot, "android");
const hardenMarker = "ANXIN_RELEASE_BUILD";
const signingMarker = "ANXIN_RELEASE_SIGNING_V1";
const credentialsEnvFile = path.join(projectRoot, ".credentials", "release-signing.env");
const gradleProperties = {
  storeFile: "ANXIN_RELEASE_STORE_FILE",
  storePassword: "ANXIN_RELEASE_STORE_PASSWORD",
  keyAlias: "ANXIN_RELEASE_KEY_ALIAS",
  keyPassword: "ANXIN_RELEASE_KEY_PASSWORD",
};
const requiredCredentialKeys = Object.values(gradleProperties);

function rel(file) {
  const relative = path.relative(projectRoot, file);
  return (relative.startsWith("..") ? file : relative).split(path.sep).join("/");
}

function usage() {
  console.log(
    [
      "release APK 出包（正式签名 + 构建后验签 + 归档 dist/release/）。",
      "",
      "用法：node scripts/release-apk.mjs [--check]",
      "",
      "  --check, --dry-run  只做前置检查（服务器地址 / 凭据 / keystore / 验签工具链），不跑 gradle",
      "  -h, --help          打印本帮助",
      "",
      "通常经 pnpm --filter @anxin/mobile android:release 调用。凭据与签名说明见 SIGNING.md。",
    ].join("\n"),
  );
}

function die(message) {
  console.error(`\n[release] ✗ ${message}`);
  process.exit(1);
}

// ── 参数 ────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  usage();
  process.exit(0);
}
const checkOnly = argv.includes("--check") || argv.includes("--dry-run");
const unknownArgs = argv.filter((arg) => !["--check", "--dry-run"].includes(arg));
if (unknownArgs.length > 0) die(`未知参数：${unknownArgs.join(" ")}（--help 看用法）`);

// ── 服务器地址（沿用 M5-T4 的两条硬拦）──────────────────────────────────────────
function readApiUrl(file) {
  if (!fs.existsSync(file)) return undefined;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (key.trim() !== "EXPO_PUBLIC_API_URL") continue;
    const value = rest.join("=").trim().replace(/^["']|["']$/g, "");
    if (/^https?:\/\//i.test(value)) return value;
  }
  return undefined;
}

const fromShell = !!process.env.EXPO_PUBLIC_API_URL;
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? readApiUrl(path.join(projectRoot, ".env.production.local"));

if (!apiUrl) {
  die(
    "没有服务器地址，拒绝出包（禁静默打出连不上后端的 APK）。\n" +
      "  · 新建 .env.production.local 写一行：EXPO_PUBLIC_API_URL=http://<公网IP或域名>:8787\n" +
      "  · 或临时指定：EXPO_PUBLIC_API_URL=http://<地址>:8787 pnpm --filter @anxin/mobile android:release\n" +
      "  抄 .env.example 末尾那段即可。",
  );
}

// 模拟器/回环地址出到发布包里等于「装上去就打不开」，且报错发生在用户手机上——在这里拦住。
if (/^https?:\/\/(10\.0\.2\.2|localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/)/i.test(apiUrl)) {
  die(
    `地址 ${apiUrl} 是模拟器/回环专用地址，真机访问不到，拒绝出包。\n` +
      "  · dev 联调请走 pnpm --filter @anxin/mobile android:dev（自动探测局域网 IP）\n" +
      "  · 发布包应指向公网地址（M5-T1 火山）",
  );
}

// ── G8 签名凭据（fail-closed）──────────────────────────────────────────────────
function readEnvFile(file) {
  if (!fs.existsSync(file)) return undefined;
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    values[key] = value;
  }
  return values;
}

function loadSigningCredentials() {
  // CI / 手工出包：四个 ORG_GRADLE_PROJECT_* 已在环境里 → 直接用，不落盘。
  const fromEnvironment = Object.fromEntries(
    requiredCredentialKeys.map((key) => [key, process.env[`ORG_GRADLE_PROJECT_${key}`]]),
  );
  if (requiredCredentialKeys.every((key) => fromEnvironment[key])) {
    return { source: "shell 环境变量 ORG_GRADLE_PROJECT_*（CI 模式）", values: fromEnvironment };
  }

  const fromFile = readEnvFile(credentialsEnvFile);
  if (!fromFile) {
    die(
      "没有正式签名凭据，拒绝出包（禁止打出 debug 证书签名的 APK）。\n" +
        "  · 本机首次生成：cd app/packages/mobile && node scripts/gen-release-keystore.mjs\n" +
        "  · CI 模式：注入四个 ORG_GRADLE_PROJECT_ANXIN_RELEASE_* 环境变量（映射见 app/packages/mobile/SIGNING.md）\n" +
        "  · 生成的 .credentials/ 已被 .gitignore 忽略，keystore 与密码绝不入库。",
    );
  }
  const missing = requiredCredentialKeys.filter((key) => !fromFile[key]);
  if (missing.length > 0) {
    die(
      `签名凭据不完整（${rel(credentialsEnvFile)} 缺少：${missing.join(", ")}），拒绝出包。\n` +
        "  · 重新生成：node scripts/gen-release-keystore.mjs --force（旧文件会先备份）\n" +
        "  · 或从备份恢复 .credentials/，切勿手工拼密码硬编进构建脚本。",
    );
  }
  return { source: `${rel(credentialsEnvFile)}`, values: fromFile };
}

const credentials = loadSigningCredentials();
const storeFile = credentials.values[gradleProperties.storeFile];
if (!fs.existsSync(storeFile)) {
  die(
    `ANXIN_RELEASE_STORE_FILE 指向的 keystore 不存在：${storeFile}\n` +
      "  · 检查 .credentials/release-signing.env 的 ANXIN_RELEASE_STORE_FILE（须为绝对路径，目录随仓库移动后需更新）\n" +
      "  · 或重新生成：node scripts/gen-release-keystore.mjs --force\n" +
      "  · 切勿改用 debug keystore 出包。",
  );
}

const signingEnvironment = Object.fromEntries(
  requiredCredentialKeys.map((key) => [`ORG_GRADLE_PROJECT_${key}`, credentials.values[key]]),
);

// ── 验签工具链（apksigner/aapt）：构建前先确认，免得白跑一次 17 分钟构建 ─────────
let toolchain;
try {
  toolchain = resolveBuildTools();
} catch (error) {
  die(`验签工具链不可用，拒绝出包：${error instanceof Error ? error.message : String(error)}`);
}

// ── 原生工程状态：正式签名必须由 prebuild 插件注入（android/ 不入 git）──────────
const gradlew = path.join(androidRoot, process.platform === "win32" ? "gradlew.bat" : "gradlew");
const appBuildGradle = path.join(androidRoot, "app", "build.gradle");
const settingsGradle = path.join(androidRoot, "settings.gradle");
const hasNativeProject = fs.existsSync(gradlew) && fs.existsSync(appBuildGradle);
const buildGradleContents = hasNativeProject ? fs.readFileSync(appBuildGradle, "utf8") : "";
const hasSigningInjection = buildGradleContents.includes(signingMarker);
const hasHardenInjection =
  fs.existsSync(settingsGradle) && fs.readFileSync(settingsGradle, "utf8").includes(hardenMarker);

if (!checkOnly && !hasNativeProject) {
  die(
    "android/ 原生工程不存在或不完整（找不到 gradlew / app/build.gradle），拒绝出包。\n" +
      "  · 先生成：cd app/packages/mobile && npx expo prebuild --platform android\n" +
      "    （android/ 不入 git；prebuild 后按 README「本机工具链」节补三个网络镜像补丁）",
  );
}
if (!checkOnly && !hasSigningInjection) {
  die(
    "android/app/build.gradle 还没有注入正式签名（缺少 ANXIN_RELEASE_SIGNING_V1）。\n" +
      "  直接构建会打出 debug 证书签名的 APK（不可分发、无法覆盖升级），故拒绝出包。\n" +
      "  · 先让插件生效：cd app/packages/mobile && npx expo prebuild --platform android\n" +
      "  · 自验注入结果：grep -c ANXIN_RELEASE_SIGNING_V1 android/app/build.gradle（应为 1）\n" +
      "  · 插件源码：plugins/with-release-signing.js（已在 app.json 注册）",
  );
}
if (hasNativeProject && !hasHardenInjection) {
  console.warn(
    "[release] ⚠ android/settings.gradle 缺 ANXIN_RELEASE_BUILD 收紧段（expo-dev-* 剔除不生效）。\n" +
      "  建议先 npx expo prebuild --platform android（plugins/with-release-hardening.js 会自动注入）。",
  );
}

console.log(`[release] EXPO_PUBLIC_API_URL = ${apiUrl}  （来源：${fromShell ? "shell 环境变量" : ".env.production.local"}）`);
console.log(
  `[release] 签名凭据来源：${credentials.source}；keystore=${rel(storeFile)}；alias=${credentials.values[gradleProperties.keyAlias]}`,
);
console.log(`[release] 验签工具链：build-tools ${toolchain.buildToolsVersion}（${toolchain.buildToolsDir}）`);
console.log("[release] ANXIN_RELEASE_BUILD=1 —— autolinking 排除 expo-dev-* 一族");

if (checkOnly) {
  console.log(
    [
      "",
      "[check] ✓ 服务器地址合法（非模拟器/回环地址）",
      "[check] ✓ 签名凭据已加载，keystore 存在",
      "[check] ✓ apksigner / aapt 可用（构建后可自动验签）",
      hasSigningInjection
        ? "[check] ✓ android/app/build.gradle 已注入正式签名（ANXIN_RELEASE_SIGNING_V1）"
        : "[check] ⚠ android/app/build.gradle 尚未注入正式签名 —— 出包前必须先 npx expo prebuild --platform android（--check 不代替该步）",
      hasHardenInjection
        ? "[check] ✓ android/settings.gradle 含 ANXIN_RELEASE_BUILD 收紧段"
        : "[check] ⚠ android/settings.gradle 缺 ANXIN_RELEASE_BUILD 收紧段 —— 同样需要先 prebuild",
      "",
      "[check] 前置检查完成：本次未构建、未签名（加 --check 不会调用 gradlew）。",
    ].join("\n"),
  );
  process.exit(0);
}

// ── 构建 ────────────────────────────────────────────────────────────────────────
// Windows 上 Node 禁止无 shell 地 spawn .bat（EINVAL），故显式走 cmd /c。
const [command, args] =
  process.platform === "win32" ? ["cmd.exe", ["/c", gradlew, "assembleRelease"]] : [gradlew, ["assembleRelease"]];
const child = spawn(command, args, {
  stdio: "inherit",
  cwd: androidRoot,
  env: {
    ...process.env,
    EXPO_PUBLIC_API_URL: apiUrl,
    ANXIN_RELEASE_BUILD: "1",
    // 密码/路径只走环境变量传给 Gradle（providers.gradleProperty 读取），不出现在命令行。
    ...signingEnvironment,
  },
});

child.on("error", (error) => {
  console.error(`[release] ✗ 无法启动 gradlew：${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  if (code !== 0) {
    console.error(`[release] ✗ gradle assembleRelease 失败（exit=${code}），未产出可分发 APK。`);
    process.exit(code ?? 1);
  }

  console.log("\n[release] 构建完成 → 自动验签并归档（scripts/verify-release-apk.mjs）");
  const verify = spawnSync(process.execPath, [path.join(projectRoot, "scripts", "verify-release-apk.mjs")], {
    stdio: "inherit",
    cwd: projectRoot,
    env: { ...process.env, EXPO_PUBLIC_API_URL: apiUrl },
  });
  if (verify.error) {
    console.error(`[release] ✗ 无法启动验签脚本：${verify.error.message}`);
    process.exit(1);
  }
  if (verify.status !== 0) {
    console.error(
      "\n[release] ✗ 验签失败：产物未归档、禁止分发（原因见上）。\n" +
        "  · 检查 gradle 是否真的用了正式签名：grep -c ANXIN_RELEASE_SIGNING_V1 android/app/build.gradle\n" +
        "  · 手工复验：node scripts/verify-release-apk.mjs",
    );
    process.exit(verify.status ?? 1);
  }
  console.log(
    "\n[release] ✓ 出包 + 验签 + 归档完成\n" +
      "  · 归档目录：dist/release/（APK + release-apk-info.json，含 APK/证书 SHA-256）\n" +
      "  · 分发装机：见 dist/release/release-apk-info.json 与 SIGNING.md「分发与覆盖升级」",
  );
  process.exit(0);
});
