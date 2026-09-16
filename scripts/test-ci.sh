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

run_if_present scripts/test-release-version.mjs
run_if_present scripts/test-repository-hygiene.mjs
run_if_present scripts/test-production-preflight.mjs
run_if_present scripts/test-universal-action-spec.mjs
run_if_present scripts/test-action-hub-store.mjs
run_if_present scripts/test-action-gateway.mjs
run_if_present scripts/test-installable-skill.mjs
run_if_present scripts/test-growth-agent.mjs
run_if_present scripts/test-growth-workflow.mjs
run_if_present scripts/test-official-business-agents.mjs
run_if_present scripts/test-official-package-activator.mjs
run_if_present scripts/test-agent-context-enrichment.mjs
run_if_present scripts/test-package-compatibility.mjs
run_if_present scripts/test-marketplace-registry-protocol.mjs
run_if_present scripts/test-marketplace-foundation.mjs
run_if_present scripts/test-marketplace-commerce.mjs
run_if_present scripts/test-marketplace-publishing-store.mjs
run_if_present scripts/test-semver-range.mjs
run_if_present scripts/test-sdk-contract.mjs
run_if_present scripts/test-runtime-storage-path.mjs
run_if_present scripts/test-developer-studio.mjs
run_if_present scripts/test-tenancy.mjs
run_if_present scripts/test-auth-session.mjs
run_if_present scripts/test-invitations.mjs
run_if_present scripts/test-invitation-delivery.mjs
run_if_present scripts/test-mail-settings.mjs
run_if_present scripts/test-production-security.mjs
run_if_present scripts/test-enterprise-core.mjs
run_if_present scripts/test-package-supply-chain.mjs
run_if_present scripts/test-multitenant-isolation.mjs
run_if_present scripts/test-backup-restore.mjs
run_if_present scripts/test-openai-compatible-connector.mjs
run_if_present scripts/test-marketplace-api.mjs
run_if_present scripts/test-marketplace-publishing-api.mjs
run_if_present scripts/test-api-e2e.mjs
run_if_present scripts/test-ai-runtime-api.mjs
run_if_present scripts/test-app-lifecycle.mjs

echo "✅ deterministic OEAP test suite passed"
