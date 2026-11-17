#!/usr/bin/env node
/**
 * G8 · `plugins/with-release-signing.js` 自验（可重复运行，不需要 prebuild / Gradle / 真机）。
 *
 * 直接把插件导出的 `transforms.applyAppBuildGradle` 作用在「Expo 模板形状」的样例
 * android/app/build.gradle 上，断言：
 *   · signingConfigs 里注入了 release（四个凭据走 providers.gradleProperty）；
 *   · buildTypes.release 从 signingConfigs.debug 改成 signingConfigs.release；
 *   · buildTypes.debug 完全没动（debug 构建行为不变）；
 *   · release 缺凭据在配置期抛 GradleException（中文指引，fail-closed，且只对 release 类任务生效）；
 *   · 幂等：apply 两次 === apply 一次，MARKER 只出现一次；
 *   · 形状异常（找不到 signingConfigs）时抛错可见，不静默跳过；
 *   · app.json 已注册 ./plugins/with-release-signing。
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = require("../plugins/with-release-signing.js");

const { applyAppBuildGradle, findMatchingBrace, MARKER } = plugin.transforms;

// Expo prebuild 生成的模板形状（与实际 android/app/build.gradle 一致；android/ 不入 git，故样例内联）。
const SAMPLE_GRADLE = `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"

def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()

def enableMinifyInReleaseBuilds = (findProperty('android.enableMinifyInReleaseBuilds') ?: false).toBoolean()
def jscFlavor = 'io.github.react-native-community:jsc-android:2026004.+'

android {
    ndkVersion rootProject.ext.ndkVersion

    buildToolsVersion rootProject.ext.buildToolsVersion
    compileSdk rootProject.ext.compileSdkVersion

    namespace 'com.anxin.mobile'
    defaultConfig {
        applicationId 'com.anxin.mobile'
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0.0"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'
            shrinkResources enableShrinkResources.toBoolean()
            minifyEnabled enableMinifyInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
            def enablePngCrunchInRelease = findProperty('android.enablePngCrunchInReleaseBuilds') ?: 'true'
            crunchPngs enablePngCrunchInRelease.toBoolean()
        }
    }
    packagingOptions {
        jniLibs {
            def enableLegacyPackaging = findProperty('expo.useLegacyPackaging') ?: 'false'
            useLegacyPackaging enableLegacyPackaging.toBoolean()
        }
    }
    androidResources {
        ignoreAssetsPattern '!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~'
    }
}

dependencies {
    implementation("com.facebook.react:react-android")
}
`;

let failures = 0;
let checks = 0;

function check(name, fn) {
  checks += 1;
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** 取 `signingConfigs { ... }` 块内部文本（按花括号配对，跳过注释/字符串）。 */
function blockBody(text, keyword) {
  const match = new RegExp(`\\b${keyword}\\s*\\{`).exec(text);
  assert(match, `找不到 ${keyword} 块`);
  const open = text.indexOf("{", match.index);
  const close = findMatchingBrace(text, open);
  assert(close > open, `${keyword} 块花括号不配对`);
  return text.slice(open + 1, close);
}

/** 取 buildTypes 里某个 buildType 块内部文本。 */
function buildTypeBody(text, name) {
  const buildTypes = blockBody(text, "buildTypes");
  const match = new RegExp(`\\b${name}\\s*\\{`).exec(buildTypes);
  assert(match, `buildTypes 里找不到 ${name} 块`);
  const open = buildTypes.indexOf("{", match.index);
  const close = findMatchingBrace(buildTypes, open);
  assert(close > open, `buildTypes.${name} 块花括号不配对`);
  return buildTypes.slice(open + 1, close);
}

console.log("with-release-signing 插件自验（纯字符串变换，不跑 prebuild / Gradle）\n");

check("插件导出形态正确：默认函数 + transforms.applyAppBuildGradle", () => {
  assert(typeof plugin === "function", "module.exports 不是 config plugin 函数");
  assert(typeof applyAppBuildGradle === "function", "transforms.applyAppBuildGradle 未导出");
  assert(typeof findMatchingBrace === "function", "transforms.findMatchingBrace 未导出");
  assert(typeof MARKER === "string" && MARKER.includes("ANXIN_RELEASE_SIGNING_V1"), "MARKER 常量缺失");
});

const output = applyAppBuildGradle(SAMPLE_GRADLE);

check("注入了 signingConfigs.release（凭据全部走 providers.gradleProperty）", () => {
  const signingConfigs = blockBody(output, "signingConfigs");
  assert(/\brelease\s*\{/.test(signingConfigs), "signingConfigs 里没有 release 块");
  for (const prop of [
    "ANXIN_RELEASE_STORE_FILE",
    "ANXIN_RELEASE_STORE_PASSWORD",
    "ANXIN_RELEASE_KEY_ALIAS",
    "ANXIN_RELEASE_KEY_PASSWORD",
  ]) {
    assert(
      output.includes(`providers.gradleProperty('${prop}')`),
      `release 签名凭据没有走 providers.gradleProperty('${prop}')`,
    );
  }
  const releaseConfig = blockBody(signingConfigs, "release");
  for (const assignment of [
    "storeFile anXinStore",
    "storePassword anXinStorePassword.get()",
    "keyAlias anXinKeyAlias.get()",
    "keyPassword anXinKeyPassword.get()",
  ]) {
    assert(releaseConfig.includes(assignment), `signingConfigs.release 缺少赋值：${assignment}`);
  }
  // 明文只允许出现在「非 release 任务的 debug.keystore 占位」里，真正的四个凭据必须来自 providers。
  assert(
    !/storePassword\s+'[^']*'/.test(releaseConfig.replace("storePassword 'unused'", "")),
    "疑似写了明文 storePassword",
  );
});

