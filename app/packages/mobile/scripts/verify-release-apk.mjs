#!/usr/bin/env node
/**
 * G8 · release APK 验签与产物归档（签名是否真的是正式证书，禁止 debug 证书/多签名）。
 *
 * `scripts/release-apk.mjs` 构建成功后会自动调用本脚本；也可以手工对已有 APK 复验。
 *
 * 断言（任一失败 → 非 0 退出，禁止分发）：
 *   · `apksigner verify --print-certs --verbose` 通过（至少 v2/v3 签名方案之一，恰好 1 个签名者）；
 *   · 签名证书 DN 含 `CN=AnxinMed`，且不出现 `Android Debug`（Expo prebuild 默认的 debug 证书）；
 *   · 包名 = `com.anxin.mobile`，`application-debuggable` 不存在（非 debuggable）；
 *   · 原生 ABI 含 `arm64-v8a`（真机主用 ABI；见 plugins/with-release-hardening.js 的双 ABI 收紧）。
 *
 * 通过后：
 *   · 复制 APK 到 `dist/release/anxin-medication-<versionName>-release.apk`（dist/ 已 gitignore）；
 *   · 写 `dist/release/release-apk-info.json`（APK SHA-256、证书 DN/指纹、ABI、版本、工具链），
 *     供真机回归/分发包与 G8 证据链引用。
 *
 * 用法（在 app/packages/mobile 下）：
 *   node scripts/verify-release-apk.mjs
 *   node scripts/verify-release-apk.mjs --apk <路径> --out-dir <归档目录>
 *
 * 工具链：ANDROID_HOME / ANDROID_SDK_ROOT 指向 Android SDK，取 build-tools 里**最高版本**的
 * apksigner/aapt（也可用 ANXIN_BUILD_TOOLS_VERSION=<版本> 固定）。Windows 下 .bat 经 cmd.exe /c 调起
 * （Node 不能无 shell spawn .bat）。
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultApkPath = path.join(projectRoot, "android", "app", "build", "outputs", "apk", "release", "app-release.apk");
const defaultOutDir = path.join(projectRoot, "dist", "release");

const EXPECTED_PACKAGE = "com.anxin.mobile";
const EXPECTED_CERT_CN = "CN=AnxinMed";
const FORBIDDEN_CERT_SUBSTRINGS = ["Android Debug"];
const REQUIRED_ABI = "arm64-v8a";

function rel(file) {
  const relative = path.relative(projectRoot, file);
  return (relative.startsWith("..") ? file : relative).split(path.sep).join("/");
}

function usage() {
  console.log(
    [
      "校验 release APK 是否用正式 keystore 签名，并归档到 dist/release/。",
      "",
      "用法：node scripts/verify-release-apk.mjs [<APK 路径>] [--apk <apk 路径>] [--out-dir <归档目录>]",
      "",
      `  <APK 路径> / --apk  默认 ${rel(defaultApkPath)}（位置参数与 --apk 等价）`,
      `  --out-dir          默认 ${rel(defaultOutDir)}`,
      "  -h, --help         打印本帮助",
    ].join("\n"),
  );
}

function failFast(message) {
  console.error(`\n[verify] ✗ ${message}\n`);
  process.exit(1);
}

function runTool(command, args) {
  // Windows 上 Node 不能无 shell spawn .bat/.cmd（EINVAL），显式走 cmd.exe /c。
  const [actualCommand, actualArgs] =
    process.platform === "win32" && /\.(bat|cmd)$/i.test(command)
      ? ["cmd.exe", ["/c", command, ...args]]
      : [command, args];
  const result = spawnSync(actualCommand, actualArgs, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new Error(`调用失败：${command}（${result.error.message}）`);
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

function compareVersionLabel(a, b) {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10));
  const pb = b.split(".").map((part) => Number.parseInt(part, 10));
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 解析 Android SDK 的 build-tools（apksigner + aapt）；供 release-apk.mjs 做构建前置检查。 */
export function resolveBuildTools() {
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!androidHome) {
    throw new Error("没有 ANDROID_HOME / ANDROID_SDK_ROOT，找不到 Android SDK（验签需要 build-tools 里的 apksigner/aapt）。");
  }
  const buildToolsRoot = path.join(androidHome, "build-tools");
  if (!fs.existsSync(buildToolsRoot)) {
    throw new Error(`Android SDK 下没有 build-tools 目录：${buildToolsRoot}`);
  }
  const apksignerName = process.platform === "win32" ? "apksigner.bat" : "apksigner";
  const aaptName = process.platform === "win32" ? "aapt.exe" : "aapt";
  const pinned = process.env.ANXIN_BUILD_TOOLS_VERSION;
  const versions = fs
    .readdirSync(buildToolsRoot)
    .filter((version) => /^\d+(\.\d+)+$/.test(version))
    .filter((version) => !pinned || version === pinned)
    .filter((version) => fs.existsSync(path.join(buildToolsRoot, version, apksignerName)))
    .sort((a, b) => compareVersionLabel(b, a));
  if (versions.length === 0) {
    throw new Error(
      `build-tools 下找不到 ${apksignerName}（${buildToolsRoot}）` +
        (pinned ? `；ANXIN_BUILD_TOOLS_VERSION=${pinned} 不是已安装版本` : "") +
        "。装好 build-tools 或检查 ANDROID_HOME。",
    );
  }
  const buildToolsVersion = versions[0];
  const buildToolsDir = path.join(buildToolsRoot, buildToolsVersion);
  const aapt = path.join(buildToolsDir, aaptName);
  if (!fs.existsSync(aapt)) {
    throw new Error(`build-tools ${buildToolsVersion} 下找不到 ${aaptName}（验包名/ABI/debuggable 需要）。`);
  }
  return {
    androidHome,
    buildToolsVersion,
    buildToolsDir,
    apksigner: path.join(buildToolsDir, apksignerName),
    aapt,
  };
}

