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

DATA_ABS="$(cd "$DATA_DIR" && pwd -P)"
if [ "$DATA_ABS" = "/" ]; then
  echo "❌ 拒绝将 OEAP_DATA_DIR 指向系统根目录。"
  exit 3
fi

mkdir -p "$(dirname "$TARGET")"
TARGET_DIR_ABS="$(cd "$(dirname "$TARGET")" && pwd -P)"
TARGET_ABS="$TARGET_DIR_ABS/$(basename "$TARGET")"

case "$TARGET_ABS" in
  "$DATA_ABS"|"$DATA_ABS"/*)
    echo "❌ 备份文件不能写入 OEAP_DATA_DIR 内部，否则归档可能包含自身。"
    exit 4
    ;;
esac

UNSAFE_ENTRY="$(find "$DATA_ABS" -mindepth 1 \( -type l -o -type b -o -type c -o -type p -o -type s \) -print -quit 2>/dev/null || true)"
if [ -n "$UNSAFE_ENTRY" ]; then
  echo "❌ 数据目录包含不允许进入备份的链接或特殊文件：$UNSAFE_ENTRY"
  echo "   OEAP 运行数据备份只允许普通文件和目录。"
  exit 5
fi

tar \
  --exclude="logs" \
  --exclude="*.log" \
  -czf "$TARGET_ABS" \
  -C "$DATA_ABS" .

chmod 600 "$TARGET_ABS" 2>/dev/null || true

checksum_file="$TARGET_ABS.sha256"
if command -v sha256sum >/dev/null 2>&1; then
  checksum="$(sha256sum "$TARGET_ABS" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  checksum="$(shasum -a 256 "$TARGET_ABS" | awk '{print $1}')"
else
  echo "❌ 系统缺少 sha256sum/shasum，无法生成备份完整性校验。"
  rm -f "$TARGET_ABS"
  exit 6
fi

printf '%s  %s\n' "$checksum" "$(basename "$TARGET_ABS")" > "$checksum_file"
chmod 600 "$checksum_file" 2>/dev/null || true

echo "✅ OEAP 数据备份完成"
echo "归档：$TARGET_ABS"
echo "校验：$checksum_file"
