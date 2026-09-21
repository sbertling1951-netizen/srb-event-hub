#!/usr/bin/env bash
#
# Governed deployment worker. Both entry points reach production through this
# script: `./deploy` pipes it over SSH (`bash -s -- <sha>`), and the webhook
# server executes it in the controller checkout. `deploy.sh` no longer deploys.
#
# The controller checkout is never the thing that serves traffic. It fetches,
# validates and then prepares each candidate in its own release directory with
# its own dependencies and build output. Nothing is installed or built inside
# the live release, so a failure before activation leaves production exactly as
# it was.
#
# Because `./deploy` supplies this file on stdin, $0 is not a usable path; the
# helper library is sourced from the controller checkout, and only AFTER the
# fast-forward, so a first install picks up the version it is deploying.

set -Eeuo pipefail

LOCK_PATH="${DEPLOY_LOCK_PATH:-/var/lock/srb-event-hub-deploy.lock}"
PROJECT_DIR="${DEPLOY_PROJECT_DIR:-${HOME}/srb-event-hub}"
PRODUCTION_URL="${DEPLOY_PRODUCTION_URL:-https://epicentrax.com}"
# Needed by the pre-merge baseline checks, before release-lib.sh is sourced.
# release-lib.sh resolves the same default.
PM2_PROCESS_NAME="${DEPLOY_PM2_PROCESS_NAME:-srb-event-hub}"
EXPECTED_SHA="${1:-}"

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

# --- Cancellation / cleanup state -------------------------------------------
# The worker can be terminated between steps, including during PM2 replacement.
# These track exactly what is owned and what a safe recovery target is, so one
# bounded cleanup path can be shared with ordinary failure recovery.
DEPLOY_PHASE="startup"     # startup|prepare|candidate|activating|verifying|done
OWNED_CANDIDATE=""         # a candidate this worker started and must reap
ROLLBACK_TARGET=""         # a release already proven to start and serve
CLEANUP_DONE=0
RECOVERY_DONE=0            # set once recovery has run, so EXIT cannot repeat it

# Runs at most once, from ERR, TERM, INT and EXIT.
worker_cleanup() {
  local reason="$1" exit_code="$2"
  (( CLEANUP_DONE )) && return 0
  CLEANUP_DONE=1

  # Owned candidate/build processes are cleaned up first, in every phase. This
  # never touches the release that is serving.
  #
  # Ownership is released only by a cleanup that actually succeeded. Clearing
  # it unconditionally asserted an outcome that had not happened, leaving the
  # worker believing nothing was owned while processes and evidence remained.
  if [[ -n "${OWNED_CANDIDATE}" ]] && declare -F stop_candidate >/dev/null 2>&1; then
    log "Cleanup (${reason}): stopping owned candidate ${OWNED_CANDIDATE}."
    if stop_candidate "${OWNED_CANDIDATE}"; then
      log "Cleanup (${reason}): candidate ${OWNED_CANDIDATE} cleanup proven; releasing ownership."
      OWNED_CANDIDATE=""
    else
      log "Cleanup (${reason}): candidate cleanup for ${OWNED_CANDIDATE} could NOT be proven; ownership and evidence retained."
    fi
  fi

  # Only an interruption after PM2 was disturbed can leave the service down.
  case "${DEPLOY_PHASE}" in
    activating|verifying)
      if (( RECOVERY_DONE )); then
        log "Cleanup (${reason}): recovery already ran on the failure path; not repeating it."
      elif [[ -n "${ROLLBACK_TARGET}" ]] && declare -F recover_to >/dev/null 2>&1; then
        RECOVERY_DONE=1
        log "Cleanup (${reason}): interrupted during ${DEPLOY_PHASE}; restoring ${ROLLBACK_TARGET}."
        local status=0
        recover_to "${ROLLBACK_TARGET}" "interrupted ${DEPLOY_PHASE}" || status=$?
        case "${status}" in
          0) log "Cleanup (${reason}): ${ROLLBACK_TARGET} restored and verified. The deployment still FAILED." ;;
          2) log "Cleanup (${reason}): ROLLBACK FAILED for ${ROLLBACK_TARGET}. Manual intervention required." ;;
          3) log "Cleanup (${reason}): ROLLBACK VERIFICATION FAILED for ${ROLLBACK_TARGET}. Manual intervention required." ;;
          5) log "Cleanup (${reason}): RECOVERY PREFLIGHT FAILED for ${ROLLBACK_TARGET}; PM2 was not switched. Manual intervention required." ;;
          *) log "Cleanup (${reason}): no usable recovery target. Manual intervention required." ;;
        esac
      else
        log "Cleanup (${reason}): interrupted during ${DEPLOY_PHASE} with no verified rollback target. Manual intervention required."
      fi
      ;;
    *)
      log "Cleanup (${reason}): interrupted during ${DEPLOY_PHASE}; the serving release was never disturbed."
      ;;
  esac
  return "${exit_code}"
}

