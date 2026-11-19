# M5-T1 · 火山引擎 ECS 部署清单

> 真相源：[../../docs/specs/05-M5-安卓迁移与服务端上云.md](../../docs/specs/05-M5-安卓迁移与服务端上云.md) §T1 与 [05a-M5-T1-火山上云执行书.md](../../docs/specs/05a-M5-T1-火山上云执行书.md)。
> 本文件是【用户操作】照做清单：命令可直接复制，**但每台机器的差异处（IP、路径、口令）已用 `<...>` 标出**。
> 边界：不改任何业务代码；`app/` 目录下只有本 `deploy/` 与 `docker-compose.yml` 属本任务。

## 0. 前提与约定

| 项 | 值 |
|---|---|
| 服务器 | 火山引擎 ECS **4C8G**（任务书基线 2C4G，当前配置有余量） |
| 系统 | Ubuntu 22.04 / 24.04 LTS，Docker + compose plugin 已装 |
| 部署路径 | 仓库根 `/opt/AnxinMed`（3a）或 `~/anxin`（3b）——**staging 实际在 `/root/anxin/app`**。别照抄路径：以 `docker inspect anxin-api` 里 `com.docker.compose.project.working_dir` 标签为准（2026-11-20 照抄 `/opt/AnxinMed/app` 直接 `No such file or directory`） |
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

**6.6 登录迁移与账号开通（G7 · 账号密码登录，新增于 2026-11-17）**

> runtime 镜像没有 drizzle-kit，迁移只能从本机经 SSH 隧道对部署库执行；账号开通用镜像内 CLI。
> 顺序必须是：先应用迁移（0012）→ 再起/重启新镜像（compose 默认 `AUTH_MODE=password`，fail-closed）→ 再开账号。

```bash
# 本机开隧道（另开一个终端，保持不关）
ssh -N -L 55432:127.0.0.1:5432 <user>@<ECS_IP>

# 本机 app/ 下：对远端库应用迁移（口令用 deploy/.env 里的 POSTGRES_PASSWORD）
DATABASE_URL=postgresql://anxin:<POSTGRES_PASSWORD>@127.0.0.1:55432/anxin_medication \
  pnpm --filter @anxin/api db:migrate

# 服务器 app/ 下：部署新镜像后开通演示账号（每个账号执行一次；--id 指向已有 seed 用户）
docker compose exec api node packages/api/dist/scripts/auth-create-user.js \
  --username p-001 --id p-001 --name 张某某
# stdout 里的一次性初始密码立即记录（不落库明文）；重置：
docker compose exec api node packages/api/dist/scripts/auth-reset-password.js --username p-001
```

验收（应看到 401 → 换 token 后 200）：

```bash
curl -sS -o /dev/null -w '未登录 /api/drugs = %{http_code}\n' http://<ECS_IP>:8787/api/drugs
curl -sS -X POST http://<ECS_IP>:8787/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"p-001","password":"<初始密码>"}'
# 响应里 token 拿来再请求：
curl -sS -H 'authorization: Bearer <token>' -o /dev/null -w '已登录 /api/drugs = %{http_code}\n' http://<ECS_IP>:8787/api/drugs
```

> 账号清单建议与演示用户一一对应（p-001 起），初始密码随机生成、一次性交付给演示人；
> 忘记密码只能管理员 CLI 重置（G7 不做自助找回）。

**6.6 实跑记录（2026-11-17/18，`iv-yeha6zo9a8qbxyrwefzp`）**：迁移 0012 经隧道应用成功 → `docker compose build` 17m 后 `up -d` 成功 → 15 个账号（`p-001`…`p-107`）批量开通 → 公网验证：未登录 `/api/drugs` 401、p-001 登录 200、p-002 数据隔离、退出后旧 token 401。真机（PJZ110 / Android 15）登录/退出/重启保持/断网重试均通过，详见 [G7-真机验收.md](../../packages/mobile/G7-真机验收.md)。

**6.7 手机号验证码登录/注册（P1 · 阿里云短息认证，2026-11-18）**

> 与 G7 账号密码并行：老账号继续用密码登录；手机号走「验证码即注册」（首次验码通过自动建号）。
> 短信通道由阿里云「号码认证服务 → 短信认证」提供（个人实名可用、赠送签名/模板、验证码托管核验）。

部署顺序：**迁移 0013 → 服务器 .env 填 `DYPNS_*` → 重启 api → 验收发码/登录**。

