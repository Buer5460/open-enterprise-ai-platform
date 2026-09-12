#!/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM="$(cd "$SCRIPT_DIR/.." && pwd)"
OPEN_ENTERPRISE_ROOT="${OEAP_OPEN_ENTERPRISE_ROOT:-$(dirname "$PLATFORM")}" 
HARNESS="${OEAP_HARNESS_ROOT:-$OPEN_ENTERPRISE_ROOT/deepseek-harness}"
DSH_HOME="${OEAP_DSH_HOME:-$OPEN_ENTERPRISE_ROOT/.dsh-dev}"

cd "$PLATFORM"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

API_PORT="${OEAP_API_PORT:-8787}"
WEB_PORT="${OEAP_WEB_PORT:-5173}"
mkdir -p .tmp/logs

echo "正在启动 OEAP..."

stop_port() {
  local port="$1"
  local pid
  pid=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pid" ]; then
    kill $pid 2>/dev/null || true
    sleep 1
  fi
}

stop_port "$API_PORT"
stop_port "$WEB_PORT"

if [ -d "$HARNESS" ]; then
  if ! lsof -iTCP:3081 -sTCP:LISTEN >/dev/null 2>&1; then
    cd "$HARNESS"
    nohup env DSH_HOME="$DSH_HOME" \
      corepack pnpm dsh --profile web --port 3081 \
      </dev/null \
      > "$PLATFORM/.tmp/logs/harness.log" 2>&1 &
    sleep 3
  fi
else
  echo "⚠️ 未找到 DeepSeek Harness：$HARNESS"
  echo "   非 AI 功能仍可启动；AI 创建/修改应用需要配置 OEAP_HARNESS_ROOT。"
fi

cd "$PLATFORM"

corepack pnpm -r build >/dev/null 2>&1
BUILD_STATUS=$?

if [ "$BUILD_STATUS" -ne 0 ]; then
  echo "❌ OEAP workspace 编译失败"
  corepack pnpm -r build
  exit 1
fi

nohup env \
  OEAP_API_PORT="$API_PORT" \
  node apps/api/dist/index.js \
  </dev/null \
  > .tmp/logs/api.log 2>&1 &

nohup python3 -m http.server "$WEB_PORT" \
  --bind 127.0.0.1 \
  --directory apps/web/dist \
  </dev/null \
  > .tmp/logs/web.log 2>&1 &

sleep 4

echo ""
echo "===== DeepSeek Harness ====="
if lsof -iTCP:3081 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✅ 3081 正常"
elif [ -d "$HARNESS" ]; then
  echo "❌ Harness 启动失败（查看 .tmp/logs/harness.log）"
else
  echo "⚠️ 未配置（AI 功能暂不可用）"
fi

echo ""
echo "===== API ====="
if curl -fsS "http://127.0.0.1:$API_PORT/health"; then
  echo ""
else
  echo "❌ API 启动失败（查看 .tmp/logs/api.log）"
fi

echo ""
echo "===== Web ====="
WEB_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$WEB_PORT/")
if [ "$WEB_STATUS" = "200" ]; then
  echo "✅ Web 正常：HTTP 200"
else
  echo "❌ Web 启动失败：HTTP $WEB_STATUS"
fi

echo ""
echo "================================"
echo "✅ OEAP 本地环境启动完成"
echo "打开：http://127.0.0.1:$WEB_PORT/"
echo "日志：$PLATFORM/.tmp/logs/"
echo "================================"