# The lock is released when the last holder of descriptor 9 exits. Cleanup
# therefore runs BEFORE this shell exits, so serialization outlives it.
on_signal() {
  local sig="$1"
  printf '%s Deployment worker received SIG%s; beginning bounded cleanup.\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "${sig}" >&2
  worker_cleanup "SIG${sig}" 1 || true
  exit 1
}
trap 'on_signal TERM' TERM
trap 'on_signal INT' INT
trap 'worker_cleanup EXIT $? || true' EXIT

on_error() {
  local exit_code=$?
  # STDERR: trap output on stdout can be captured by a surrounding $( ) and
  # mistaken for that command's result.
  printf '%s Deployment worker failed (exit %s) at line %s while running: %s\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "${exit_code}" "${BASH_LINENO[0]}" "${BASH_COMMAND}" >&2
  worker_cleanup "error" "${exit_code}" || true
  exit "${exit_code}"
}
trap on_error ERR

# --- Single-flight lock (unchanged contract: exit 75 means "already running") -
exec 9>"${LOCK_PATH}"
if ! flock -n 9; then
  log "Another Event Hub deployment is already in progress."
  exit 75
fi

log "Deployment worker started."
cd "${PROJECT_DIR}"

# --- Controller guards (unchanged) -----------------------------------------
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
log "Current controller commit: ${previous_sha:0:12}"

# Paths are exported before the library is sourced so the pre-merge snapshot
# below and the library agree on where releases live.
export DEPLOY_RELEASE_ROOT="${DEPLOY_RELEASE_ROOT:-${HOME}/srb-event-hub-releases}"
# Outside any user home: the deploying user is root, and Nginx cannot traverse
# a 0700 home to reach published assets.
export DEPLOY_ASSET_STORE="${DEPLOY_ASSET_STORE:-/srv/srb-event-hub/assets}"
export DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR:-${HOME}/srb-event-hub-state}"

