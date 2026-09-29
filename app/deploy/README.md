# M5-T1 · 火山引擎 ECS 部署清单

> 真相源：[../../docs/specs/05-M5-安卓迁移与服务端上云.md](../../docs/specs/05-M5-安卓迁移与服务端上云.md) §T1 与 [05a-M5-T1-火山上云执行书.md](../../docs/specs/05a-M5-T1-火山上云执行书.md)。
> 本文件是【用户操作】照做清单：命令可直接复制，**但每台机器的差异处（IP、路径、口令）已用 `<...>` 标出**。
> 边界：不改任何业务代码；`app/` 目录下只有本 `deploy/` 与 `docker-compose.yml` 属本任务。

## 0. 前提与约定

| 项 | 值 |
|---|---|
| 服务器 | 火山引擎 ECS **4C8G**（任务书基线 2C4G，当前配置有余量） |
| 系统 | Ubuntu 22.04 / 24.04 LTS，Docker + compose plugin 已装 |
| 部署路径 | `/opt/AnxinMed`（仓库根），compose 在 `/opt/AnxinMed/app` |
| 公网入口（过渡期） | `http://<ECS_IP>:8787` —— api 进程同时托管 `/api` 与前端静态 dist |
| 数据库 | **不映射公网**，compose 里已收紧为 `127.0.0.1:5432`，只供容器内访问与 SSH 隧道 |

先确认 docker 可用（两台机器各一次）：

```bash
docker --version && docker compose version
```

## 1. 安全组（火山控制台 → ECS → 安全组）

| 端口 | 来源 | 用途 | 备注 |
|---|---|---|---|
| 22 | **限你家/办公室公网 IP**（`x.x.x.x/32`；动态 IP 放宽到 `/24`） | SSH | 全 0.0.0.0/0 暴露是爆破入口；不想开可用火山「会话管理」 |
| 80 / 443 | `0.0.0.0/0` | Caddy（备案后才真正接流量） | 先放行占位 |
| 8787 | `0.0.0.0/0` | 过渡期公网入口（APK / H5 / 医生端） | **域名未备案前不要把它挪到 80**：大陆 IP 上未备案域名的 80/443 会被云厂商拦截 |
| 5432 | **不放行** | — | 数据库不进公网（05 任务书 T1 第 2 条硬要求） |

自查（本机执行，能通说明放行对了）：

```bash
curl -sS -o /dev/null -w 'health=%{http_code}\n' http://<ECS_IP>:8787/api/health
nc -zv -w3 <ECS_IP> 5432 && echo '⚠️ 5432 竟然可达，安全组或 compose 没收紧' || echo 'ok: 5432 公网不可达'
```

## 2. 前置坑：大陆 ECS 的国际链路（**实测项，不要跳过**）

远端 build 要拉 `node:22-slim`，运行要拉 `postgres:18-alpine` + `caddy:2-alpine`。
**实测（2026-09-28，火山北京 4C8G）**：该机器 `git fetch` GitHub 直接 `GnuTLS recv error (-110)`，
所以先假设 docker.io 也不通——按顺序验，别边跑边猜：

```bash
timeout 90 docker pull postgres:18-alpine && echo 'dockerhub 直连可用'
```

不通再配火山私有加速器（控制台「容器镜像服务 → 镜像加速器」，形如 `https://<加速ID>.mirror.volces.com`）：

```bash
sudo mkdir -p /etc/docker
# 火山私有加速域名在控制台「容器镜像服务 → 镜像加速器」里，形如 https://xxxx.mirror.volces.com
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{ "registry-mirrors": ["https://<你的加速ID>.mirror.volces.com"] }
JSON
sudo systemctl daemon-reload && sudo systemctl restart docker
docker info | grep -A3 'Registry Mirrors'
timeout 120 docker pull node:22-slim && timeout 120 docker pull postgres:18-alpine && timeout 60 docker pull caddy:2-alpine
```