```bash
# 1) 本机开隧道后应用迁移（0013：users.phone 唯一索引 + phone_verified_at）
DATABASE_URL=postgresql://anxin:<POSTGRES_PASSWORD>@127.0.0.1:55432/anxin_medication \
  pnpm --filter @anxin/api db:migrate

# 2) 服务器 app/.env 追加（值来自阿里云控制台；AccessKey 建议 RAM 子账号只授两个 dypns Action）
#    DYPNS_ACCESS_KEY_ID=...
#    DYPNS_ACCESS_KEY_SECRET=...
#    DYPNS_SIGN_NAME=恒创联众        # 控制台「赠送签名配置」里的名称
#    DYPNS_TEMPLATE_LOGIN=100001     # 登录/注册模板
#    SMS_IP_PER_HOUR=10              # 可选

# 3) 重启 api 让 env 生效
docker compose up -d api

# 4) 先做免费连通性核验（不发短信、核验免费；验证码错误也证明 AK/签名/权限/开通正常）
docker compose exec api node packages/api/dist/scripts/sms-smoke.js
#    无参运行会打印当前签名/模板配置；验通另跑（免费）：
docker compose exec api node packages/api/dist/scripts/sms-smoke.js --check 13800138000 --code 000000
#    本机（app/ 下，读本地 .env）等价命令：
pnpm --filter @anxin/api sms:smoke -- --check 13800138000 --code 000000
```

验收（公网，无需登录）：

```bash
# 发码（会产生一条真实短信，约 0.06 元；测试手机号先用控制台「快速测试」绑定过）
curl -sS -X POST http://<ECS_IP>:8787/api/auth/phone/send-code \
  -H 'content-type: application/json' -d '{"phone":"151xxxxxxxx"}'
# 期望：{"ok":true,"mode":"password","cooldownSec":60,"expiresInSec":300,"signName":"..."}

# 验证码登录 → 拿 token；首次登录返回 "created":true（自动建号）
curl -sS -X POST http://<ECS_IP>:8787/api/auth/phone/login \
  -H 'content-type: application/json' -d '{"phone":"151xxxxxxxx","code":"<收到的6位码>"}'
# 期望：{"ok":true,"mode":"password","token":"...","user":{...},"created":true}

# 用 token 访问业务路由应为 200
curl -sS -H 'authorization: Bearer <token>' -o /dev/null -w '%{http_code}\n' http://<ECS_IP>:8787/api/drugs

# 忘记密码（100003 重置密码模板）：发重置码——未注册号也返回 ok 但不会真发（防枚举）
curl -sS -X POST http://<ECS_IP>:8787/api/auth/password/reset-code \
  -H 'content-type: application/json' -d '{"phone":"151xxxxxxxx"}'

# 重置并登录（成功后清该账号全部旧会话，旧 token 再访问应 401）
curl -sS -X POST http://<ECS_IP>:8787/api/auth/password/reset \
  -H 'content-type: application/json' \
  -d '{"phone":"151xxxxxxxx","code":"<收到的6位码>","password":"Test-pass-123"}'
# 期望：{"ok":true,...,"token":"..."}；之后用「手机号 + 新密码」走 /api/auth/login 应 200

# 登录态改密（清其他设备会话、保留当前这台；已有密码必须带 oldPassword）
curl -sS -X POST http://<ECS_IP>:8787/api/auth/password \
  -H "authorization: Bearer <token>" -H 'content-type: application/json' \
  -d '{"oldPassword":"<旧密码>","password":"New-pass-456"}'
```

> 找回密码模板默认用赠送的 `100003`（`DYPNS_TEMPLATE_RESET` 可覆盖，一般不需要配）。

已知边界：同号 60 秒冷却、同 IP 每小时 10 次（单实例内存限流，多副本前需换共享存储）；限流状态进程重启清零；
短息认证目前只支持中国大陆手机号；自定义签名/通知类短信需升级企业资质 + 通用短信服务（见
[specs/17](../../docs/specs/17-手机号验证码注册登录.md)）。

## 7. 验收（05 任务书 T1 完成标准逐条）

