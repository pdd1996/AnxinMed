#!/usr/bin/env bash
# 安心用药 · 每日 pg_dump 备份（M5-T1 运维底线）
#
# 服务器上 cron 调用（每天 03:17）：
#   17 3 * * * cd /opt/AnxinMed/app && bash deploy/backup.sh >> /var/log/anxin-backup.log 2>&1
#
# 口径：走 db 容器内的本地套接字（postgres 镜像对 container 内 local 连接是 trust），
#      所以脚本不需要读口令，也不会有凭据落进 cron 环境变量。
# 恢复：见 deploy/README.md §备份与恢复（同一条命令换 pg_restore）。
# 注意：备份目录在 app/backups/，已在 .gitignore 内——不要把 dump 文件放进仓库或工作区可提交位置。

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$APP_DIR/backups}"
KEEP="${KEEP:-14}"
DB_CONTAINER="${DB_CONTAINER:-anxin-db}"
DB_USER="${POSTGRES_USER:-anxin}"
DB_NAME="${POSTGRES_DB:-anxin_medication}"
TS="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/$DB_NAME-$TS.dump"

mkdir -p "$OUT_DIR"

if ! docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null | grep -q true; then
  echo "[backup] FAIL: 容器 $DB_CONTAINER 未运行" >&2
  exit 1
fi

docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom > "$FILE"

# 自检：custom 格式魔数 + 体积下限（宿主机不假设有 pg_restore；禁静默吞错）
MAGIC="$(head -c 5 "$FILE")"
SIZE="$(wc -c < "$FILE")"
if [ "$MAGIC" != "PGDMP" ] || [ "$SIZE" -lt 1024 ]; then
  echo "[backup] FAIL: $FILE 头=$MAGIC 体积=${SIZE}B，疑似空/坏 dump" >&2
  exit 1
fi

# 轮转：只保留最近 KEEP 份
ls -1t "$OUT_DIR"/*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "[backup] OK $FILE (${SIZE}B, 保留最近 $KEEP 份)"