check("buildTypes.release 改用 signingConfigs.release，不再用 debug 签名", () => {
  const release = buildTypeBody(output, "release");
  assert(/signingConfig\s+signingConfigs\.release\b/.test(release), "release 变体没有切到 signingConfigs.release");
  assert(!/signingConfig\s+signingConfigs\.debug\b/.test(release), "release 变体仍在用 signingConfigs.debug");
});

check("buildTypes.debug 完全未动（debug 构建仍用 debug 签名）", () => {
  const debug = buildTypeBody(output, "debug");
  assert(/signingConfig\s+signingConfigs\.debug\b/.test(debug), "debug 变体的 signingConfigs.debug 被改掉了");
  assert(!/signingConfigs\.release\b/.test(debug), "debug 变体被误改成 release 签名");
});

check("fail-closed：release 缺凭据时配置期抛 GradleException（中文指引）", () => {
  assert(output.includes("throw new GradleException"), "缺少 GradleException 抛出逻辑");
  assert(output.includes("缺少 release 签名凭据"), "异常文案缺少中文说明");
  assert(output.includes("gen-release-keystore.mjs"), "异常文案没有指向 keystore 生成脚本");
  assert(output.includes("android:release"), "异常文案没有指向 android:release 出包入口");
  assert(output.includes("anXinReleaseRequested && !anXinMissing.isEmpty()"), "缺少「release 任务且缺凭据」的判定");
});

check("fail-closed 只对 release 类任务生效：debug 任务命中条件里不含 release 判定", () => {
  const signingConfigs = blockBody(output, "signingConfigs");
  assert(
    signingConfigs.includes("contains('release')") &&
      signingConfigs.includes("anXinName == 'build'") &&
      signingConfigs.includes("anXinName == 'assemble'"),
    "release 任务识别逻辑不完整（assembleRelease/build/assemble 应全部覆盖）",
  );
  assert(
    signingConfigs.includes("if (!anXinMissing.isEmpty())") &&
      signingConfigs.includes("storeFile file('debug.keystore')"),
    "缺凭据时没有给 debug 任务留占位 signingConfig（AGP 配置期会失败）",
  );
});

check("凭据齐全但 keystore 不存在时配置期报错可见（不静默回退 debug）", () => {
  assert(output.includes("ANXIN_RELEASE_STORE_FILE 指向的 keystore 不存在"), "缺少 keystore 文件存在性校验");
  assert(/if \(anXinReleaseRequested && !anXinStore\.exists\(\)\)/.test(output), "keystore 存在性校验未按 release 任务生效");
});

check("幂等：apply 两次 === apply 一次，MARKER 只出现一次", () => {
  const second = applyAppBuildGradle(output);
  assert(second === output, "重复 apply 改变了文本（非幂等）");
  const markerCount = output.split(MARKER).length - 1;
  assert(markerCount === 1, `MARKER 出现 ${markerCount} 次（应为 1）`);
});

check("空输入不抛错（返回原文，prebuild 不会因空文件炸）", () => {
  assert(applyAppBuildGradle("") === "", "空字符串输入返回被改动");
  assert(applyAppBuildGradle(undefined) === "", "undefined 输入未安全返回");
});

check("形状异常（无 signingConfigs）时抛错可见，不静默跳过", () => {
  let threw = false;
  try {
    applyAppBuildGradle("android {\n    buildTypes { release { } }\n}\n");
  } catch (error) {
    threw = true;
    assert(/signingConfigs/.test(error.message), `抛错信息未点明 signingConfigs：${error.message}`);
  }
  assert(threw, "找不到 signingConfigs 时没有抛错（会静默打出 debug 签名包）");
});

check("注入后 android 块花括号仍配对", () => {
  const code = output.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const open = code.indexOf("{", code.indexOf("android {"));
  assert(open > 0, "找不到 android 块");
  const close = findMatchingBrace(code, open);
  assert(close > open, "android 块花括号不配对");
});

check("app.json 已注册 ./plugins/with-release-signing", () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "app.json"), "utf8"));
  const plugins = appJson.expo?.plugins ?? [];
  assert(Array.isArray(plugins), "app.json 的 expo.plugins 不是数组");
  assert(plugins.includes("./plugins/with-release-signing"), "app.json 未注册 ./plugins/with-release-signing");
});

if (failures === 0) {
  console.log(`\nPASS  ${checks}/${checks} 项断言全部通过（with-release-signing 插件）`);
  process.exit(0);
}
console.error(`\nFAIL  ${failures}/${checks} 项断言失败（with-release-signing 插件）`);
process.exit(1);