# --- First-install baseline snapshot ---------------------------------------
# Taken BEFORE the fast-forward, because after it the checkout's source no
# longer matches the .next/node_modules that are actually serving. This is a
# pure copy: nothing is reset, installed, built or moved, and the original
# service keeps running from the original checkout throughout. It exists so
# that the very first isolated activation has a real, complete, verified
# rollback target -- there is no first-install exception.
BASELINE_NAME=""
if [[ ! -f "${DEPLOY_STATE_DIR}/current" ]]; then
  # Enumerate existing snapshots WITHOUT choosing on faith. Creation and reuse
  # are different operations: reuse only ever validates, and never rewrites
  # identity or configuration.
  existing_complete=()
  existing_partial=()
  for existing in "${DEPLOY_RELEASE_ROOT}"/*-baseline; do
    [[ -d "${existing}" ]] || continue
    if [[ -f "${existing}/.baseline-complete" ]]; then
      existing_complete+=("$(basename "${existing}")")
    else
      existing_partial+=("$(basename "${existing}")")
    fi
  done

  if (( ${#existing_partial[@]} > 0 )); then
    # A partial snapshot means an earlier run was interrupted mid-creation. It
    # is preserved as evidence and never silently discarded or completed: its
    # bytes may be a copy of a build that is still serving.
    log "Refusing to proceed: incomplete baseline snapshot(s) present with unresolved provenance:"
    for existing in "${existing_partial[@]}"; do log "  ${DEPLOY_RELEASE_ROOT}/${existing}"; done
    log "Inspect and remove them by hand once their contents are understood."
    exit 1
  fi

  if (( ${#existing_complete[@]} > 1 )); then
    log "Refusing to proceed: multiple complete baseline snapshots present; the original is ambiguous:"
    for existing in "${existing_complete[@]}"; do log "  ${DEPLOY_RELEASE_ROOT}/${existing}"; done
    exit 1
  fi

  if (( ${#existing_complete[@]} == 1 )); then
    BASELINE_NAME="${existing_complete[0]}"
    log "Reusing the preserved baseline from an earlier run: ${BASELINE_NAME} (its identity and configuration are left untouched)."
  elif [[ -d ".next" && -d "node_modules" && -f "package.json" ]]; then
    # --- Creation: once, before the controller advances -----------------------
    # Identity and configuration are written HERE, alongside the bytes they
    # describe, and the completion marker is written LAST. A run interrupted at
    # any earlier point therefore leaves a snapshot that can never be mistaken
    # for complete.
    BASELINE_NAME="$(date -u '+%Y%m%dT%H%M%SZ')-${previous_sha:0:12}-baseline"
    baseline_dir="${DEPLOY_RELEASE_ROOT}/${BASELINE_NAME}"
    baseline_config="${DEPLOY_CONFIG_FILE:-${HOME}/srb-event-hub-config/app.env}"

    if [[ ! -f "${baseline_config}" ]]; then
      log "Cannot preserve the running build: application configuration is missing at ${baseline_config}."
      exit 1
    fi

    log "Snapshotting the current serving build as a rollback baseline: ${BASELINE_NAME}"
    mkdir -p "${DEPLOY_RELEASE_ROOT}"
    if ! cp -a "${PROJECT_DIR}/." "${baseline_dir}/"; then
      log "Baseline snapshot failed; refusing to proceed. The running service is untouched."
      log "Partial snapshot preserved for inspection at ${baseline_dir}."
      exit 1
    fi
    # The build and the configuration it ran with stay together.
    if ! install -m 600 "${baseline_config}" "${baseline_dir}/.release-env"; then
      log "Could not pin the running configuration into ${BASELINE_NAME}; snapshot left incomplete for inspection."
      exit 1
    fi
    # Identity is the commit these bytes were built from -- captured before any
    # fetch or merge, never the directory name and never a later controller HEAD.
    printf '%s' "${previous_sha}" > "${baseline_dir}/.release-sha"
    date -u '+%Y-%m-%dT%H:%M:%SZ' > "${baseline_dir}/.prepared-at"
    # LAST: the only signal that the snapshot is whole.
    printf 'source+build, pinned config and identity recorded at %s for %s\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "${previous_sha}" > "${baseline_dir}/.baseline-complete"
    log "Baseline snapshot complete: ${BASELINE_NAME} (commit ${previous_sha:0:12})."
  else
    # Missing build directories do NOT prove an empty host. If something is
    # still serving under this process name we cannot identify what it is.
    if command -v pm2 >/dev/null 2>&1 && pm2 jlist 2>/dev/null | grep -q "\"${PM2_PROCESS_NAME}\""; then
      log "No build found in ${PROJECT_DIR}, but PM2 still reports a '${PM2_PROCESS_NAME}' process."
      log "Serving identity cannot be established; refusing to proceed. Resolve this by hand."
      exit 1
    fi
    log "No existing build and no running process; treating this as a fresh host with nothing to preserve."
  fi
fi

git fetch origin
incoming_sha="$(git rev-parse origin/main)"
log "Incoming origin/main commit: ${incoming_sha:0:12}"

if [[ -n "${EXPECTED_SHA}" && "${incoming_sha}" != "${EXPECTED_SHA}" ]]; then
  log "origin/main does not match the manually validated commit."
  exit 1
fi

if ! git merge-base --is-ancestor "${previous_sha}" "${incoming_sha}"; then
  log "Production main is not a fast-forward ancestor of origin/main; refusing to overwrite its history."
  exit 1
fi

git merge --ff-only "${incoming_sha}"

# --- Helper library (from the just-merged controller checkout) --------------
RELEASE_LIB="${PROJECT_DIR}/scripts/deployment/release-lib.sh"
if [[ ! -f "${RELEASE_LIB}" ]]; then
  log "Release library missing at ${RELEASE_LIB}; refusing to deploy."
  exit 1
fi
# shellcheck source=scripts/deployment/release-lib.sh
source "${RELEASE_LIB}"

validate_timing_configuration || exit 1

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

require_config || exit 1

# An earlier attempt that could not prove its cleanup leaves a marker. Its
# processes may still be alive and holding the candidate port, so activating
# anything now would be unsafe. The record is never silently overwritten.
unresolved=()
for release in "${DEPLOY_RELEASE_ROOT}"/*; do
  [[ -d "${release}" && -f "${release}/.cleanup-unresolved" ]] || continue
  unresolved+=("$(basename "${release}")")
done
if (( ${#unresolved[@]} > 0 )); then
  log "Refusing to proceed: a previous attempt could not establish cleanup for:"
  for release in "${unresolved[@]}"; do
    log "  ${DEPLOY_RELEASE_ROOT}/${release} (since $(cat "${DEPLOY_RELEASE_ROOT}/${release}/.cleanup-unresolved"))"
  done
  log "Resolve those processes by hand, then remove the .cleanup-unresolved marker."
  exit 1
fi

# Assets must be reachable by the web server BEFORE anything is published into
# the store, and any earlier $HOME-based store is carried across so existing
# deployments' assets keep resolving.
if ! assert_asset_store_readable; then
  log "Asset-store preflight failed; refusing to deploy. The running service is untouched."
  exit 1
fi
migrate_legacy_asset_store

# Prepare the baseline and PROVE IT CAN SERVE by starting it supervised on the
# alternate loopback port. It is not recorded as `current` and gets no
# activation timestamp: PM2 is still serving the original checkout.
if [[ -n "${BASELINE_NAME}" ]]; then
  # Adoption only validates and publishes; it never rewrites identity or
  # configuration, so a retry cannot relabel the preserved bytes.
  if ! adopt_baseline "${BASELINE_NAME}"; then
    log "Could not adopt the preserved baseline; refusing to proceed. The running service is untouched."
    exit 1
  fi
  log "Proving the preserved baseline can start and serve before any candidate activation."
  # Ownership is registered BEFORE anything is launched, exactly as for a normal
  # candidate. Previously only the real candidate was registered, so a worker
  # cancelled during baseline verification reaped nothing: the baseline's
  # detached process group survived holding the candidate port, and every later
  # attempt then failed its own cleanup check with no record of what was left.
  DEPLOY_PHASE="baseline"
  OWNED_CANDIDATE="${BASELINE_NAME}"
  if ! verify_release_standalone "${BASELINE_NAME}"; then
    # OWNED_CANDIDATE is deliberately left set: a failed verification is not
    # evidence that cleanup succeeded. The cleanup handler decides that for
    # itself and clears ownership only when it can prove it.
    log "Baseline verification FAILED. Refusing to begin the isolated-release transition."
    log "The original service is still running from ${PROJECT_DIR} and was not modified."
    exit 1
  fi
  # verify_release_standalone returns 0 only when the content checks passed AND
  # cleanup was proven, so ownership can be released here.
  OWNED_CANDIDATE=""
  log "Baseline verified as startable and serving; the transition may proceed."
fi

active_release="$(read_state current 2>/dev/null || true)"
if [[ -n "${active_release}" ]]; then
  log "Active release: ${active_release}"
else
  log "No active release recorded and no build to preserve; this run performs a fresh isolated install."
fi

# Idempotence is decided by what is ACTUALLY SERVING: the recorded release must
# match the incoming commit, PM2 must be running from that release directory,
# and the service must verify. If identity cannot be established we deploy
# rather than skip, which is the safe direction.
if already_deployed "${incoming_sha}"; then
  log "origin/main ${incoming_sha:0:12} is already the running, verified release; no action required."
  exit 0
fi

# --- Prepare the candidate (live release untouched throughout) --------------
DEPLOY_PHASE="prepare"
candidate="$(new_release_name "${incoming_sha}")"
if ! prepare_release "${incoming_sha}" "${candidate}"; then
  log "Candidate preparation failed. Live release remains active; evidence kept at $(release_dir "${candidate}")."
  exit 1
fi
printf '%s' "${incoming_sha}" > "$(release_dir "${candidate}")/.release-sha"

# --- Publish assets BEFORE activation --------------------------------------
if ! publish_assets "${candidate}" || ! assert_published_assets_readable "${candidate}"; then
  log "Asset publication failed. Live release remains active; evidence kept at $(release_dir "${candidate}")."
  exit 1
fi

# --- Verify the candidate on an alternate loopback port ---------------------
# Same supervised start/verify/reap path the baseline used.
DEPLOY_PHASE="candidate"
OWNED_CANDIDATE="${candidate}"
if ! verify_release_standalone "${candidate}"; then
  # OWNED_CANDIDATE is deliberately left set: EXIT cleanup must still be able
  # to inspect and retry this candidate. A failed verification is not evidence
  # that cleanup succeeded -- the cleanup handler decides that for itself, and
  # clears ownership only when it can prove it.
  log "Candidate verification failed; NOT activating. Live release remains active."
  log "Failed-release evidence retained at $(release_dir "${candidate}") (see .candidate.log)."
  exit 1
fi

# --- Activate, then verify through the real serving path --------------------
# Prefer the release that is actually active; on a first install that is the
# prepared baseline, which has already been proven to start and serve.
OWNED_CANDIDATE=""
rollback_target="${active_release:-$(read_state baseline 2>/dev/null || true)}"
# Recorded BEFORE PM2 is disturbed, so an interruption mid-activation has a
# target that was already proven to start and serve.
ROLLBACK_TARGET="${rollback_target}"
DEPLOY_PHASE="activating"
if ! activate_release "${candidate}"; then
  log "Activation failed for ${candidate}."
  RECOVERY_DONE=1
  recover_to "${rollback_target}" "failed activation" || true
  log "Failed-release evidence retained at $(release_dir "${candidate}")."
  exit 1
fi

# Through real Nginx on loopback, including TLS termination, so the asset
# location block and Host forwarding are exercised. Never through Cloudflare:
# a cached 200 at the edge can mask a 404 at the origin, which is exactly how
# the 2026-09-20 incident stayed invisible on epicentrax.com.
NGINX_SCHEME="${DEPLOY_NGINX_SCHEME:-https}"
NGINX_PORT="${DEPLOY_NGINX_PORT:-443}"
DEPLOY_PHASE="verifying"
log "Verifying activated release ${candidate} through local Nginx (Host: ${CANONICAL_HOST})"
wait_until_responding || true
if ! verify_through_nginx; then
  log "Post-activation verification FAILED for ${candidate}."
  # Identical recovery to the failed-activation path above: restore, keep the
  # state pointers consistent, and verify the restored release the same way.
  RECOVERY_DONE=1
  recover_to "${rollback_target}" "failed post-activation verification" || true
  # A successful, verified rollback is still a failed deployment.
  log "Failed-release evidence retained at $(release_dir "${candidate}")."
  exit 1
fi

# --- Success: promote rollback pointer and prune ---------------------------
if [[ -n "${rollback_target}" && "${rollback_target}" != "${candidate}" ]]; then
  write_state previous "${rollback_target}"
fi

cleanup_releases
cleanup_assets

deployed_sha="$(git rev-parse HEAD)"
if [[ "${deployed_sha}" != "${incoming_sha}" ]]; then
  log "Controller HEAD does not match origin/main after deployment."
  exit 1
fi
if [[ -n "${EXPECTED_SHA}" && "${deployed_sha}" != "${EXPECTED_SHA}" ]]; then
  log "Controller HEAD does not match the manually validated commit."
  exit 1
fi

# Release identity is resolved from the release directory, not the controller
# checkout: the controller can advance later, so only .release-sha states what
# is actually serving.
DEPLOY_PHASE="done"
log "Deployment worker completed."
log "  Active release:  ${candidate}"
log "  Deployed commit: $(cat "$(release_dir "${candidate}")/.release-sha" | cut -c1-12)"
log "  Rollback target: ${rollback_target:-<none>}"
log "  Production URL:  ${PRODUCTION_URL}"
