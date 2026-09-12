#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

run_if_present() {
  local file="$1"
  if [ -f "$file" ]; then
    echo "▶ $file"
    node "$file"
  fi
}

run_if_present scripts/test-action-gateway.mjs
run_if_present scripts/test-installable-skill.mjs
run_if_present scripts/test-growth-agent.mjs
run_if_present scripts/test-growth-workflow.mjs
run_if_present scripts/test-developer-studio.mjs
run_if_present scripts/test-tenancy.mjs
run_if_present scripts/test-auth-session.mjs
run_if_present scripts/test-invitations.mjs
run_if_present scripts/test-invitation-delivery.mjs
run_if_present scripts/test-mail-settings.mjs
run_if_present scripts/test-production-auth.mjs

echo "✅ deterministic OEAP test suite passed"
