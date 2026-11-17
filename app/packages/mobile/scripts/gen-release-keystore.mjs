#!/usr/bin/env node
/**
 * G8 · 生成正式 release 签名 keystore（PKCS12）与本地凭据文件。
 *
 * 产物（目录整体被 .gitignore 忽略，绝不入库）：
 *   <mobile>/.credentials/anxin-release.p12   PKCS12 keystore（RSA 4096 / SHA384withRSA / 10000 天）
 *   <mobile>/.credentials/release-signing.env     凭据（每行一条 KEY=VALUE；密码为本地随机强密码）
 *
 * 为什么必须正式签名：Expo prebuild 模板的 release 变体默认拿 debug keystore（CN=Android Debug）签名，
 * 这种 APK 不可分发、也无法覆盖升级。正式 keystore 由本脚本生成，签名注入住在
 * `plugins/with-release-signing.js`（android/ 不入 git，下次 prebuild 自动就位）。
 *
 * 安全约定：
 *   · 密码用 crypto 随机生成后**只**写进 .credentials/release-signing.env，不打印、不进日志；
 *   · keytool 的密码经 `-storepass:env` / `-keypass:env` 从环境变量读，不出现在命令行（进程列表）；
 *   · 已存在 keystore/凭据时拒绝覆盖（防误删唯一签名材料），确需重建/轮换加 `--force`，
 *     旧文件先备份为 *.bak-<时间戳>——轮换后已安装旧包无法覆盖升级，见 SIGNING.md。
 *
 * 用法（在 app/packages/mobile 下）：
 *   node scripts/gen-release-keystore.mjs               # 首次生成；已存在则拒绝
 *   node scripts/gen-release-keystore.mjs --force       # 重建/轮换（先备份旧文件）
 *   node scripts/gen-release-keystore.mjs --alias foo   # 自定义 key alias（默认 anxin-release）
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const credentialsDir = path.join(projectRoot, ".credentials");
const keystorePath = path.join(credentialsDir, "anxin-release.p12");
const envFilePath = path.join(credentialsDir, "release-signing.env");

const DEFAULT_ALIAS = "anxin-release";
const KEYSTORE_TYPE = "PKCS12";
const KEY_SIZE = 4096;
const VALIDITY_DAYS = 10000;
const D_NAME = "CN=AnxinMed, OU=Mobile, O=AnxinMed, L=Shanghai, ST=Shanghai, C=CN";
const KEYTOOL_PASSWORD_ENV = "ANXIN_KEYTOOL_GENERATED_PASSWORD";
const DEFAULT_JDK17 = "D:\\03Environments\\jdk17";

function fail(message) {
  console.error(`\n[keystore] ${message}`);
  process.exit(1);
}

function rel(file) {
  return path.relative(projectRoot, file).split(path.sep).join("/");
}

function usage() {
  console.log(
    [
      "生成正式 release 签名 keystore（PKCS12）与本地凭据文件。",
      "",
      "用法：node scripts/gen-release-keystore.mjs [--force] [--alias <别名>]",
      "",
      "  --force         已存在时也重建/轮换（旧文件先备份为 *.bak-<时间戳>；已装旧包将无法覆盖升级）",
      "  --alias <别名>  key alias，默认 " + DEFAULT_ALIAS,
      "  -h, --help      打印本帮助",
      "",
      "产物：.credentials/anxin-release.p12 与 .credentials/release-signing.env（均被 .gitignore 忽略）",
    ].join("\n"),
  );
}

// ── 参数 ────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  usage();
  process.exit(0);
}
let force = false;
let alias = DEFAULT_ALIAS;
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === "--force") {
    force = true;
  } else if (arg === "--alias") {
    alias = argv[i + 1];
    i += 1;
  } else {
    fail(`未知参数：${arg}\n先用 --help 看用法。`);
  }
}
if (!alias || !/^[A-Za-z0-9._-]+$/.test(alias)) {
  fail(`--alias 只能是字母/数字/._-：${JSON.stringify(alias)}`);
}

// ── keytool（JDK 17）─────────────────────────────────────────────────────────────
function resolveKeytool() {
  const exe = process.platform === "win32" ? "keytool.exe" : "keytool";
  const candidates = [];
  if (process.env.ANXIN_KEYTOOL) candidates.push(process.env.ANXIN_KEYTOOL);
  if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, "bin", exe));
  candidates.push(path.join(DEFAULT_JDK17, "bin", exe)); // 本机约定的 JDK17 安装位置（仅当存在）
  candidates.push(exe); // PATH
  for (const candidate of candidates) {
    if (candidate.includes(path.sep) && !fs.existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ["-help"], { encoding: "utf8", windowsHide: true });
    if (!probe.error && probe.status === 0) return candidate;
  }
  fail(
    "找不到可用的 keytool（需要 JDK 17）。\n" +
      "  · 设置 JAVA_HOME 指向 JDK 17（本机：D:\\03Environments\\jdk17），或\n" +
      "  · 设置 ANXIN_KEYTOOL=<keytool 绝对路径>",
  );
}

function runKeytool(keytool, args, extraEnv) {
  const result = spawnSync(keytool, args, {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...(extraEnv ?? {}) },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { status: result.status, output, error: result.error };
}

const keytool = resolveKeytool();

// ── 拒绝覆盖（除非 --force，且旧文件先备份）──────────────────────────────────────
fs.mkdirSync(credentialsDir, { recursive: true, mode: 0o700 });
const existing = [keystorePath, envFilePath].filter((file) => fs.existsSync(file));
if (existing.length > 0 && !force) {
  fail(
    `已存在签名材料，拒绝覆盖（保护唯一签名凭证）：\n` +
      existing.map((file) => `  · ${rel(file)}`).join("\n") +
      "\n  确需重建/轮换请加 --force：旧文件会先备份为 *.bak-<时间戳>；" +
      "\n  警告：换 keystore 后已安装用户无法覆盖升级，必须先卸载重装（应用内数据会丢），流程见 SIGNING.md。",
  );
}
if (existing.length > 0) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  console.log("[keystore] --force：旧签名材料先备份");
  for (const file of existing) {
    const backupPath = `${file}.bak-${stamp}`;
    fs.copyFileSync(file, backupPath);
    fs.rmSync(file);
    console.log(`  · ${rel(file)} → ${rel(backupPath)}`);
  }
}

// ── 生成 keystore（密码只在内存/子进程环境中）────────────────────────────────────
const password = crypto.randomBytes(24).toString("base64url"); // 32 字符，URL-safe，足够强
const keytoolEnv = { [KEYTOOL_PASSWORD_ENV]: password };

const generateArgs = [
  "-genkeypair",
  "-v",
  "-storetype",
  KEYSTORE_TYPE,
  "-keystore",
  keystorePath,
  "-alias",
  alias,
  "-keyalg",
  "RSA",
  "-keysize",
  String(KEY_SIZE),
  "-validity",
  String(VALIDITY_DAYS),
  "-dname",
  D_NAME,
  "-storepass:env",
  KEYTOOL_PASSWORD_ENV,
  "-keypass:env",
  KEYTOOL_PASSWORD_ENV,
  "-J-Duser.language=en",
  "-J-Duser.country=US",
];
console.log(`[keystore] keytool: ${keytool}`);
console.log(`[keystore] 生成 ${KEYSTORE_TYPE} keystore（RSA ${KEY_SIZE} / ${VALIDITY_DAYS} 天 / alias=${alias}）...`);
const generated = runKeytool(keytool, generateArgs, keytoolEnv);
if (generated.status !== 0) {
  if (fs.existsSync(keystorePath)) fs.rmSync(keystorePath, { force: true });
  fail(`keytool -genkeypair 失败（exit=${generated.status}）：\n${generated.output}`);
}

// ── 立刻回读校验（别名 / 证书 SHA-256 / 有效期）──────────────────────────────────
const listed = runKeytool(
  keytool,
  [
    "-list",
    "-v",
    "-keystore",
    keystorePath,
    "-alias",
    alias,
    "-storepass:env",
    KEYTOOL_PASSWORD_ENV,
    "-J-Duser.language=en",
    "-J-Duser.country=US",
  ],
  keytoolEnv,
);
if (listed.status !== 0) {
  fail(`keystore 生成后 keytool -list 校验失败（exit=${listed.status}）：\n${listed.output}`);
}
const aliasMatch = /Alias name:\s*(\S+)/.exec(listed.output);
const fingerprintMatch = /SHA256:\s*([0-9A-Fa-f:]+)/.exec(listed.output);
const validityMatch = /Valid from:\s*(.+?)\s+until:\s*(.+)/.exec(listed.output);
if (!aliasMatch || aliasMatch[1] !== alias) {
  fail(`回读校验失败：keytool -list 的别名不是 ${alias}（实际：${aliasMatch?.[1] ?? "解析不到"}）`);
}
if (!fingerprintMatch) {
  fail(`回读校验失败：keytool -list 输出里解析不到证书 SHA-256 指纹。\n${listed.output}`);
}
const fingerprint = fingerprintMatch[1].toUpperCase();

// ── 写凭据文件（每行一条 KEY=VALUE；不打印密码）──────────────────────────────────
const storeFileValue = keystorePath.split(path.sep).join("/");
const envContent = [
  `ANXIN_RELEASE_STORE_FILE=${storeFileValue}`,
  `ANXIN_RELEASE_STORE_PASSWORD=${password}`,
  `ANXIN_RELEASE_KEY_ALIAS=${alias}`,
  `ANXIN_RELEASE_KEY_PASSWORD=${password}`,
  "",
].join("\n");
try {
  fs.writeFileSync(envFilePath, envContent, { encoding: "utf8", mode: 0o600 });
} catch (error) {
  fail(
    `keystore 已生成，但写凭据文件失败：${error instanceof Error ? error.message : String(error)}\n` +
      `  keystore 在 ${rel(keystorePath)}；请手工补 .credentials/release-signing.env（字段见 SIGNING.md），否则无法出包。`,
  );
}

console.log(
  [
    "",
    "[keystore] 正式签名 keystore 已生成",
    `  路径:          ${rel(keystorePath)}`,
    `  别名:          ${alias}`,
    `  证书 SHA-256:  ${fingerprint}`,
    `  有效期至:      ${validityMatch?.[2] ?? "（以 keytool -list 为准）"}`,
    `  凭据文件:      ${rel(envFilePath)}（每行一条 KEY=VALUE；密码只在本机，已被 .gitignore 忽略）`,
    "",
    "  ⚠ 备份警告：keystore + 密码是「覆盖升级」的唯一凭证",
    "    · 备份到密码管理器/离线介质，至少两处；不要只留这台机器；",
    "    · 丢失后已安装用户无法升级，只能卸载重装（应用内数据会丢）；",
    "    · 禁止提交 git、禁止贴聊天/工单；轮换流程见 app/packages/mobile/SIGNING.md。",
    "",
    "  下一步（在 app/ 下）：",
    "    · 换机/首次：npx expo prebuild --platform android   # 让 plugins/with-release-signing.js 注入 android/",
    "    · 出包：    pnpm --filter @anxin/mobile android:release",
    "    · 只做前置检查：cd app/packages/mobile && node scripts/release-apk.mjs --check",
    "",
  ].join("\n"),
);
process.exit(0);
