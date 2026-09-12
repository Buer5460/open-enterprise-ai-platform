#!/bin/bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "用法: ./scripts/restore-data.sh <backup.tar.gz>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${OEAP_DATA_DIR:-$PLATFORM/.tmp}"
BACKUP="$1"
API_PORT="${OEAP_API_PORT:-8787}"

if [ ! -f "$BACKUP" ]; then
  echo "❌ 找不到备份文件：$BACKUP"
  exit 1
fi

if curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1; then
  echo "❌ API 仍在运行。请先停止 API 后再恢复数据。"
  exit 2
fi

mkdir -p "$DATA_DIR"

SAFETY_COPY="${DATA_DIR}.before-restore-$(date +%Y%m%d-%H%M%S)"
if [ -n "$(find "$DATA_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
  cp -a "$DATA_DIR" "$SAFETY_COPY"
  echo "已创建恢复前安全副本：$SAFETY_COPY"
fi

find "$DATA_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
tar -xzf "$BACKUP" -C "$DATA_DIR"

echo "✅ OEAP 数据恢复完成"
echo "数据目录：$DATA_DIR"
