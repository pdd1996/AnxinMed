/**
 * M5-T3/T4 · release 出包收紧（prebuild 插件）
 *
 * `app/packages/mobile/android/` 被 .gitignore 整目录忽略——它是 `expo prebuild` 生成的，
 * 手改既进不了版本库、也会在下次 prebuild 时被抹掉。这两条因此必须住在插件里：
 *
 * 1. `reactNativeArchitectures=arm64-v8a,x86_64`
 *    expo run:android 只在 **debug** 变体按已连设备 ABI 传 `-PreactNativeArchitectures`，
 *    release 变体用模板里的值；模板若只有 x86_64，release 包装进 ARM64 真机即
 *    `INSTALL_FAILED_NO_MATCHING_ABIS`。
 * 2. release 变体剔除 expo-dev-* 一族
 *    这些包的 `expo-module.config.json` 只在 apple 段标了 `debugOnly`，Android autolinking
 *    不分变体 → 开发者菜单（DevMenuModule）、DevLauncherPackage 与 `exp+<slug>://` 深链
 *    会一起进发布包。这里注入的段落读 `ANXIN_RELEASE_BUILD`（由 scripts/release-apk.mjs 设置），
 *    出 dev 包时不置位 → autolinking 行为不变。
 */
const { withGradleProperties, withSettingsGradle } = require("@expo/config-plugins");

const ARCHITECTURES = "arm64-v8a,x86_64";
const MARKER = "ANXIN_RELEASE_BUILD";
const DEV_CLIENT_PACKAGES = [
  "expo-dev-client",
  "expo-dev-launcher",
  "expo-dev-menu",
  "expo-dev-menu-interface",
];

const SETTINGS_BLOCK = [
  "// ── with-release-hardening：发布包剔除开发者工具链（见 plugins/with-release-hardening.js）──",
  `if (System.getenv('${MARKER}') == '1') {`,
  "  expoAutolinking.exclude = [",
  ...DEV_CLIENT_PACKAGES.map((p, i) => `    '${p}'${i === DEV_CLIENT_PACKAGES.length - 1 ? "" : ","}`),
  "  ]",
  "}",
  "",
].join("\n");

function applyGradleProperties(props) {
  const list = props ?? [];
  const hit = list.find((p) => p.type === "property" && p.key === "reactNativeArchitectures");
  if (hit) {
    hit.value = ARCHITECTURES;
  } else {
    list.push({ type: "property", key: "reactNativeArchitectures", value: ARCHITECTURES });
  }
  return list;
}

function applySettingsGradle(contents) {
  const text = contents ?? "";
  if (text.includes(MARKER)) return text;
  const anchor = "expoAutolinking.useExpoModules()";
  return text.includes(anchor)
    ? text.replace(anchor, `${SETTINGS_BLOCK}${anchor}`)
    : `${text}\n${SETTINGS_BLOCK}${anchor}\n`;
}

module.exports = function withReleaseHardening(config) {
  const withArch = withGradleProperties(config, (cfg) => {
    cfg.modResults = applyGradleProperties(cfg.modResults);
    return cfg;
  });

  return withSettingsGradle(withArch, (cfg) => {
    cfg.modResults = { ...cfg.modResults, contents: applySettingsGradle(cfg.modResults?.contents) };
    return cfg;
  });
};

module.exports.transforms = { applyGradleProperties, applySettingsGradle };
