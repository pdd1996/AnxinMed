# 安心用药 · api + web 生产镜像（多阶段：deps → build → runtime slim）
# 构建上下文 = app/（pnpm workspace 根）。见 app/README.md「生产部署」。
# 运行期：node 托管 packages/web/dist（静态）+ /api（Hono），端口 8787。

# ── stage 1: deps ─────────────────────────────────────────────
FROM node:20-slim AS deps
RUN corepack enable
WORKDIR /app
# 只拷清单文件以利用层缓存
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
RUN corepack prepare pnpm@11.23.0 --activate && pnpm install --frozen-lockfile

# ── stage 2: build ────────────────────────────────────────────
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /app
COPY --from=deps /app ./
COPY . .
# web: vite build → packages/web/dist ；api: esbuild bundle → packages/api/dist
RUN corepack prepare pnpm@11.23.0 --activate && pnpm -r build

# ── stage 3: runtime ──────────────────────────────────────────
FROM node:20-slim AS runtime
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
