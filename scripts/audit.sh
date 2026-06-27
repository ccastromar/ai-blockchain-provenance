#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-prod}"
AUDIT_LEVEL="${AUDIT_LEVEL:-high}"

# The Next.js frontend is deprecated in favor of frontend-svelte and is not part
# of the official production runtime. Keep full visibility in audit:all, but do
# not block the production gate on legacy Next.js advisories.
LEGACY_NEXT_ADVISORIES=(
  GHSA-h25m-26qc-wcjf
  GHSA-q4gf-8mx6-v5v3
  GHSA-8h8q-6873-q5fj
  GHSA-c4j6-fc7j-m34r
  GHSA-36qx-fr4f-26g5
)

legacy_next_ignore_args=()
for advisory in "${LEGACY_NEXT_ADVISORIES[@]}"; do
  legacy_next_ignore_args+=(--ignore "${advisory}")
done

case "${MODE}" in
  prod)
    echo "Running production dependency audit at ${AUDIT_LEVEL} severity or higher..."
    pnpm audit --prod --audit-level "${AUDIT_LEVEL}" "${legacy_next_ignore_args[@]}"
    ;;
  all)
    echo "Running full dependency audit, including dev dependencies, at ${AUDIT_LEVEL} severity or higher..."
    pnpm audit --audit-level "${AUDIT_LEVEL}"
    ;;
  *)
    echo "Usage: $0 [prod|all]" >&2
    exit 2
    ;;
esac