> 重启 docker 会中断在跑的容器——首次部署时还没有数据，无风险。
> npm 侧不受此影响：`.env` 里 `NPM_REGISTRY=https://registry.npmmirror.com` 已是国内源。
>
> **npm 源要落进 `/root/.npmrc` 才有效**（实测）：只设 `npm_config_registry` 环境变量时，pnpm 11 仍按
> `registry.npmjs.org` 拉 tarball；Dockerfile 已改为写 npmrc。
>
> **`--trust-lockfile` 是大陆链路的必需品**（实测）：pnpm 11 安装时会对 lockfile 的 1158 个条目逐个查信任证据
> （每条目一次 packument 请求），在该机器上耗时 2m13s～5m07s，三轮构建全部死在这一步的超时上。
> Dockerfile 已加 `--trust-lockfile` 跳过它——完整性仍由 `--frozen-lockfile` 的 integrity 哈希保证，
> 只是不再额外核每包的信任等级。本机/CI 网络快，仍走完整校验（该旗标只在镜像构建里用）。
> 另：pnpm store 已挂 BuildKit 缓存，重跑构建时实测 `reused 1024`，不重下全部。

## 3. 代码上云：两条路线，按链路可达性选

**3a. git clone（GitHub 可达时首选，升级/回滚靠提交号最干净）**

```bash
sudo mkdir -p /opt && cd /opt
git clone https://github.com/pdd1996/AnxinMed.git
cd AnxinMed/app && git log --oneline -1   # 必须是含 M5-T1 部署物的提交
```

仓库当前匿名可读（实测 `git ls-remote` 无凭据通过 + GitHub API 200），无需 token；仓库内没有任何密钥
（`.env`、`app/backups/` 均在 `.gitignore`，`deploy/.env.example` 全占位）。

**3b. scp 源码包（GitHub 不可达时用——实测走的这条）**

本机从指定提交打精确快照（不含工作区脏改动、不含 `.env`/dump）。
**必须带 `-c core.autocrlf=false`**：实测 Windows `core.autocrlf=true` 下 `git archive` 会把文本转成 CRLF，
`.gitattributes` 也挡不住这条路径，结果是 Linux 上 `backup.sh` 的 shebang 变成 `bash\r` 跑不起来、
`.env` 值尾部混入不可见 `\r`。打完先验行尾再上传：

```bash
cd <仓库根>
git -c core.autocrlf=false archive --format=tar.gz -o app/backups/anxin-src-<提交号>.tar.gz <提交号> app
tar -tzf app/backups/anxin-src-<提交号>.tar.gz | wc -l                    # 实测 449 个文件
tar -xzOf app/backups/anxin-src-<提交号>.tar.gz app/deploy/backup.sh | tr -dc '\r' | wc -c   # 必须是 0
scp app/backups/anxin-src-<提交号>.tar.gz root@<ECS_IP>:/tmp/
```

> 自检用 `tr -dc '\r' | wc -c` 数 CR 字节，**不要用 `grep -c $'\r'`**：实测同一个干净文件它先给 0 后给 43
> （43 恰为行数），会把好包判成坏包、也会让假阴性蒙混过关。

（已在 `app/backups/` 里留了旧包的话，重打一份覆盖它；旧包是 CRLF 的，别再用。）

服务器解到干净目录，**旧目录改名保留、不删**（服务器上的手工改动先另存 patch）：

```bash
cd ~ && git -C AnxinMed diff app/Dockerfile > ~/server-Dockerfile.patch   # 改名前先取差异
mv AnxinMed AnxinMed.old-<旧提交短号>
mkdir -p ~/anxin && tar -xzf /tmp/anxin-src-<提交号>.tar.gz -C ~/anxin
cd ~/anxin/app && grep -c '^COPY packages' Dockerfile                     # 期望 6
```

> 3b 的代价：服务器上没有 git 元数据，回退靠重新 scp 对应提交的包；
> 手工改过的文件先落 patch 再丢弃（实测那台机器上有一处 `node:20-slim→22-slim`，仓库版本已包含，无需合并）。
> 本清单后续命令里的工作目录，3a 是 `/opt/AnxinMed/app`，3b 是 `~/anxin/app`。

## 4. 服务器 `.env`（真实凭据只在这台机器上）

