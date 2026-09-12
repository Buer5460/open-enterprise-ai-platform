#!/bin/bash

ROOT="$HOME/Developer/OpenEnterpriseAI"
PLATFORM="$ROOT/open-enterprise-ai-platform"
HARNESS="$ROOT/deepseek-harness"

cd "$PLATFORM"
mkdir -p .tmp/logs

echo "正在启动 OEAP..."

# 停止旧的 API / Web
for PORT in 8787 5173; do
  PID=$(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null)
  if [ -n "$PID" ]; then
    kill $PID 2>/dev/null || true
    sleep 1
  fi
done

# Harness 3081 不存在时才启动
if ! lsof -iTCP:3081 -sTCP:LISTEN >/dev/null 2>&1; then
  cd "$HARNESS"

  nohup env DSH_HOME="$ROOT/.dsh-dev" \
    corepack pnpm dsh --profile web --port 3081 \
    </dev/null \
    > "$PLATFORM/.tmp/logs/harness.log" 2>&1 &

  sleep 3
fi

cd "$PLATFORM"

# 编译 API 及其所有 workspace 依赖，再编译 Web
# 这样 data-runtime 等底层包更新后不会继续使用旧的 dist。
corepack pnpm --filter @oeap/api... build >/dev/null 2>&1
API_BUILD_STATUS=$?

corepack pnpm --filter @oeap/web build >/dev/null 2>&1
WEB_BUILD_STATUS=$?

if [ "$API_BUILD_STATUS" -ne 0 ]; then
  echo "❌ API 或其依赖编译失败"
  corepack pnpm --filter @oeap/api... build
  exit 1
fi

if [ "$WEB_BUILD_STATUS" -ne 0 ]; then
  echo "❌ Web 编译失败"
  corepack pnpm --filter @oeap/web build
  exit 1
fi

# 启动 API
nohup node apps/api/dist/index.js \
  </dev/null \
  > .tmp/logs/api.log 2>&1 &

# 启动 Web 静态站
nohup python3 -m http.server 5173 \
  --bind 127.0.0.1 \
  --directory apps/web/dist \
  </dev/null \
  > .tmp/logs/web.log 2>&1 &

sleep 4

echo ""
echo "===== DeepSeek Harness ====="
if lsof -iTCP:3081 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✅ 3081 正常"
else
  echo "❌ Harness 启动失败"
fi

echo ""
echo "===== API ====="
curl -s http://127.0.0.1:8787/health || echo "❌ API 启动失败"

echo ""
echo ""
echo "===== Web ====="
WEB_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/)
if [ "$WEB_STATUS" = "200" ]; then
  echo "✅ Web 正常：HTTP 200"
else
  echo "❌ Web 启动失败：HTTP $WEB_STATUS"
fi

echo ""
echo "================================"
echo "✅ OEAP 本地环境启动完成"
echo "打开：http://127.0.0.1:5173/"
echo "================================"
