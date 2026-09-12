#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${OEAP_DATA_DIR:-$PLATFORM/.tmp}"
BACKUP_DIR="${OEAP_BACKUP_DIR:-$PLATFORM/backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="${1:-$BACKUP_DIR/oeap-data-$TIMESTAMP.tar.gz}"
API_PORT="${OEAP_API_PORT:-8787}"

if [ ! -d "$DATA_DIR" ]; then
  echo "❌ 数据目录不存在：$DATA_DIR"
  exit 1
fi

if curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1; then
  echo "❌ API 仍在运行。为避免 SQLite 备份不一致，请先停止 API 后再备份。"
  echo "   Docker: docker compose stop api"
  echo "   本机:   停止 start-local.sh 启动的 API 进程"
  exit 2
fi

mkdir -p "$(dirname "$TARGET")"

tar \
  --exclude="logs" \
  --exclude="*.log" \
  -czf "$TARGET" \
  -C "$DATA_DIR" .

chmod 600 "$TARGET" 2>/dev/null || true

echo "✅ OEAP 数据备份完成"
echo "$TARGET"