```bash
cd /opt/AnxinMed/app
cp deploy/.env.example .env
# 生成强口令并填进 POSTGRES_PASSWORD，再把各家模型 key 填进对应行
openssl rand -hex 24
vim .env          # QWEN_API_KEY / BAICHUAN_API_KEY / OCR_API_KEY …
chmod 600 .env
grep -c '=$' .env && echo '⚠️ 仍有空 key，真实 AI 链路会失败' || echo 'ok: key 已填'
```

口令规则：`POSTGRES_PASSWORD` 是唯一真相，compose 里 db 与 api 的连接串都插值自它（见 `docker-compose.yml`）。

## 5. 构建与起服务

```bash
cd /opt/AnxinMed/app
docker compose config --quiet && echo 'compose 语法 ok'   # 校验，不启动
docker compose build                                      # NPM_REGISTRY 已由 .env 指向 npmmirror
docker compose up -d
docker compose ps
docker compose logs --tail=50 api
```

期望：`anxin-db` healthy、`anxin-api` 监听 8787、`anxin-caddy` 起来（过渡期只占位，不承担流量）。

## 6. 数据初始化：pg_dump 全量恢复

> **本任务书原定的「优先重建」路线已不可执行**，原因记此备查（详见 §13）：`db:seed` 的数据源
> `demo/server/mock-data.json` 在本机已不存在（`demo/` 是嵌套独立仓库、不入本仓库跟踪），且生产 runtime 镜像
> 只有 `dist`、无 TS 源码与 drizzle-kit，服务器上跑不了 `db:migrate`/`db:seed`。
> 故走 05 任务书 T1 第 4 条的兜底路径：**本地整库 `pg_dump` → 恢复**（本机与服务器同为 PostgreSQL 18，同版本）。

**6.1 本机导出**（Windows Git Bash，在 `AnxinMed/` 下；连接串照 `app/packages/api/.env` 的 `DATABASE_URL` 原样填）：

```bash
mkdir -p app/backups
pg_dump "postgresql://anxin:<本地口令>@localhost:5432/anxin_medication" -Fc -f app/backups/anxin-local.dump
ls -lh app/backups/anxin-local.dump   # 应为百 KB～几 MB 量级
head -c 5 app/backups/anxin-local.dump; echo   # 必须是 PGDMP（custom 格式魔数）
```

**6.2 上传到服务器**：

```bash
scp app/backups/anxin-local.dump <user>@<ECS_IP>:/tmp/anxin-local.dump
```

**6.3 服务器上恢复**（⚠️ 会清空 `anxin_medication` 现有数据；首次部署无风险）：

```bash
cd /opt/AnxinMed/app
cp /tmp/anxin-local.dump /tmp/ 2>/dev/null || true
docker compose exec -T db psql -U anxin -d postgres -c \
  "drop database if exists anxin_medication with (force); create database anxin_medication owner anxin;"
docker compose exec -T db pg_restore -U anxin -d anxin_medication \
  --no-owner --clean --if-exists < /tmp/anxin-local.dump
```

**6.4 本机侧验证**（表数与关键行数应与本地一致）：

```bash
docker compose exec -T db psql -U anxin -d anxin_medication -c \
  "select (select count(*) from drug_master) as drugs, (select count(*) from package_inserts) as inserts, (select count(*) from interaction_rules) as rules, (select count(*) from users) as users;"
```

三库（drug_master / package_inserts / interaction_rules）行数必须 >0，否则云端 OCR 检测出的药匹配不到库、咨询也没依据。

**6.5 重启 api 让连接池认新库**：

```bash
docker compose restart api
```

## 7. 验收（05 任务书 T1 完成标准逐条）

| # | 验收项 | 命令 / 做法 | 期望 |
|---|---|---|---|
| 1 | 健康检查 | `curl -sS http://<ECS_IP>:8787/api/health` | `{"status":"ok"...}` 且 HTTP 200 |
| 2 | 医生端 | 手机/电脑浏览器打开 `http://<ECS_IP>:8787/insight` | 页面正常渲染 |
| 3 | 患者端 H5（冻结兜底） | `http://<ECS_IP>:8787/` | 药箱/录入页可用，接口不报跨域 |
| 4 | 真机可达 | 手机用 4G/5G（**不连家里 Wi-Fi**）打开上面的地址 | 公网可达，不只是 LAN |
| 5 | e2e fixtures 全绿 | 见 §8 | Playwright 全套 pass |
| 6 | 备份实测 | 见 §9，跑一次 `backup.sh` 并恢复一次 | 恢复后 §6.4 行数对得上 |

