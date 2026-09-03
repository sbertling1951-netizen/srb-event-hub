#!/usr/bin/env bash

set -Eeuo pipefail

LOCK_PATH="${DEPLOY_LOCK_PATH:-/var/lock/srb-event-hub-deploy.lock}"
PROJECT_DIR="${DEPLOY_PROJECT_DIR:-${HOME}/srb-event-hub}"
PM2_PROCESS_NAME="srb-event-hub"
PRODUCTION_URL="https://epicentrax.com"
EXPECTED_SHA="${1:-}"

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

on_error() {
  local exit_code=$?
  log "Deployment worker failed (exit ${exit_code}) at line ${BASH_LINENO[0]} while running: ${BASH_COMMAND}"
  exit "${exit_code}"
}
trap on_error ERR

exec 9>"${LOCK_PATH}"

if ! flock -n 9; then
  log "Another Event Hub deployment is already in progress."
  exit 75
fi

log "Deployment worker started."
cd "${PROJECT_DIR}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "Production directory is not a Git repository: ${PROJECT_DIR}"
  exit 1
fi

if [[ "$(git branch --show-current)" != "main" ]]; then
  log "Production repository is not on main."
  exit 1
fi

if [[ -n "$(git status --short)" ]]; then
  log "Production working tree is dirty; refusing to update it."
  git status --short >&2
  exit 1
fi

previous_sha="$(git rev-parse HEAD)"
log "Current production commit: ${previous_sha:0:12}"
git fetch origin
incoming_sha="$(git rev-parse origin/main)"
log "Incoming origin/main commit: ${incoming_sha:0:12}"

if [[ -n "${EXPECTED_SHA}" && "${incoming_sha}" != "${EXPECTED_SHA}" ]]; then
  log "origin/main does not match the manually validated commit."
  exit 1
fi

if [[ "${previous_sha}" == "${incoming_sha}" ]]; then
  log "Commit already deployed; no action required."
  exit 0
fi

if ! git merge-base --is-ancestor "${previous_sha}" "${incoming_sha}"; then
  log "Production main is not a fast-forward ancestor of origin/main; refusing to overwrite its history."
  exit 1
fi

run_npm_ci=0
if git cat-file -e "${previous_sha}^{commit}" 2>/dev/null && \
  git cat-file -e "${incoming_sha}^{commit}" 2>/dev/null; then
  if git diff --quiet "${previous_sha}" "${incoming_sha}" -- package.json package-lock.json; then
    log "Dependencies unchanged; skipping npm ci."
  else
    log "Dependency manifest changed; running npm ci."
    run_npm_ci=1
  fi
else
  log "Cannot safely compare dependency manifests; running npm ci."
  run_npm_ci=1
fi

git merge --ff-only "${incoming_sha}"

if [[ "${run_npm_ci}" == "1" ]]; then
  npm ci
fi

log "Building production application."
npm run build
log "Production build completed."

log "Restarting PM2 process: ${PM2_PROCESS_NAME}"
pm2 restart "${PM2_PROCESS_NAME}"

pm2 jlist | node -e '
const processName = process.argv[1];
const processes = JSON.parse(require("fs").readFileSync(0, "utf8"));
const processInfo = processes.find((item) => item.name === processName);
if (!processInfo || processInfo.pm2_env?.status !== "online") process.exit(1);
' "${PM2_PROCESS_NAME}"
log "PM2 process is online."

log "Waiting for application startup."
sleep 4

health_deadline=$((SECONDS + 60))
health_attempt=1
health_check_succeeded=0

while (( SECONDS < health_deadline )); do
  log "Health check attempt ${health_attempt}."

  if curl --fail --location --silent --show-error \
    --connect-timeout 5 --max-time 10 \
    --output /dev/null "${PRODUCTION_URL}"; then
    health_check_succeeded=1
    log "Application is responding."
    break
  fi

  if (( SECONDS + 2 >= health_deadline )); then
    break
  fi

  sleep 2
  health_attempt=$((health_attempt + 1))
done

if [[ "${health_check_succeeded}" != "1" ]]; then
  log "Health check failed: application did not respond within 60 seconds."
  exit 1
fi

deployed_sha="$(git rev-parse HEAD)"
if [[ "${deployed_sha}" != "${incoming_sha}" ]]; then
  log "Production HEAD does not match origin/main after deployment."
  exit 1
fi

if [[ -n "${EXPECTED_SHA}" && "${deployed_sha}" != "${EXPECTED_SHA}" ]]; then
  log "Production HEAD does not match the manually validated commit."
  exit 1
fi

log "Deployment worker completed: ${deployed_sha:0:12}"
