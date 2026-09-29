#!/usr/bin/env node
/**
 * M5-T4 · dev 真机联调的 API 地址自动探测。
 *
 * 为什么要它：手机连的是电脑当时的局域网 IP，而 `.env.local` 写死的是**上一次**那个 IP
 * （换 Wi-Fi / 路由器重新分配后就是 stale 值，RN 侧表现为「请求死活不通」）。
 * 本脚本在启动 metro / 构建前探测当前局域网 IPv4，注入 `EXPO_PUBLIC_API_URL`（Expo 构建期内联）。
 *
 * 优先级（高 → 低）：
 *   1. 调用方 shell 里已有的 EXPO_PUBLIC_API_URL（临时指别处，用一次不用改文件）
 *   2. ANXIN_LAN_IP（明确点名某张网卡，多网卡/VPN 环境用）
 *   3. .env.local 里的 EXPO_PUBLIC_API_URL（手工固定值，例如 release 指火山）
 *   4. 本机探测到的局域网 IPv4 + ANXIN_API_PORT（默认 8787）
 *
 * 用法：`node scripts/with-lan-url.mjs <expo 子命令> [参数…]`（package.json 的 android:dev 已接好）。
 * @expo/env 不会覆盖已存在的 process.env，故注入值稳赢 .env.local。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.ANXIN_API_PORT ?? "8787";

/** 明显是虚拟/容器网卡的命名特征（Hyper-V、WSL、虚拟适配器、虚拟机网桥）。 */
const VIRTUAL_NAME = /(vethernet|vmware|virtualbox|hyper-v|wsl|docker|tap|tun|loopback|bluetooth)/i;
/** 虚拟网卡 MAC 前缀（Hyper-V / VirtualBox / WSL 常见）。 */
const VIRTUAL_MAC = /^(00:15:5d|00:50:56|00:03:ff|02:42:)/i;

function lanCandidates() {
  const out = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      const ip = info.address;
      if (ip.startsWith("169.254.")) continue; // 链路本地（没拿到 DHCP）
      if (VIRTUAL_NAME.test(name) || VIRTUAL_MAC.test((info.mac ?? "").toLowerCase())) continue;
      const wifi = /(wi-?fi|wlan|无线)/i.test(name);
      out.push({ name, ip, wifi });
    }
  }
  // Wi-Fi 优先：手机与电脑须同一 Wi-Fi，无线网卡才是对的那张
  return out.sort((a, b) => Number(b.wifi) - Number(a.wifi));
}

function urlFromEnvFile() {
  const file = path.join(projectRoot, ".env.local");
  if (!fs.existsSync(file)) return undefined;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (key.trim() !== "EXPO_PUBLIC_API_URL") continue;
    const value = rest.join("=").trim().replace(/^["']|["']$/g, "");
    if (/^https?:\/\//i.test(value)) return value;
  }
  return undefined;
}

function resolve() {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return { url: process.env.EXPO_PUBLIC_API_URL, from: "shell 环境变量" };
  }
  if (process.env.ANXIN_LAN_IP) {
    return { url: `http://${process.env.ANXIN_LAN_IP}:${PORT}`, from: "ANXIN_LAN_IP" };
  }
  const fileUrl = urlFromEnvFile();
  if (fileUrl) return { url: fileUrl, from: ".env.local" };
  const candidates = lanCandidates();
  if (candidates.length === 0) return undefined;
  const hit = candidates[0];
  return { url: `http://${hit.ip}:${PORT}`, from: `探测：${hit.name}` };
}

const resolved = resolve();
if (!resolved) {
  console.error(
    "[dev-url] 没能找到可用的局域网 IPv4 地址。\n" +
      "  · 确认电脑已连上 Wi-Fi（手机要连同一个）\n" +
      "  · 或显式指定：ANXIN_LAN_IP=192.168.x.x pnpm --filter @anxin/mobile android:dev",
  );
  process.exit(1);
}

const env = { ...process.env, EXPO_PUBLIC_API_URL: resolved.url };
console.log(`[dev-url] EXPO_PUBLIC_API_URL = ${resolved.url}  （来源：${resolved.from}）`);
const others = lanCandidates().filter((c) => `http://${c.ip}:${PORT}` !== resolved.url);
if (others.length > 0) {
  console.log(
    `[dev-url] 其他候选网卡：${others.map((c) => `${c.name}=${c.ip}`).join("，")}` +
      " —— 手机连的若是这些网络之一，用 ANXIN_LAN_IP 指定",
  );
}
if (!net.isIP(resolved.url.split("//")[1]?.split(":")[0] ?? "")) {
  console.log("[dev-url] 提示：地址不是 IP 形式，按手工配置处理");
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.log("[dev-url] 仅打印地址（未给子命令）。示例：node scripts/with-lan-url.mjs start --android");
  process.exit(0);
}

// 用 npx 拉起 expo：workspace hoisted 布局下 expo 的 bin 在 app/node_modules/.bin，
// 直接 spawn("expo") 在 Windows 上找不到 .cmd，故走 npx（与本包其它脚本同口径）。
const child = spawn("npx", ["expo", command, ...args], { stdio: "inherit", cwd: projectRoot, env });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