## 8. e2e（AI_MODE=fixtures）对火山部署跑一遍

远端跑法与本地不同处：e2e 的 globalSetup 要**直连数据库**建/删测试库，而 compose 的 5432 只绑回环——所以先开 SSH 隧道，把远端库映射到本机 5433：

```bash
# 本机（Windows Git Bash）
ssh -N -L 55432:127.0.0.1:5432 <user>@<ECS_IP> &
```

远端临时切 fixtures 回放模式（免真实 key、可复现）：

```bash
cd /opt/AnxinMed/app
sed -i 's/^AI_MODE=.*/AI_MODE=fixtures/' .env && docker compose up -d api
```

本机跑：

```bash
cd app/e2e
E2E_BASE_URL=http://<ECS_IP>:8787 \
E2E_DB_URL=postgresql://anxin:<POSTGRES_PASSWORD>@127.0.0.1:55432/anxin_medication \
E2E_ALLOW_REMOTE_DB=1 pnpm test:e2e
```

跑完**务必改回真实链路**：

```bash
cd /opt/AnxinMed/app && sed -i 's/^AI_MODE=fixtures/AI_MODE=/' .env && docker compose up -d api
```

> ⚠️ 结构性限制（如实记录，勿当「已过」）：对远端跑 e2e 时，测试写入的是服务器的 `anxin_medication` 正式库
> （远端 api 的连接串由 compose 固定），且 golden case 需要的 `p-001` / `dm-t9-hycosan` / `pi-e2e-hycosan`
> 三行必须由 e2e 侧经隧道预先建好。跑完建议用 §9 的备份恢复一次，把云端数据退回干净态。
> 真正干净的远端 E2E 需要独立 staging 实例（独立库 + 独立端口）——超出 T1 边界，未做。

## 9. 运维底线（三件，一次配好）

**9.1 `pg_dump` 每日 cron**

```bash
cd /opt/AnxinMed/app && chmod +x deploy/backup.sh
./deploy/backup.sh                       # 先手动跑一次，确认输出 [backup] OK
sudo crontab -l 2>/dev/null | { cat; echo "17 3 * * * cd /opt/AnxinMed/app && bash deploy/backup.sh >> /var/log/anxin-backup.log 2>&1"; } | sudo crontab -
sudo crontab -l | tail -2                # 确认写入
ls -lh /opt/AnxinMed/app/backups/        # dump 落盘处（.gitignore 已排除，勿提交）
```

恢复（回滚同一条）：

```bash
cd /opt/AnxinMed/app
docker compose exec -T db psql -U anxin -d postgres -c \
  "drop database if exists anxin_medication with (force); create database anxin_medication owner anxin;"
docker compose exec -T db pg_restore -U anxin -d anxin_medication --no-owner --clean --if-exists \
  < backups/anxin_medication-<时间戳>.dump
```

**实测要求（任务书「实测恢复一条数据」）**：把某个 dump 恢复到一个临时库，`select` 一条已知药品行核对，再 `drop` 掉临时库。

**9.2 云盘快照每日**：控制台 → ECS → 云盘 → 快照策略：每天 1 次、保留 7 天、关联系统盘，并在快照策略里**绑定到这台实例**（策略建了不绑等于没做）。

**9.3 可用性监控**：UptimeRobot（或等价）建 HTTP monitor 指向 `http://<ECS_IP>:8787/api/health`，间隔 ≤5 分钟，告警发到自己的邮箱/微信。

## 10. 备案下来后：切 HTTPS（一次做完，别留半截）