| # | 验收项 | 命令 / 做法 | 期望 |
|---|---|---|---|
| 1 | 健康检查 | `curl -sS http://<ECS_IP>:8787/api/health` | `{"status":"ok"...}` 且 HTTP 200 |
| 2 | 医生端 | 手机/电脑浏览器打开 `http://<ECS_IP>:8787/insight` | 页面正常渲染 |
| 3 | 患者端 H5（冻结兜底） | `http://<ECS_IP>:8787/` | 药箱/录入页可用，接口不报跨域 |
| 4 | 真机可达 | 手机用 4G/5G（**不连家里 Wi-Fi**）打开上面的地址 | 公网可达，不只是 LAN |
| 5 | e2e fixtures 全绿 | 见 §8 | Playwright 全套 pass |
| 6 | 备份实测 | 见 §9，跑一次 `backup.sh` 并恢复一次 | 恢复后 §6.4 行数对得上 |
| 7 | 登录已生效（G7） | 见 §6.6 的 curl 三连 | 未登录 401 / 登录后 200 / 前端出现登录页 |
| 8 | 登录审计可见性 | `docker compose logs --tail=20 api` | 401/登录请求有访问日志；无明文密码输出 |
| 9 | 手机号验证码登录（P1） | 见 §6.7 的发码/登录 curl | `ok:true` + 收到短信（落款=赠送签名）/ 首登 `created:true` / token 访问业务路由 200 |
| 10 | 忘记密码 + 改密清会话（P1） | 见 §6.7 的 reset-code / reset / password curl | 未注册号也 ok 但不真发；已注册号收 100003 码；重置后旧 token 401、新 token 200；改密后其他设备 401、当前 200 |

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

## 9. 运维底线（四件，一次配好）

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

**9.4 可观测性与成本（G10，2026-11-18）**

> 最小可观测性：错误日志落盘 + 模型调用计数 + 日预算告警 + 限流；不引入第三方依赖。
> 配置项在 `.env`（`deploy/.env.example` 的「可观测性」段），代码默认值与之相同。

**9.4.1 日志与指标落盘（位置 / 轮转 / tail）**

| 文件 | 内容 | 轮转与保留 |
|---|---|---|
| `/app/logs/api-errors-YYYY-MM-DD.jsonl` | 5xx/未处理错误（requestId/错误码/状态/方法/path/错误名/消息/栈），**无请求体、用户问题、模型输出、PII** | 单文件 10MB → 改名 `.1` 再写新文件；保留 14 天（首次写与每日清理） |
| `/app/logs/metrics-YYYY-MM-DD.json` | 当日各模型 client 的 attempts/success/failure/retries/latency、usage tokens、预算告警已触发档位 | 每次更新原子写（临时文件+rename）；不自动清理（单日文件很小，可人工按需保留/归档）；容器重启后 load 当日文件恢复累计 |

容器内目录固定 `/app/logs`，compose 已把宿主机 `app/logs/` 挂载进去（目录不存在 Docker 自动创建；根 `.gitignore` 已排除 `logs/`）。本地开发不配 `LOG_DIR` 时默认 `./logs`（从 `app/packages/api` 启动即 `app/packages/api/logs`）。

```bash
cd /opt/AnxinMed/app
ls -lh logs/
# 实时看错误（按日文件；跨天用通配符）
tail -f logs/api-errors-$(date +%F).jsonl
# 容器内看/宿主机看等价（挂载同一目录）
docker compose exec api tail -n 50 /app/logs/api-errors-$(date +%F).jsonl
# 当日指标（排查模型调用/成本口径）
cat logs/metrics-$(date +%F).json | jq .
```

**9.4.2 观测快照接口**（`OBS_ADMIN_TOKEN` 必须已在 `.env` 配置并重启 api；未配置时端点返回 404，token 错返回 401）：

```bash
# .env 里 OBS_ADMIN_TOKEN 的值；生成：openssl rand -hex 24
curl -sS -H "x-obs-token: $OBS_ADMIN_TOKEN" http://<ECS_IP>:8787/api/observability/summary | jq .data
```

返回 `data`：`date` / `modelCalls.byClient`（attempts/success/failure/retries/avgLatencyMs + tokens{prompt,completion,cached,total}）与 `totals` / `estimatedCostCny` / `budget{limitCny,spentCny,percent,status}` / `rateLimited` / `errors` / `uptimeSec` / `version`。**无 PII**，可安全发给运维/账务对账。若 404：确认 `.env` 有 `OBS_ADMIN_TOKEN` 且执行过 `docker compose up -d api`（env 变更需重建/重启容器）。

**9.4.3 日预算告警（80% / 100%）**