function formatFingerprint(hex) {
  return hex
    .toUpperCase()
    .match(/.{2}/g)
    .join(":");
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function main() {
  const argv = process.argv.slice(2);
  let apkPath = defaultApkPath;
  let outDir = defaultOutDir;
  let apkProvided = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      return;
    }
    if (arg === "--apk" || arg === "--out-dir") {
      const value = argv[i + 1];
      if (!value) failFast(`${arg} 缺少参数值`);
      if (arg === "--apk") {
        if (apkProvided) failFast("APK 路径重复指定（位置参数与 --apk 二选一）");
        apkPath = path.resolve(value);
        apkProvided = true;
      } else {
        outDir = path.resolve(value);
      }
      i += 1;
    } else if (!arg.startsWith("-")) {
      // 兼容 `node scripts/verify-release-apk.mjs <APK 路径>` 的直传写法（文档示例用这个）。
      if (apkProvided) failFast(`多余的参数：${arg}（只接受一个 APK 路径）`);
      apkPath = path.resolve(arg);
      apkProvided = true;
    } else {
      failFast(`未知参数：${arg}（--help 看用法）`);
    }
  }

  if (!fs.existsSync(apkPath)) {
    failFast(
      `APK 不存在：${apkPath}\n` +
        "  · 先在 app/ 下出包：pnpm --filter @anxin/mobile android:release\n" +
        "  · 或显式指定：node scripts/verify-release-apk.mjs --apk <apk 路径>",
    );
  }

  let toolchain;
  try {
    toolchain = resolveBuildTools();
  } catch (error) {
    failFast(error instanceof Error ? error.message : String(error));
  }

  const failures = [];
  const assert = (condition, message) => {
    if (!condition) failures.push(message);
  };
  const print = (line) => console.log(`  ${line}`);

  console.log(`[verify] APK: ${apkPath}`);
  console.log(`[verify] 工具链: build-tools ${toolchain.buildToolsVersion}（${toolchain.buildToolsDir}）`);

  // ── 1. apksigner verify --print-certs ────────────────────────────────────────
  const signature = { verified: false, schemes: [], signerCount: 0 };
  const verifyResult = runTool(toolchain.apksigner, ["verify", "--print-certs", "--verbose", apkPath]);
  const verifyOutput = verifyResult.output;
  if (verifyResult.status !== 0) {
    failures.push(`apksigner verify 未通过（exit=${verifyResult.status}）:\n${verifyOutput.split("\n").slice(0, 20).join("\n")}`);
  } else {
    signature.verified = /(^|\n)Verifies(\r?\n|$)/.test(verifyOutput);
    assert(signature.verified, "apksigner 没有给出 Verifies 结论");
    const schemes = [];
    const schemePatterns = {
      v1: /Verified using v1 scheme \(JAR signing\):\s*true/,
      v2: /Verified using v2 scheme \(APK Signature Scheme v2\):\s*true/,
      v3: /Verified using v3 scheme \(APK Signature Scheme v3\):\s*true/,
    };
    for (const [scheme, pattern] of Object.entries(schemePatterns)) {
      if (pattern.test(verifyOutput)) schemes.push(scheme);
    }
    signature.schemes = schemes;
    assert(schemes.length > 0, "没有 v1/v2/v3 任一签名方案验证通过");

    const signerMatch = /Number of signers:\s*(\d+)/.exec(verifyOutput);
    signature.signerCount = signerMatch ? Number.parseInt(signerMatch[1], 10) : 0;
    assert(signature.signerCount === 1, `签名者数量不是 1（实际：${signerMatch?.[1] ?? "解析不到"}）`);

    const dnMatch = /Signer #1 certificate DN:\s*(.+)/.exec(verifyOutput);
    signature.certificateDn = dnMatch ? dnMatch[1].trim() : undefined;
    assert(signature.certificateDn, "解析不到签名证书 DN");
    if (signature.certificateDn) {
      assert(signature.certificateDn.includes(EXPECTED_CERT_CN), `签名证书 DN 不含 ${EXPECTED_CERT_CN}（实际：${signature.certificateDn}）`);
      for (const forbidden of FORBIDDEN_CERT_SUBSTRINGS) {
        assert(!signature.certificateDn.includes(forbidden), `签名证书是 debug 证书（DN 含 "${forbidden}"）：${signature.certificateDn}`);
      }
    }
    const digestMatch = /Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]+)/.exec(verifyOutput);
    signature.certificateSha256 = digestMatch ? formatFingerprint(digestMatch[1]) : undefined;
    assert(signature.certificateSha256, "解析不到签名证书 SHA-256 指纹");

    const keyAlgorithmMatch = /Signer #1 key algorithm:\s*(\S+)/.exec(verifyOutput);
    signature.keyAlgorithm = keyAlgorithmMatch?.[1];
    signature.keySizeBits = Number.parseInt(/Signer #1 key size \(bits\):\s*(\d+)/.exec(verifyOutput)?.[1] ?? "", 10) || undefined;
  }

  // ── 2. aapt dump badging：包名 / debuggable / ABI / 版本 ─────────────────────
  const application = { debuggable: undefined };
  const badgingResult = runTool(toolchain.aapt, ["dump", "badging", apkPath]);
  if (badgingResult.status !== 0) {
    failures.push(`aapt dump badging 失败（exit=${badgingResult.status}）:\n${badgingResult.output.split("\n").slice(0, 10).join("\n")}`);
  } else {
    const badging = badgingResult.output;
    application.packageName = /^package: name='([^']+)'/m.exec(badging)?.[1];
    assert(application.packageName, "解析不到 APK 包名");
    if (application.packageName) {
      assert(
        application.packageName === EXPECTED_PACKAGE,
        `包名不是 ${EXPECTED_PACKAGE}（实际：${application.packageName}）`,
      );
    }
    application.versionName = /versionName='([^']*)'/.exec(badging)?.[1];
    const versionCode = /versionCode='(\d+)'/.exec(badging)?.[1];
    application.versionCode = versionCode ? Number.parseInt(versionCode, 10) : undefined;
    const minSdk = /sdkVersion:'(\d+)'/.exec(badging)?.[1];
    application.minSdkVersion = minSdk ? Number.parseInt(minSdk, 10) : undefined;
    const targetSdk = /targetSdkVersion:'(\d+)'/.exec(badging)?.[1];
    application.targetSdkVersion = targetSdk ? Number.parseInt(targetSdk, 10) : undefined;

    application.debuggable = /(^|\n)application-debuggable(\r?\n|$)/.test(badging);
    assert(!application.debuggable, "APK 是 debuggable 的（AndroidManifest 含 application-debuggable），禁止分发");

    const nativeCodeLine = /(^|\n)native-code:([^\n]*)/.exec(badging)?.[2] ?? "";
    application.abis = [...nativeCodeLine.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    assert(application.abis.length > 0, "APK 里没有原生 ABI（native-code 为空）");
    assert(
      application.abis.includes(REQUIRED_ABI),
      `APK 缺 ${REQUIRED_ABI}（实际 ABI：${application.abis.join(", ") || "无"}）—— 见 plugins/with-release-hardening.js 的双 ABI 收紧`,
    );
  }

  // ── 3. APK 文件摘要 ─────────────────────────────────────────────────────────
  const apkSha256 = sha256File(apkPath);
  const sizeBytes = fs.statSync(apkPath).size;

  // ── 4. 汇总 ─────────────────────────────────────────────────────────────────
  console.log("\n[verify] 断言结果：");
  print(`包名:        ${application.packageName ?? "解析失败"}${application.packageName === EXPECTED_PACKAGE ? "  ✓" : "  ✗"}`);
  print(`版本:        ${application.versionName ?? "?"}（versionCode ${application.versionCode ?? "?"} / minSdk ${application.minSdkVersion ?? "?"} / targetSdk ${application.targetSdkVersion ?? "?"}）`);
  print(`ABI:         ${application.abis?.join(", ") || "解析失败"}${application.abis?.includes(REQUIRED_ABI) ? "  ✓" : "  ✗"}`);
  print(`debuggable:  ${application.debuggable === false ? "false  ✓" : "true/未知  ✗"}`);
  print(`签名者:      ${signature.signerCount || "解析失败"} 个${signature.signerCount === 1 ? "  ✓" : "  ✗"}`);
  print(`签名方案:    ${signature.schemes.join(", ") || "无  ✗"}`);
    print(`证书 DN:     ${signature.certificateDn ?? "解析失败"}${signature.certificateDn?.includes(EXPECTED_CERT_CN) && !signature.certificateDn?.includes("Android Debug") ? "  ✓" : ""}`);
  print(`证书 SHA-256: ${signature.certificateSha256 ?? "解析失败"}`);
  if (signature.keyAlgorithm) print(`密钥:        ${signature.keyAlgorithm} ${signature.keySizeBits ?? "?"} bit`);
  print(`APK SHA-256: ${apkSha256}`);
  print(`大小:        ${sizeBytes} B`);

  if (failures.length > 0) {
    console.error(`\n[verify] ✗ FAIL  ${failures.length} 项断言未通过，禁止分发：`);
    failures.forEach((message, index) => console.error(`  ${index + 1}. ${message}`));
    console.error(
      "\n  修复方向：\n" +
        "  · debug 证书 → 确认 expo prebuild 后 android/app/build.gradle 已注入正式签名：\n" +
        "      grep -c ANXIN_RELEASE_SIGNING_V1 android/app/build.gradle   # 应为 1\n" +
        "  · 用官方入口出包：cd app && pnpm --filter @anxin/mobile android:release（凭据见 SIGNING.md）\n",
    );
    process.exit(1);
  }

  // ── 5. 归档（只在全部断言通过后执行）────────────────────────────────────────
  fs.mkdirSync(outDir, { recursive: true });
  const artifactName = `anxin-medication-${(application.versionName || "unknown").replace(/[^\w.-]/g, "-")}-release.apk`;
  const artifactPath = path.join(outDir, artifactName);
  fs.copyFileSync(apkPath, artifactPath);
  const artifactSha256 = sha256File(artifactPath);

  const info = {
    generator: "scripts/verify-release-apk.mjs",
    generatedAt: new Date().toISOString(),
    sourceApk: rel(apkPath),
    build: {
      // release-apk.mjs 出包时会把实际注入的 EXPO_PUBLIC_API_URL 传给本脚本；手工复验时可能为 null。
      apiUrl: process.env.EXPO_PUBLIC_API_URL?.trim() || null,
    },
    artifact: {
      path: rel(artifactPath),
      fileName: artifactName,
      sizeBytes,
      sha256: artifactSha256,
    },
    application: {
      packageName: application.packageName,
      versionName: application.versionName,
      versionCode: application.versionCode,
      minSdkVersion: application.minSdkVersion,
      targetSdkVersion: application.targetSdkVersion,
      abis: application.abis,
      debuggable: application.debuggable,
    },
    signature: {
      verified: signature.verified,
      schemes: signature.schemes,
      signerCount: signature.signerCount,
      certificateDn: signature.certificateDn,
      certificateSha256: signature.certificateSha256,
      keyAlgorithm: signature.keyAlgorithm,
      keySizeBits: signature.keySizeBits,
    },
    toolchain: {
      androidHome: toolchain.androidHome,
      buildToolsVersion: toolchain.buildToolsVersion,
      apksigner: rel(toolchain.apksigner),
      aapt: rel(toolchain.aapt),
    },
  };
  const infoPath = path.join(outDir, "release-apk-info.json");
  fs.writeFileSync(infoPath, `${JSON.stringify(info, null, 2)}\n`, "utf8");

  console.log(
    [
      "",
      "[verify] ✓ PASS  release APK 用正式证书签名，可分发",
      `  归档 APK:  ${rel(artifactPath)}`,
      `  归档信息:  ${rel(infoPath)}`,
      `  APK SHA-256: ${artifactSha256}`,
      `  证书 SHA-256: ${signature.certificateSha256}`,
      "",
      "  分发/装机（Android 15 真机，允许覆盖升级的只有同一签名证书的包）：",
      `    adb install -r ${rel(artifactPath)}`,
      "",
    ].join("\n"),
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) main();
