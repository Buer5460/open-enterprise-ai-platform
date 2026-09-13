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
DATA_ABS="$(cd "$DATA_DIR" && pwd -P)"
BACKUP_DIR_ABS="$(cd "$(dirname "$BACKUP")" && pwd -P)"
BACKUP_ABS="$BACKUP_DIR_ABS/$(basename "$BACKUP")"

if [ "$DATA_ABS" = "/" ]; then
  echo "❌ 拒绝将 OEAP_DATA_DIR 指向系统根目录。"
  exit 3
fi

checksum_file="$BACKUP_ABS.sha256"
if [ -f "$checksum_file" ]; then
  expected="$(awk 'NR==1 {print $1}' "$checksum_file")"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$BACKUP_ABS" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$BACKUP_ABS" | awk '{print $1}')"
  else
    echo "❌ 系统缺少 sha256sum/shasum，无法验证备份完整性。"
    exit 4
  fi

  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    echo "❌ 备份 SHA-256 校验失败，拒绝恢复。"
    exit 5
  fi
  echo "✅ 备份 SHA-256 校验通过"
else
  echo "⚠️ 未找到 $checksum_file；按旧版备份兼容模式继续，但建议仅恢复可信归档。"
fi

# Validate archive structure before touching current runtime state.
archive_list="$(mktemp "${TMPDIR:-/tmp}/oeap-restore-list.XXXXXX")"
archive_verbose="$(mktemp "${TMPDIR:-/tmp}/oeap-restore-verbose.XXXXXX")"
RESTORE_STAGE="${DATA_ABS}.restore-stage-$$"
cleanup() {
  rm -f "$archive_list" "$archive_verbose"
  rm -rf "$RESTORE_STAGE"
}
trap cleanup EXIT INT TERM

if ! LC_ALL=C tar -tzf "$BACKUP_ABS" > "$archive_list"; then
  echo "❌ 备份归档损坏或格式无效。"
  exit 6
fi

while IFS= read -r entry; do
  clean="${entry#./}"
  [ -z "$clean" ] && continue

  case "$clean" in
    /*|..|../*|*/..|*/../*)
      echo "❌ 备份包含不安全路径，拒绝恢复：$entry"
      exit 7
      ;;
  esac
done < "$archive_list"

if ! LC_ALL=C tar -tvzf "$BACKUP_ABS" > "$archive_verbose"; then
  echo "❌ 无法检查备份归档类型。"
  exit 8
fi

while IFS= read -r line; do
  [ -z "$line" ] && continue
  type="${line:0:1}"
  case "$type" in
    -|d) ;;
    *)
      echo "❌ 备份包含链接或特殊文件，拒绝恢复：$line"
      exit 9
      ;;
  esac
done < "$archive_verbose"

mkdir -p "$RESTORE_STAGE"
if ! tar -xzf "$BACKUP_ABS" -C "$RESTORE_STAGE"; then
  echo "❌ 备份解压到临时目录失败，现有数据未修改。"
  exit 10
fi

# Defense in depth: extracted staging tree must still contain only regular files/directories.
unsafe_stage="$(find "$RESTORE_STAGE" -mindepth 1 \( -type l -o -type b -o -type c -o -type p -o -type s \) -print -quit 2>/dev/null || true)"
if [ -n "$unsafe_stage" ]; then
  echo "❌ 临时恢复目录出现不安全文件，拒绝切换：$unsafe_stage"
  exit 11
fi

SAFETY_COPY="${DATA_ABS}.before-restore-$(date +%Y%m%d-%H%M%S)-$$"
if [ -n "$(find "$DATA_ABS" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
  cp -a "$DATA_ABS" "$SAFETY_COPY"
  echo "已创建恢复前安全副本：$SAFETY_COPY"
fi

find "$DATA_ABS" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a "$RESTORE_STAGE"/. "$DATA_ABS"/

echo "✅ OEAP 数据恢复完成"
echo "数据目录：$DATA_ABS"
if [ -d "$SAFETY_COPY" ]; then
  echo "恢复前副本：$SAFETY_COPY"
fi