1. 域名备案主体信息与域名持有者**完全一致**（不一致是最常见的返工点）；A 记录解析到 `<ECS_IP>`；
2. `cd /opt/AnxinMed/app && cp deploy/Caddyfile.https.example deploy/Caddyfile`，把里面两处 `anxin.example.com` 换成真实域名，`docker compose up -d caddy`，`docker compose logs caddy` 看证书签发成功；
3. 本机 `app/packages/mobile/.env.local` / release 环境把 `EXPO_PUBLIC_API_URL` 改成 `https://<域名>`，重打 APK；
4. `app/packages/mobile/app.json` 的 `android.usesCleartextTraffic` 改 `false`（cleartext 收口）；
5. 安全组**关闭 8787 公网入站**（compose 里的映射保留，云侧不放行即可）；
6. 医生端 / H5 / 真机各点一遍，确认没有残留 `http://IP:8787` 的硬编码。

## 11. 回滚

| 场景 | 做法 |
|---|---|
| 新 build 起不来 | `docker compose build --build-arg NPM_REGISTRY=...` 失败先查 §2 加速器；实在不行 `git checkout <上一个可用提交>` 再 build |
| 数据恢复恢复坏了 | 用 §9.1 最近一次 dump 回到干净态；本地那份 `app/backups/anxin-local.dump` 是最后的原始态，别删 |
| 整机不可用 | 火山控制台用快照回滚云盘，或新建实例后重跑 §3–§6（代码与数据都在 dump/快照里） |

## 12. 提交纪律

`git status` 必须干净：`deploy/` 四件套与 compose 改动入库；**`.env`、`app/backups/*.dump` 不入库**（`.gitignore` 已覆盖 `.env` 与 `app/backups/`）。任何 key、连接串口令都不进文档/命令历史示例以外的地方。

## 13. 已知偏离与风险（交付说明要抄这一节）

0. **PG18 数据卷布局冲突（实测踩过）**：若 `pgdata` 卷里残留老布局数据（挂载点根目录直接有 `PG_VERSION`/`base/`），
   `postgres:18-alpine` 会拒绝启动并反复重启，错误签名：
   `Error: in 18+, these Docker images are configured to store database data in a format which is compatible with "pg_ctl/api" ... there appears to be PostgreSQL data in: /var/lib/postgresql`。
   症状是 `docker compose up -d` 报 `dependency failed to start: container anxin-db is unhealthy`，api/caddy 一起不来。
   处置：先把旧卷整份备份出来，确认备份非空后再删卷重建——
   ```bash
   mkdir -p ~/pgbackup
   docker run --rm -v app_pgdata:/d:ro -v ~/pgbackup:/backup alpine tar czf /backup/pgdata-old.tar.gz -C /d .
   ls -lh ~/pgbackup/            # 确认存在且非空，再往下
   cd ~/anxin/app && docker compose down && docker volume rm app_pgdata && docker compose up -d
   ```
   （删卷会丢云端库内数据，只在「云端数据可从本地 dump 重建」时做；恢复见 §6。）
1. **数据初始化路线偏离**：原定 `db:migrate` + `db:seed` 重建不可执行——`demo/server/mock-data.json` 已不在工作区，且 runtime 镜像无 TS 源码/drizzle-kit。改用整库 `pg_dump` 恢复（任务书允许的兜底路径，18→18 同版本）。**后续影响**：服务器上同样跑不了 `db:seed*` / `db:import-crawled` / 任何 `tsx src/db/*` 运维脚本；将来需要在云端跑这些时，要么在服务器装 node 工具链 + 源码 checkout（偏离「零代码改动」），要么加一个 `--profile ops` 的运维服务（属 T1 之后的决定）。
2. **远端 e2e 有结构性限制**：见 §8 的警示块——写正式库、需隧道、跑完建议回滚。独立 staging 实例不在 T1 边界内。
3. **改 `POSTGRES_PASSWORD` 不会自动同步到已有库**（compose 口令只在卷首次初始化时生效），跨环境复制时按 `deploy/.env.example` 里的注释用 `alter role` 改。
4. **过渡期裸 IP + cleartext**：无 HTTPS、无域名，`http://IP:8787` 明文传输，属真实模拟阶段的已知接受项（05 任务书 T1 第 5 条），备案后按 §10 收口。