- 成本口径：`未缓存输入 tokens×输入价 + 缓存命中 tokens×缓存价 + 输出 tokens×输出价`（默认 ¥0.8 / ¥2.7 / ¥0.1 每百万 tokens，价目见 docs/11 §2.2），价目可用 `LLM_PRICE_*_CNY_PER_M` 覆盖；**是估算，以控制台账单为准**。
- 日预算 `LLM_DAILY_BUDGET_CNY`（默认 20 元）。当日估算成本达到 **80%** 输出一行 `console.warn [obs:budget] {"level":"warn","spent":...,"limit":...,"percent":...}`；达到 **100%** 再输出 `"level":"over"`。每档每天只告警一次；告警状态随 `metrics-*.json` 持久化，容器重启不重复告警、预算累计不清零。
- 当前实现是**告警不熔断**（不会因为超预算拒绝请求）；要止血按 9.4.4 收紧限流或临时下调 `RL_LLM_PER_MIN/DAY`，或更换 key/停止流量。
- 查看告警：`docker compose logs --tail=200 api | grep '\[obs:budget\]'`；核对当日花费：9.4.2 的 `budget.spentCny`。

**9.4.4 限流调参与 429 表现**

| 配置 | 默认 | 作用域 |
|---|---|---|
| `RL_LLM_PER_MIN` | 10 | LLM 路由按 **userId**，每分钟滑动窗口 |
| `RL_LLM_PER_DAY` | 200 | LLM 路由按 **userId**，24h 滚动窗口 |
| `RL_IP_PER_MIN` | 240 | 所有 `/api/*` 按来源 IP 兜底；`/api/health` 豁免（监控探针恒可达） |

LLM 路由集合：`POST /api/consult`、`/api/intake/{prescription,drug,detect}`、`/api/insight/{summary,queue-summary,ask}`。超限统一返回：

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60

{"ok":false,"code":"RATE_LIMITED","message":"操作太频繁，请稍后再试"}
```

客户端应按 `Retry-After` 退避重试（H5/App 已按统一错误码提示，不要静默重试）。调参后 `docker compose up -d api` 生效（env 需重建容器；限流计数在进程内存，重建/重启清零）。

> 边界：限流是**单实例内存**实现（与 G7 登录失败限流同构）；多副本部署前需换 Redis 等共享存储。测试环境（`NODE_ENV=test`）默认关闭限流以免误伤回归，`RL_FORCE=1` 可强制开启。IP 取 `x-forwarded-for` 首段（反向代理后为标准做法；过渡期裸 IP 直连时该头客户端可伪造，故 IP 档只作兜底，不承担鉴权）。

**9.4.5 staging 重启后累计验证**（每次部署/重启后做一次）

```bash
cd /opt/AnxinMed/app
# 1) 重启前取一次快照，记下 modelCalls.byClient.*.attempts / budget.spentCny
curl -sS -H "x-obs-token: $OBS_ADMIN_TOKEN" http://127.0.0.1:8787/api/observability/summary | jq '.data | {date, attempts: .modelCalls.totals.attempts, spent: .budget.spentCny, alerts: .budget.status}'
# 2) 重启 api（当日指标从 metrics-*.json 恢复）
docker compose restart api && sleep 3
# 3) 再取一次：attempts/spent 应 >= 重启前（不清零），budget.status 不因重启重复触发告警
curl -sS -H "x-obs-token: $OBS_ADMIN_TOKEN" http://127.0.0.1:8787/api/observability/summary | jq '.data | {date, attempts: .modelCalls.totals.attempts, spent: .budget.spentCny, alerts: .budget.status}'
# 4) 确认落盘文件存在且可读
ls -lh logs/metrics-$(date +%F).json logs/api-errors-$(date +%F).jsonl 2>/dev/null || true
```

期望：两次 `attempts` 单调不减（重启后继续累计）；`budget.status` 与 `spentCny` 保持；`logs/` 下文件在容器重启后仍在（宿主机挂载）。若重启后 attempts 归零：检查 compose 是否带 `LOG_DIR=/app/logs` 与 `./logs:/app/logs` 挂载（本仓库 2026-11-18 起已加）。

## 10. 备案下来后：切 HTTPS（一次做完，别留半截）

> 状态（2026-11-18）：**未执行**——域名/ICP 备案是外部依赖。G7 起登录密码/token 在 `http://IP:8787` 明文传输，**接真实用户前必须完成本节**。Caddy 配置已备好（`deploy/Caddyfile.https.example`），切完按 §10.5 验收并回填 [docs/specs/14](../../docs/specs/14-G8-正式签名与分发.md) §8。

### 10.1 前置（外部依赖，缺一不可）

1. 域名已备案且**备案主体与域名持有者完全一致**（不一致是最常见返工点）；
2. 域名 A 记录解析到 `<ECS_IP>`，等待生效：`nslookup <域名>` / `dig +short <域名>`；
3. 安全组放行 80/443（80 用于 ACME HTTP-01 校验），8787 暂时保留（切换完成后再关）；
4. 域名可被公网访问（大陆 IP 未备案域名的 80/443 会被云厂商拦截——先备案再切）。

