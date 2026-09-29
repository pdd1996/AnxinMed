const path = require("path");

const { getDefaultConfig } = require("expo/metro-config");

const { withNativeWind } = require("nativewind/metro");

/**
 * M5-T4：mobile 直接以**源码形态**引用 workspace 包（@anxin/core、@anxin/shared 的 exports 指向 src/*.ts），
 * 这些文件在 packages/mobile 目录之外 → Metro 必须把 workspace 根纳入 watchFolders，
 * 并在 hoisted 扁平布局下同时看见包内与 workspace 根两级 node_modules。
 * 不改上游产物形态（Expo 生成的就是 CJS 配置），只补这三处。
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(__dirname, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = Array.from(
  new Set([...(config.watchFolders ?? []), workspaceRoot])
);

config.resolver.nodeModulesPaths = Array.from(
  new Set([
    path.join(projectRoot, "node_modules"),
    path.join(workspaceRoot, "node_modules"),
    ...(config.resolver.nodeModulesPaths ?? []),
  ])
);

/**
 * workspace 包（@anxin/shared、@anxin/core）是 NodeNext 风格源码：相对导入带 `.js` 后缀
 * （`export * from './enums.js'` 指向 enums.ts）。Vite/node 能映射，Metro 默认不能 →
 * 解析失败时把 `.js` 换成 `.ts`/`.tsx` 再试一次（真实 .js 文件走第一条路径即命中，不受影响）。
 */
const JS_EXT = /^\.{1,2}\/.*\.js$/;
const upstreamResolve = config.resolver.resolveRequest;

function resolveRequest(context, moduleName, platform) {
  const base = upstreamResolve ?? context.resolveRequest;
  try {
    return base(context, moduleName, platform);
  } catch (error) {
    if (!JS_EXT.test(moduleName)) throw error;
    for (const alt of [moduleName.replace(/\.js$/, ".ts"), moduleName.replace(/\.js$/, ".tsx")]) {
      try {
        return base(context, alt, platform);
      } catch {
        /* 换扩展名也没命中 → 抛回原始错误，保留「谁引的、找什么」的上下文 */
      }
    }
    throw error;
  }
}

config.resolver.resolveRequest = resolveRequest;

module.exports = withNativeWind(config, { input: "./src/global.css" });
