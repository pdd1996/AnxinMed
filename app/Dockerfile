# 安心用药 · api + web 生产镜像（多阶段：deps → build → runtime slim）
# 构建上下文 = app/（pnpm workspace 根）。见 app/README.md「生产部署」。
# 运行期：node 托管 packages/web/dist（静态）+ /api（Hono），端口 8787。

# ── stage 1: deps ─────────────────────────────────────────────
FROM node:22-slim AS deps
# 镜像源可注入：默认官方源（CI 安全），服务器可用 NPM_REGISTRY 覆盖为国内镜像
ARG NPM_REGISTRY=https://registry.npmjs.org
# corepack 下载 pnpm 走该源；pnpm/npm 均读 npm_config_registry 作为 registry
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}
ENV npm_config_registry=${NPM_REGISTRY}
# 跳过旧 corepack 的签名 keyid 校验（规避 Cannot find matching keyid）
ENV COREPACK_INTEGRITY_KEYS=0
RUN corepack enable
WORKDIR /app
# 只拷清单文件以利用层缓存。七个 importer 一个不能少：lockfile 的 importers 段与 workspace 清单
# 必须一一对应，少拷任一个（如 M5-T2 新增的 core）就会让 --frozen-lockfile 判定不同步而失败。
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
COPY packages/mcp/package.json packages/mcp/
COPY packages/mobile/package.json packages/mobile/
COPY e2e/package.json e2e/
RUN corepack prepare pnpm@11.23.0 --activate
RUN pnpm install --frozen-lockfile

# ── stage 2: build ────────────────────────────────────────────
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY --from=deps /app ./
COPY . .
# 只构建镜像真正伺服的两个包：web → packages/web/dist（vite）；api → packages/api/dist（esbuild）。
# 不用 `pnpm -r build`：@anxin/core 无 build 脚本（exports 直指 src/*.ts，由 vite/esbuild 消费），
# mobile/mcp 与镜像无关，构建它们只是白等。
RUN corepack prepare pnpm@11.23.0 --activate \
  && pnpm --filter @anxin/api --filter @anxin/web build

# ── stage 3: runtime ──────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# 运行期只需两个 dist + api 的 prod 依赖（保留 pnpm 符号链接结构）
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/packages/web/dist ./packages/web/dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/api/package.json ./packages/api/package.json
EXPOSE 8787
# serveStatic 的 root 为 ./packages/web/dist（相对 cwd=/app）
CMD ["node", "packages/api/dist/index.js"]