### 10.2 服务端切换（Caddy 自动申请并续期证书）

```bash
cd /opt/AnxinMed/app
cp deploy/Caddyfile.https.example deploy/Caddyfile
# 把 Caddyfile 里两处 anxin.example.com 换成真实域名（含 www 跳转段）
docker compose up -d caddy
docker compose logs --tail=50 caddy     # 看到 certificate obtained / serving HTTPS 即成功
```

Caddy 默认用 Let's Encrypt 自动签发+续期（HTTP-01 / TLS-ALPN）；证书到期前自动续，无需 cron。首次失败先查 DNS 与 80/443 放行（`.well-known/acme-challenge` 必须公网可达）。

### 10.3 客户端切换（重打 APK）

1. `app/packages/mobile/.env.production.local` 的 `EXPO_PUBLIC_API_URL` 改为 `https://<域名>`（dev 联调改 `.env.local`）；
2. `app/packages/mobile/app.json`：`android.usesCleartextTraffic` 改 `false`（明文收口；改后需 prebuild 才生效）；
3. 重打正式包：`cd app && pnpm --filter @anxin/mobile android:release`（自动验签 + 归档，见 [SIGNING.md](../../packages/mobile/SIGNING.md)）；
4. 真机回归：登录/退出/断网中文提示/主链路各点一遍，确认 APK 内没有残留 `http://<IP>:8787`。

### 10.4 收口

- 安全组**关闭 8787 公网入站**（compose 的 `8787:8787` 映射保留，供本机/隧道运维；云侧不放行即可）；
- 更新试点账号交付说明里的服务地址（docs/specs/14 §5）；
- 记录切换日期与证书到期策略到 docs/specs/14 §8。

### 10.5 验收（逐条打勾，证据留档）

```bash
# 1. 证书链与主机名
curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://<域名>/api/health
openssl s_client -connect <域名>:443 -servername <域名> </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates
# 2. 未登录仍 401（鉴权未被 Caddy 破坏）
curl -sS -o /dev/null -w '%{http_code}\n' https://<域名>/api/drugs
# 3. 明文入口不再对公网开放（从公网机器执行，应超时/拒绝）
curl -m 5 -sS http://<ECS_IP>:8787/api/health || echo "8787 已关闭（预期）"
# 4. 客户端：APK 内只应命中 https 域名，无 http://IP:8787
unzip -p dist/release/<APK> assets/index.android.bundle | grep -c "http://<ECS_IP>:8787"   # 预期 0（Hermes 包内中文串按 UTF-16LE，URL 为 ASCII 可直接 grep）
```

| # | 验收项 | 证据 |
|---|---|---|
| 1 | `https://<域名>/api/health` 200 且证书校验通过（`ssl_verify_result=0`） | ____ |
| 2 | 未登录 `/api/drugs` 401（AUTH_REQUIRED/AUTH_INVALID） | ____ |
| 3 | 公网 8787 已关闭（超时/拒绝） | ____ |
| 4 | 新 APK 登录/退出/断网中文提示 真机通过 | ____ |
| 5 | 旧 http APK 停用（通知试点用户重装/升级） | ____ |

### 10.6 应急回滚

- 服务端：把 `deploy/Caddyfile` 换回占位版（`deploy/Caddyfile`）→ `docker compose restart caddy`，同时安全组重新放行 8787；
- 客户端：切回 `http://<ECS_IP>:8787` 对应的上一版 APK（**必须仍用同一正式 keystore 签名，否则无法覆盖安装**）。


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
5. **G7 账号密码登录是过渡实现（2026-11-17）**：
   - 明文 HTTP 下登录密码在公网裸传——只给演示账号 + 纯演示数据用，**接真实用户前必须 §10 HTTPS**；
   - 无自助注册/改密/找回：账号由 CLI 开通，忘记密码走 `auth-reset-password.js`；
   - 登录失败限流是**单实例内存**（5 次/15 分钟，按 IP+账号）：多副本部署前要换共享存储；
   - session 固定 7 天过期，登出即删行；token 明文只在登录响应出现一次，DB 只存 SHA-256；
   - 与 ADR #11（Better Auth + 手机号验证码）的偏差已记入 [docs/specs/13](../../docs/specs/13-G7-最小账号密码登录.md)，换 Better Auth 时只替换 `resolveUser` 函数体。
