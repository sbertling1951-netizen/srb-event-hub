#!/usr/bin/env bash
#
# Manual rollback to the recorded previous release.
#
# Takes the SAME deployment lock as the worker, so a manual rollback can never
# interleave with a deployment that is midway through publishing assets or
# rebinding PM2. It uses the same recover_to() path the worker uses, so the
# restored release is verified -- activation alone is not treated as success.
#
# Usage:  bash scripts/deployment/rollback.sh [release-name]
# With no argument the recorded rollback target is used.

set -Eeuo pipefail

LOCK_PATH="${DEPLOY_LOCK_PATH:-/var/lock/srb-event-hub-deploy.lock}"
PROJECT_DIR="${DEPLOY_PROJECT_DIR:-${HOME}/srb-event-hub}"

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

exec 9>"${LOCK_PATH}"
if ! flock -n 9; then
  log "A deployment is in progress; refusing to roll back concurrently."
  exit 75
fi

# shellcheck source=scripts/deployment/release-lib.sh
source "${PROJECT_DIR}/scripts/deployment/release-lib.sh"

VERIFIER="${PROJECT_DIR}/scripts/deployment/verify-release.mjs"
VERIFY_PATHS=("--path=/")
VERIFY_PROTECTED=()
if [[ -n "${DEPLOY_VERIFY_PATHS:-}" ]]; then
  VERIFY_PATHS=()
  for verify_path in ${DEPLOY_VERIFY_PATHS}; do VERIFY_PATHS+=("--path=${verify_path}"); done
fi
if [[ -n "${DEPLOY_PROTECTED_PATHS:-}" ]]; then
  for protected_path in ${DEPLOY_PROTECTED_PATHS}; do VERIFY_PROTECTED+=("--protected=${protected_path}"); done
fi

target="${1:-$(read_state previous 2>/dev/null || true)}"
if [[ -z "${target}" ]]; then
  log "No rollback target recorded and none supplied."
  exit 1
fi

log "Manual rollback requested: ${target}"
# `set -e` would abort on any nonzero result before the classification below,
# collapsing "could not activate" and "activated but did not verify" into a
# bare failure. Capture the status explicitly instead.
status=0
recover_to "${target}" "manual rollback" || status=$?

case "${status}" in
  0) log "Manual rollback completed and verified: ${target}"; exit 0 ;;
  2) log "Manual rollback FAILED: ${target} could not be activated."; exit 1 ;;
  3) log "Manual rollback ACTIVATED BUT DID NOT VERIFY: ${target}."; exit 1 ;;
  5) log "Manual rollback REFUSED: ${target}'\''s retained assets are not present and accessible. PM2 was not touched."; exit 1 ;;
  *) log "Manual rollback could not run: no usable target."; exit 1 ;;
esac
