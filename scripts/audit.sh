#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-prod}"
AUDIT_LEVEL="${AUDIT_LEVEL:-high}"

case "${MODE}" in
  prod)
    echo "Running production dependency audit at ${AUDIT_LEVEL} severity or higher..."
    pnpm audit --prod --audit-level "${AUDIT_LEVEL}"
    # The React console is a standalone npm project, outside the pnpm workspace.
    (cd frontend && npm audit --omit=dev --audit-level "${AUDIT_LEVEL}")
    ;;
  all)
    echo "Running full dependency audit, including dev dependencies, at ${AUDIT_LEVEL} severity or higher..."
    pnpm audit --audit-level "${AUDIT_LEVEL}"
    (cd frontend && npm audit --audit-level "${AUDIT_LEVEL}")
    ;;
  *)
    echo "Usage: $0 [prod|all]" >&2
    exit 2
    ;;
esac
