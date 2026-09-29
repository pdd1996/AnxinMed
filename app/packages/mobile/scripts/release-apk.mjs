#!/usr/bin/env node
/**
 * M5-T3/T4 · release APK 出包。
 *
 * 为什么不复用 with-lan-url.mjs（两条都不适用）：
 *  1. release 绝不能做局域网探测——把开发机 IP 烙进发布包，真机出去必然连不上；
 *     地址只认 shell 里的 EXPO_PUBLIC_API_URL 或 `.env.production.local`，两者都没有就直接失败。
 *  2. release 要剔除 expo-dev-* 一族（开发者菜单 + `exp+<slug>://` 深链）。
 *     Android 侧的 autolinking 没有 debugOnly 概念，靠 `ANXIN_RELEASE_BUILD=1`
 *     触发 `android/settings.gradle` 里的排除段——那段是 `plugins/with-release-hardening.js`
 *     在 prebuild 期注入的（android/ 不入 git，手改会被下次 prebuild 抹掉）。
 *
 * 构建走 `gradlew assembleRelease` 而不是 `expo run:android --variant release`：后者要求先有
 * 已连设备/模拟器，且会顺手 `install`；出包给真机（adb install 或微信传文件）不需要这些。
 *
 * 用法：`pnpm --filter @anxin/mobile android:release`
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = path.join(projectRoot, "android");

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
  console.error(
    "[release] 没有服务器地址，拒绝出包（禁静默打出连不上后端的 APK）。\n" +
      "  · 新建 .env.production.local 写一行：EXPO_PUBLIC_API_URL=http://<公网IP或域名>:8787\n" +
      "  · 或临时指定：EXPO_PUBLIC_API_URL=http://<地址>:8787 pnpm --filter @anxin/mobile android:release\n" +
      "  抄 .env.example 末尾那段即可。",
  );
  process.exit(1);
}

// 模拟器/回环地址出到发布包里等于「装上去就打不开」，且报错发生在用户手机上——在这里拦住。
if (/^https?:\/\/(10\.0\.2\.2|localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/)/i.test(apiUrl)) {
  console.error(
    `[release] 地址 ${apiUrl} 是模拟器/回环专用地址，真机访问不到，拒绝出包。\n` +
      "  · dev 联调请走 pnpm --filter @anxin/mobile android:dev（自动探测局域网 IP）\n" +
      "  · 发布包应指向公网地址（M5-T1 火山）",
  );
  process.exit(1);
}

console.log(
  `[release] EXPO_PUBLIC_API_URL = ${apiUrl}  （来源：${fromShell ? "shell 环境变量" : ".env.production.local"}）`,
);
console.log("[release] ANXIN_RELEASE_BUILD=1 —— autolinking 排除 expo-dev-* 一族");

const gradlew = path.join(androidRoot, process.platform === "win32" ? "gradlew.bat" : "gradlew");
// Windows 上 Node 禁止无 shell 地 spawn .bat（EINVAL），故显式走 cmd /c。
const [command, args] =
  process.platform === "win32" ? ["cmd.exe", ["/c", gradlew, "assembleRelease"]] : [gradlew, ["assembleRelease"]];
const child = spawn(command, args, {
  stdio: "inherit",
  cwd: androidRoot,
  env: { ...process.env, EXPO_PUBLIC_API_URL: apiUrl, ANXIN_RELEASE_BUILD: "1" },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  if (code === 0) {
    console.log(
      "\n[release] 出包完成 → android/app/build/outputs/apk/release/app-release.apk\n" +
        "  自检三条（都应无输出／命中预期值）：\n" +
        '  · 地址已内联：unzip -p app-release.apk assets/index.android.bundle | grep -c "' + apiUrl + '"\n' +
        "  · 无开发菜单：aapt dump xmltree app-release.apk AndroidManifest.xml | grep -c \"exp+\"\n" +
        "  · 含 ARM64：unzip -l app-release.apk | grep -oE \"lib/[A-Za-z0-9_-]+/\" | sort -u（模式要带连字符，否则 arm64-v8a 会被漏掉）",
    );
  }
  process.exit(code ?? 0);
});
