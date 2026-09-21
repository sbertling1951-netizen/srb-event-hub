#!/usr/bin/env bash
# Focused regressions for Lun's five findings.
#
# Written to FAIL against the anchored revision and pass only once each defect
# is repaired. Real disposable processes and sockets; nothing touches
# production. Every assertion states the single outcome it requires -- none
# accepts "either success or failure".
#
# Run with: bash scripts/deployment/findings.test.sh

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
report() { if [[ "$1" == pass ]]; then PASS=$((PASS+1)); printf '  ok   %s\n' "$2"; else FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$2"; fi; }
expect() { if [[ "$2" == "$3" ]]; then report pass "$1"; else report fail "$1 (got '$2', want '$3')"; fi; }
expect_contains() { if grep -q "$2" <<< "$3"; then report pass "$1"; else report fail "$1 (missing '$2')"; fi; }

ROOT=""
OWNED_PIDS=()
cleanup() {
  # The fixture reaps its own survivors; it never relies on the implementation
  # under test to do so.
  for p in ${OWNED_PIDS[@]+"${OWNED_PIDS[@]}"}; do
    pkill -KILL -P "${p}" 2>/dev/null || true
    kill -KILL "${p}" 2>/dev/null || true
  done
  [[ -n "${ROOT}" ]] && rm -rf "${ROOT}"
  return 0
}
trap cleanup EXIT

new_fixture() {
  ROOT="$(mktemp -d)"; export ROOT
  mkdir -p "${ROOT}/bin"
  export DEPLOY_RELEASE_ROOT="${ROOT}/releases"
  export DEPLOY_ASSET_STORE="${ROOT}/assets"
  export DEPLOY_STATE_DIR="${ROOT}/state"
  export DEPLOY_CONFIG_FILE="${ROOT}/app.env"
  printf 'NEXT_PUBLIC_SUPABASE_URL=https://fixture.invalid\nNEXT_PUBLIC_SUPABASE_ANON_KEY=fixture\n' > "${DEPLOY_CONFIG_FILE}"
  chmod 600 "${DEPLOY_CONFIG_FILE}"
  mkdir -p "${DEPLOY_STATE_DIR}"
}

make_release() { # make_release <name>
  local dir="${DEPLOY_RELEASE_ROOT}/$1"
  mkdir -p "${dir}/node_modules" "${dir}/.next/static/chunks"
  echo '{}' > "${dir}/package.json"
  printf 'body{}' > "${dir}/.next/static/chunks/app.css"
  install -m 600 "${DEPLOY_CONFIG_FILE}" "${dir}/.release-env"
  printf '%040d' 1 | tr '0' 'a' > "${dir}/.release-sha"
}

echo "Five-finding regressions"

# ---------------------------------------------------------------------------
echo "F1. leader death is not proof that owned descendants are gone"
new_fixture
PORT1=39621
make_release lead-exit
cat > "${ROOT}/bin/npm" <<'MOCK'
#!/usr/bin/env bash
# Leader spawns a long-lived, NON-LISTENING child that ignores TERM, then exits.
setsid_child() { bash -c 'trap "" TERM; exec sleep 400'; }
setsid_child &
echo "$!" > "${CHILD_PID_FILE}"
exit 0
MOCK
chmod +x "${ROOT}/bin/npm"

CHILD_PID_FILE="${ROOT}/child.pid"; export CHILD_PID_FILE
PATH="${ROOT}/bin:${PATH}" DEPLOY_CANDIDATE_PORT="${PORT1}" bash -c '
  source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
  start_candidate "lead-exit"
' >/dev/null 2>&1
sleep 2
child="$(cat "${CHILD_PID_FILE}" 2>/dev/null || echo 0)"
OWNED_PIDS+=("${child}")
leader="$(cat "${DEPLOY_RELEASE_ROOT}/lead-exit/.candidate.pid" 2>/dev/null || echo 0)"

expect "the leader has already exited" "$(kill -0 "${leader}" 2>/dev/null && echo alive || echo gone)" "gone"
expect "the owned child genuinely survives before cleanup runs" "$(kill -0 "${child}" 2>/dev/null && echo alive || echo gone)" "alive"

stop_status=0
stop_out="$(PATH="${ROOT}/bin:${PATH}" DEPLOY_CANDIDATE_PORT="${PORT1}" bash -c '
  source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
  stop_candidate "lead-exit"
' 2>&1)" || stop_status=$?

# Required outcome: cleanup must NOT report success while an owned process lives.
if kill -0 "${child}" 2>/dev/null; then
  expect "cleanup refuses success while an owned child survives" "$([ "${stop_status}" -ne 0 ] && echo refused || echo claimed-success)" "refused"
  expect_contains "it says so explicitly" "CLEANUP UNPROVEN" "${stop_out}"
  expect "ownership evidence is retained for the next attempt" \
    "$(test -f "${DEPLOY_RELEASE_ROOT}/lead-exit/.candidate.pid" -o -f "${DEPLOY_RELEASE_ROOT}/lead-exit/.candidate.owned" && echo yes || echo no)" "yes"
else
  expect "cleanup actually terminated the owned child" "$(kill -0 "${child}" 2>/dev/null && echo alive || echo gone)" "gone"
  expect "and only then reported success" "${stop_status}" "0"
fi
cleanup

# ---------------------------------------------------------------------------
echo "F3. a broken probe is unknown, never free"
new_fixture
PORT3=39623
probe() { PATH="$1" DEPLOY_CANDIDATE_PORT="${PORT3}" bash -c '
  source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
  candidate_port_free && echo 0 || echo $?' 2>/dev/null; }

# A probe that exists but always fails with an error status.
mkdir -p "${ROOT}/brokenbin"
printf '#!/usr/bin/env bash\nexit 7\n' > "${ROOT}/brokenbin/lsof"; chmod +x "${ROOT}/brokenbin/lsof"
printf '#!/usr/bin/env bash\nexit 7\n' > "${ROOT}/brokenbin/node"; chmod +x "${ROOT}/brokenbin/node"
expect "a broken probe reports UNKNOWN (2), never free" "$(probe "${ROOT}/brokenbin:/usr/bin:/bin")" "2"

NODE_DIR="$(dirname "$(command -v node)")"
expect "no probe at all reports UNKNOWN (2)" "$(probe "/usr/bin:/bin")" "2"

node -e 'require("net").createServer().listen(Number(process.argv[1]),"127.0.0.1");setInterval(()=>{},1<<30)' "${PORT3}" & holder=$!
OWNED_PIDS+=("${holder}")
sleep 1
expect "a genuinely occupied port reports OCCUPIED (1)" "$(probe "${NODE_DIR}:/usr/bin:/bin")" "1"
kill "${holder}" 2>/dev/null || true; wait "${holder}" 2>/dev/null || true; sleep 1
expect "a genuinely free port reports FREE (0)" "$(probe "${NODE_DIR}:/usr/bin:/bin")" "0"
cleanup

# ---------------------------------------------------------------------------
echo "F2. cleanup failure fails the verification that owns it"
new_fixture
PORT2=39625
make_release cleanupfail
cat > "${ROOT}/bin/npm" <<'MOCK'
#!/usr/bin/env bash
exec sleep 120
MOCK
chmod +x "${ROOT}/bin/npm"
printf '#!/usr/bin/env bash\nexit 0\n' > "${ROOT}/bin/curl"; chmod +x "${ROOT}/bin/curl"
# A real JS verifier: it is invoked as `node "${VERIFIER}"`.
printf 'process.exit(0);\n' > "${ROOT}/bin/verifier-ok.mjs"

# Cleanup failure is INJECTED after content verification succeeds, so the
# question under test is purely whether the result propagates.
verify_status=0
verify_out="$(PATH="${ROOT}/bin:${PATH}" DEPLOY_CANDIDATE_PORT="${PORT2}" bash -c '
  source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
  VERIFIER="'"${ROOT}"'/bin/verifier-ok.mjs"
  VERIFY_PATHS=("--path=/")
  VERIFY_PROTECTED=()
  CANONICAL_HOST=example.invalid
  real_stop_candidate() { :; }
  stop_candidate() {
    log "CLEANUP UNPROVEN: injected failure for $1"
    return 1
  }
  verify_release_standalone "cleanupfail"
' 2>&1)" || verify_status=$?

expect "verify_release_standalone returns FAILURE when cleanup fails" "$([ "${verify_status}" -ne 0 ] && echo failed || echo passed)" "failed"
expect_contains "the cleanup problem is reported, not downgraded to a warning" "CLEANUP UNPROVEN" "${verify_out}"
expect_contains "the failure names cleanup, not content" "cleanup could not be established" "${verify_out}"
# The fixture reaps the candidate it started, since stop_candidate was stubbed.
leftover_pgid="$(cat "${DEPLOY_RELEASE_ROOT}/cleanupfail/.candidate.pgid" 2>/dev/null || echo "")"
if [[ -n "${leftover_pgid}" ]]; then kill -KILL "-${leftover_pgid}" 2>/dev/null || true; fi
cleanup

# ---------------------------------------------------------------------------
echo "F4. manual rollback must preflight asset access before touching PM2"
# Sets RB_STATUS / RB_ACTIVATED / RB_CURRENT / RB_OUT as globals. Deliberately
# NOT run in a command substitution: a subshell would discard the fixture ROOT.
rollback_case() { # rollback_case <allow|deny|absent>
  new_fixture
  mkdir -p "${ROOT}/bin"
  cat > "${ROOT}/bin/pm2" <<'MOCK'
#!/usr/bin/env bash
[[ "$1" == "start" ]] && echo activated >> "${ROOT}/state/pm2-activations"
exit 0
MOCK
  cat > "${ROOT}/bin/flock" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
  cat > "${ROOT}/bin/id" <<'MOCK'
#!/usr/bin/env bash
[[ "${FIXTURE_WEB_ACCESS:-allow}" == "absent" ]] && exit 1
exit 0
MOCK
  cat > "${ROOT}/bin/sudo" <<'MOCK'
#!/usr/bin/env bash
mode="${FIXTURE_WEB_ACCESS:-allow}"
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  if [[ "${args[i]}" == "true" ]]; then [[ "${mode}" == "absent" ]] && exit 1; exit 0; fi
  if [[ "${args[i]}" == "test" ]]; then [[ "${mode}" == "deny" ]] && exit 1; exec "${args[@]:i}"; fi
done
exit 0
MOCK
  # The verifier must only ever run AFTER a permitted activation.
  cat > "${ROOT}/bin/node" <<'MOCK'
#!/usr/bin/env bash
echo "verifier-invoked $*" >> "${ROOT}/state/verifier-calls"
exit 0
MOCK
  chmod +x "${ROOT}/bin/"*
  mkdir -p "${ROOT}/controller/scripts/deployment"
  cp "${REPO_ROOT}/scripts/deployment/release-lib.sh" "${ROOT}/controller/scripts/deployment/"
  cp "${REPO_ROOT}/scripts/deployment/verify-release.mjs" "${ROOT}/controller/scripts/deployment/"

  make_release target-release
  # Its published assets exist in the shared store.
  mkdir -p "${DEPLOY_ASSET_STORE}/_next/static/chunks"
  printf 'body{}' > "${DEPLOY_ASSET_STORE}/_next/static/chunks/app.css"
  printf 'chunks/app.css\n' > "${DEPLOY_RELEASE_ROOT}/target-release/.release-assets"
  printf 'target-release' > "${DEPLOY_STATE_DIR}/previous"
  printf 'other-release'  > "${DEPLOY_STATE_DIR}/current"

  local st=0
  PATH="${ROOT}/bin:${PATH}" DEPLOY_PROJECT_DIR="${ROOT}/controller" \
    DEPLOY_LOCK_PATH="${ROOT}/state/lock" FIXTURE_WEB_ACCESS="$1" \
    DEPLOY_ALLOW_UNVERIFIED_ASSET_ACCESS=1 DEPLOY_PROTECTED_PATHS="/admin" \
    bash "${REPO_ROOT}/scripts/deployment/rollback.sh" target-release > "${ROOT}/rb.out" 2>&1 || st=$?
  RB_STATUS="${st}"
  RB_ACTIVATED="$(test -f "${ROOT}/state/pm2-activations" && echo yes || echo no)"
  RB_CURRENT="$(cat "${DEPLOY_STATE_DIR}/current")"
  RB_OUT="$(cat "${ROOT}/rb.out" 2>/dev/null || echo "")"
}

rollback_case absent
expect "unavailable access refuses the manual rollback" "$([ "${RB_STATUS}" -ne 0 ] && echo refused || echo proceeded)" "refused"
expect "nothing was activated on unavailable access" "${RB_ACTIVATED}" "no"
expect "state pointers were not mutated on unavailable access" "${RB_CURRENT}" "other-release"
expect_contains "unavailability is reported distinctly" "UNVERIFIED" "${RB_OUT}"
cleanup

rollback_case deny
expect "denied access refuses the manual rollback" "$([ "${RB_STATUS}" -ne 0 ] && echo refused || echo proceeded)" "refused"
expect "nothing was activated on denied access" "${RB_ACTIVATED}" "no"
expect "state pointers were not mutated on denied access" "${RB_CURRENT}" "other-release"
expect_contains "denial is reported distinctly from unavailability" "PERMISSION DENIED" "${RB_OUT}"
cleanup

rollback_case allow
verifier_calls="$(cat "${DEPLOY_STATE_DIR}/verifier-calls" 2>/dev/null || echo none)"
expect "permitted access completes the manual rollback" "${RB_STATUS}" "0"
expect "it activated the target" "${RB_ACTIVATED}" "yes"
expect "state points at the restored release" "${RB_CURRENT}" "target-release"
expect_contains "the real verifier was invoked after activation" "verifier-invoked" "${verifier_calls}"
expect_contains "with the configured protected probe" "protected=/admin" "${verifier_calls}"
cleanup

# ---------------------------------------------------------------------------
echo "F5. a second release in the same wall-clock second must not collide"
new_fixture
# Reproduces scenario 17's real collision: a first attempt fails and its
# release directory is retained as evidence, then a second attempt runs within
# the same wall-clock second.
first="$(DEPLOY_RELEASE_ROOT="${DEPLOY_RELEASE_ROOT}" bash -c '
  source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
  new_release_name aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')"
mkdir -p "${DEPLOY_RELEASE_ROOT}/${first}"   # retained failed-release evidence
second="$(DEPLOY_RELEASE_ROOT="${DEPLOY_RELEASE_ROOT}" bash -c '
  source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
  new_release_name aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')"
expect "a retry in the same second does not collide with retained evidence" \
  "$([ "${first}" != "${second}" ] && echo distinct || echo collided)" "distinct"
expect "the retained evidence directory is untouched" \
  "$(test -d "${DEPLOY_RELEASE_ROOT}/${first}" && echo yes || echo no)" "yes"
cleanup


# ---------------------------------------------------------------------------
# F6. In-memory ownership must track what cleanup actually achieved.
#
# These drive the REAL worker (do-pull.sh) in a disposable fixture and read its
# own log. Cleanup failure is injected by overriding stop_candidate in the
# FIXTURE's copy of the library -- the repository copy is frozen and untouched,
# and worker_cleanup itself is never reimplemented here.
echo "F6. ownership state reflects real cleanup outcomes"

worker_fixture() { # worker_fixture <inject-cleanup-failure: yes|no> <verifier: ok|fail>
  new_fixture
  REAL_NODE="$(command -v node)"
  mkdir -p "${ROOT}/bin" "${ROOT}/origin"
  cat > "${ROOT}/bin/npm" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  ci) mkdir -p node_modules ;;
  run) mkdir -p .next/static/chunks; printf 'body{}' > .next/static/chunks/app.css ;;
  start) exec sleep 120 ;;
esac
MOCK
  cat > "${ROOT}/bin/pm2" <<'MOCK'
#!/usr/bin/env bash
[[ "$1" == "start" ]] && echo activated >> "${ROOT}/state/pm2-activations"
exit 0
MOCK
  printf '#!/usr/bin/env bash\nexit 0\n' > "${ROOT}/bin/flock"
  printf '#!/usr/bin/env bash\nexit 0\n' > "${ROOT}/bin/curl"
  printf '#!/usr/bin/env bash\nexit 0\n' > "${ROOT}/bin/id"
  cat > "${ROOT}/bin/sudo" <<'MOCK'
#!/usr/bin/env bash
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  [[ "${args[i]}" == "true" ]] && exit 0
  if [[ "${args[i]}" == "test" ]]; then exec "${args[@]:i}"; fi
done
exit 0
MOCK
  # `node -e` (the candidate spawn) must reach real node; verifier runs are mocked.
  cat > "${ROOT}/bin/node" <<MOCK
#!/usr/bin/env bash
for a in "\$@"; do
  if [[ "\${a}" == "-e" ]]; then exec "${REAL_NODE}" "\$@"; fi
done
exit \${MOCK_VERIFIER_EXIT:-0}
MOCK
  chmod +x "${ROOT}/bin/"*
  mkdir -p "${ROOT}/state"

  git init -q --bare "${ROOT}/origin"
  git clone -q "${ROOT}/origin" "${ROOT}/controller" 2>/dev/null
  ( cd "${ROOT}/controller"
    git config user.email t@example.com; git config user.name Test
    git symbolic-ref HEAD refs/heads/main
    mkdir -p scripts/deployment
    cp "${REPO_ROOT}/scripts/deployment/release-lib.sh" scripts/deployment/
    cp "${REPO_ROOT}/scripts/deployment/verify-release.mjs" scripts/deployment/
    if [[ "$1" == "yes" ]]; then
      # Injected into the FIXTURE copy only.
      cat >> scripts/deployment/release-lib.sh <<'INJECT'

stop_candidate() {
  log "CLEANUP UNPROVEN: injected failure for $1"
  date -u '+%Y-%m-%dT%H:%M:%SZ' > "$(release_dir "$1")/.cleanup-unresolved"
  return 1
}
INJECT
    fi
    echo '{"name":"fx","scripts":{"build":"next build","start":"next start"}}' > package.json
    printf '.next/\nnode_modules/\n' > .gitignore
    git add -A && git commit -qm base
    git push -q origin main 2>/dev/null
    echo one > marker.txt && git add -A && git commit -qm one && git push -q origin main 2>/dev/null ) >/dev/null 2>&1

  WORKER_STATUS=0
  WORKER_OUT="$( ( cd "${ROOT}/controller" && PATH="${ROOT}/bin:${PATH}" \
    DEPLOY_PROJECT_DIR="${ROOT}/controller" DEPLOY_RELEASE_ROOT="${DEPLOY_RELEASE_ROOT}" \
    DEPLOY_ASSET_STORE="${DEPLOY_ASSET_STORE}" DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR}" \
    DEPLOY_LOCK_PATH="${ROOT}/state/lock" DEPLOY_CONFIG_FILE="${DEPLOY_CONFIG_FILE}" \
    DEPLOY_CANDIDATE_PORT=39801 MOCK_VERIFIER_EXIT="$( [[ "$2" == fail ]] && echo 1 || echo 0 )" \
    bash "${REPO_ROOT}/do-pull.sh" ) 2>&1 )" || WORKER_STATUS=$?
}

# --- failed verification must leave the candidate available to EXIT cleanup ---
worker_fixture no fail
expect "the worker failed" "$([ "${WORKER_STATUS}" -ne 0 ] && echo failed || echo passed)" "failed"
expect_contains "verification failure is reported" "NOT activating" "${WORKER_OUT}"
expect_contains "EXIT cleanup still saw the owned candidate" "stopping owned candidate" "${WORKER_OUT}"
expect "nothing was activated" "$(test -f "${DEPLOY_STATE_DIR}/pm2-activations" && echo yes || echo no)" "no"
cleanup

# --- cleanup failure must retain the candidate name and its evidence ---
worker_fixture yes fail
expect "the worker failed" "$([ "${WORKER_STATUS}" -ne 0 ] && echo failed || echo passed)" "failed"
expect_contains "EXIT cleanup attempted the owned candidate" "stopping owned candidate" "${WORKER_OUT}"
expect_contains "unproven cleanup is reported, not swallowed" "could NOT be proven" "${WORKER_OUT}"
expect "durable unresolved evidence is retained" \
  "$(ls "${DEPLOY_RELEASE_ROOT}"/*/.cleanup-unresolved 2>/dev/null | wc -l | tr -d ' ')" "1"
expect "nothing was activated" "$(test -f "${DEPLOY_STATE_DIR}/pm2-activations" && echo yes || echo no)" "no"
# A later attempt must refuse while that evidence stands.
RETRY_STATUS=0
RETRY_OUT="$( ( cd "${ROOT}/controller" && PATH="${ROOT}/bin:${PATH}" \
  DEPLOY_PROJECT_DIR="${ROOT}/controller" DEPLOY_RELEASE_ROOT="${DEPLOY_RELEASE_ROOT}" \
  DEPLOY_ASSET_STORE="${DEPLOY_ASSET_STORE}" DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR}" \
  DEPLOY_LOCK_PATH="${ROOT}/state/lock" DEPLOY_CONFIG_FILE="${DEPLOY_CONFIG_FILE}" \
  DEPLOY_CANDIDATE_PORT=39801 bash "${REPO_ROOT}/do-pull.sh" ) 2>&1 )" || RETRY_STATUS=$?
expect "an unsafe retry is refused" "$([ "${RETRY_STATUS}" -ne 0 ] && echo refused || echo proceeded)" "refused"
expect_contains "the refusal names the unresolved cleanup" "could not establish cleanup" "${RETRY_OUT}"
cleanup

# --- a clean success must clear ownership and not re-stop anything ---
worker_fixture no ok
expect "the worker succeeded" "${WORKER_STATUS}" "0"
expect "it activated the candidate" "$(test -f "${DEPLOY_STATE_DIR}/pm2-activations" && echo yes || echo no)" "yes"
expect "EXIT cleanup did not re-stop an already-cleaned candidate" \
  "$(grep -c 'stopping owned candidate' <<< "${WORKER_OUT}" || true)" "0"
expect "no unresolved evidence was left behind" \
  "$(ls "${DEPLOY_RELEASE_ROOT}"/*/.cleanup-unresolved 2>/dev/null | wc -l | tr -d ' ')" "0"
expect "recovery was never invoked on a successful deployment" \
  "$(grep -c 'Recovering to' <<< "${WORKER_OUT}" || true)" "0"
cleanup

# ---------------------------------------------------------------------------
echo "F7. the preserved baseline is owned before it is launched"

# A first-install fixture: the controller already has a serving build, so the
# worker takes a baseline snapshot and then proves it can serve. The candidate
# never answers while the not-ready flag exists, which gives a real window in
# which to interrupt baseline verification -- the window that previously leaked
# the baseline's detached process group onto the candidate port.
baseline_fixture() {
  new_fixture
  REAL_NODE="$(command -v node)"
  mkdir -p "${ROOT}/bin" "${ROOT}/origin" "${ROOT}/state"
  cat > "${ROOT}/bin/npm" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  ci) mkdir -p node_modules ;;
  run) mkdir -p .next/static/chunks; printf 'body{}' > .next/static/chunks/app.css ;;
  start) exec sleep 300 ;;
esac
MOCK
  cat > "${ROOT}/bin/pm2" <<'MOCK'
#!/usr/bin/env bash
[[ "$1" == "start" ]] && echo activated >> "${ROOT}/state/pm2-activations"
exit 0
MOCK
  # The candidate is unreachable while the flag exists, so the readiness loop in
  # verify_release_standalone keeps polling and the worker stays interruptible.
  cat > "${ROOT}/bin/curl" <<'MOCK'
#!/usr/bin/env bash
[[ -f "${ROOT}/state/not-ready" ]] && exit 7
exit 0
MOCK
  printf '#!/usr/bin/env bash\nexit 0\n' > "${ROOT}/bin/flock"
  printf '#!/usr/bin/env bash\nexit 0\n' > "${ROOT}/bin/id"
  cat > "${ROOT}/bin/sudo" <<'MOCK'
#!/usr/bin/env bash
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  [[ "${args[i]}" == "true" ]] && exit 0
  if [[ "${args[i]}" == "test" ]]; then exec "${args[@]:i}"; fi
done
exit 0
MOCK
  cat > "${ROOT}/bin/node" <<MOCK
#!/usr/bin/env bash
for a in "\$@"; do
  if [[ "\${a}" == "-e" ]]; then exec "${REAL_NODE}" "\$@"; fi
done
exit 0
MOCK
  chmod +x "${ROOT}/bin/"*

  git init -q --bare "${ROOT}/origin"
  git clone -q "${ROOT}/origin" "${ROOT}/controller" 2>/dev/null
  ( cd "${ROOT}/controller"
    git config user.email t@example.com; git config user.name Test
    git symbolic-ref HEAD refs/heads/main
    mkdir -p scripts/deployment
    cp "${REPO_ROOT}/scripts/deployment/release-lib.sh" scripts/deployment/
    cp "${REPO_ROOT}/scripts/deployment/verify-release.mjs" scripts/deployment/
    echo '{"name":"fx","scripts":{"build":"next build","start":"next start"}}' > package.json
    printf '.next/\nnode_modules/\n' > .gitignore
    git add -A && git commit -qm base && git push -q origin main 2>/dev/null ) >/dev/null 2>&1
  # An existing in-place serving build, which is what gets preserved.
  mkdir -p "${ROOT}/controller/node_modules" "${ROOT}/controller/.next/static/chunks"
  printf 'baseline-asset' > "${ROOT}/controller/.next/static/chunks/baseline.css"
}

run_baseline_worker_bg() {
  # `exec` so $! is the worker itself; signalling a wrapper would never reach it.
  ( cd "${ROOT}/controller" && exec env PATH="${ROOT}/bin:${PATH}" \
    DEPLOY_PROJECT_DIR="${ROOT}/controller" DEPLOY_RELEASE_ROOT="${DEPLOY_RELEASE_ROOT}" \
    DEPLOY_ASSET_STORE="${DEPLOY_ASSET_STORE}" DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR}" \
    DEPLOY_LOCK_PATH="${ROOT}/state/lock" DEPLOY_CONFIG_FILE="${DEPLOY_CONFIG_FILE}" \
    DEPLOY_CANDIDATE_PORT=39811 \
    bash "${REPO_ROOT}/do-pull.sh" ) > "${ROOT}/state/baseline-worker.log" 2>&1 &
  BG_WORKER=$!
}

baseline_fixture
touch "${ROOT}/state/not-ready"
run_baseline_worker_bg
# Wait for the baseline candidate to be launched and recorded.
BASE_PGID=""; BASE_NAME=""
for _ in $(seq 1 200); do
  f="$(ls "${DEPLOY_RELEASE_ROOT}"/*-baseline/.candidate.pgid 2>/dev/null | head -1 || true)"
  if [[ -n "${f}" && -s "${f}" ]]; then
    BASE_PGID="$(cat "${f}")"; BASE_NAME="$(basename "$(dirname "${f}")")"; break
  fi
  sleep 0.1
done
expect "the baseline candidate was launched" "$([ -n "${BASE_PGID}" ] && echo yes || echo no)" "yes"
# The fixture owns these PIDs itself, so a failure here never leaves strays.
for m in $({ pgrep -g "${BASE_PGID}" || true; }); do OWNED_PIDS+=("${m}"); done
expect "its process group is alive before the interruption" \
  "$([ -n "$({ pgrep -g "${BASE_PGID}" || true; })" ] && echo yes || echo no)" "yes"

kill -TERM "${BG_WORKER}" 2>/dev/null || true
BASE_STATUS=0
wait "${BG_WORKER}" 2>/dev/null || BASE_STATUS=$?
sleep 1
BASE_OUT="$(cat "${ROOT}/state/baseline-worker.log")"

expect "the interrupted worker failed" "$([ "${BASE_STATUS}" -ne 0 ] && echo failed || echo passed)" "failed"
expect_contains "the cleanup handler names the baseline it owns" \
  "stopping owned candidate ${BASE_NAME}" "${BASE_OUT}"
expect_contains "the baseline cleanup was proven, not assumed" "cleanup proven; releasing ownership" "${BASE_OUT}"
expect_contains "the phase is attributable" "interrupted during baseline" "${BASE_OUT}"
expect_contains "the original service is reported untouched" "serving release was never disturbed" "${BASE_OUT}"
expect "no process of the baseline group survives" \
  "$([ -z "$({ pgrep -g "${BASE_PGID}" || true; })" ] && echo none || echo survivors)" "none"
expect "the candidate port was released" \
  "$(lsof -nP -iTCP:39811 -sTCP:LISTEN >/dev/null 2>&1 && echo held || echo free)" "free"
expect "no unresolved-cleanup marker was left" \
  "$(ls "${DEPLOY_RELEASE_ROOT}"/*/.cleanup-unresolved 2>/dev/null | wc -l | tr -d ' ')" "0"
expect "nothing was activated" "$(test -f "${DEPLOY_STATE_DIR}/pm2-activations" && echo yes || echo no)" "no"
expect "no release was recorded as current" "$(test -f "${DEPLOY_STATE_DIR}/current" && echo yes || echo no)" "no"

# A retry must reuse the preserved baseline and now complete.
rm -f "${ROOT}/state/not-ready"
RETRY2_STATUS=0
RETRY2_OUT="$( ( cd "${ROOT}/controller" && PATH="${ROOT}/bin:${PATH}" \
  DEPLOY_PROJECT_DIR="${ROOT}/controller" DEPLOY_RELEASE_ROOT="${DEPLOY_RELEASE_ROOT}" \
  DEPLOY_ASSET_STORE="${DEPLOY_ASSET_STORE}" DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR}" \
  DEPLOY_LOCK_PATH="${ROOT}/state/lock" DEPLOY_CONFIG_FILE="${DEPLOY_CONFIG_FILE}" \
  DEPLOY_CANDIDATE_PORT=39811 bash "${REPO_ROOT}/do-pull.sh" ) 2>&1 )" || RETRY2_STATUS=$?
expect "the retry after a clean interruption succeeds" "${RETRY2_STATUS}" "0"
expect_contains "the retry reuses the preserved baseline" "Reusing the preserved baseline" "${RETRY2_OUT}"
expect_contains "the retry activates a release" "Deployment worker completed" "${RETRY2_OUT}"
cleanup

# ---------------------------------------------------------------------------
echo "F8. ownership evidence from an earlier attempt is never overwritten"

guard_fixture() { # guard_fixture -> a release with a recorded owned process
  new_fixture
  mkdir -p "${ROOT}/bin"
  cat > "${ROOT}/bin/npm" <<'MOCK'
#!/usr/bin/env bash
case "$1" in start) echo started >> "${ROOT}/npm-start-calls"; exec sleep 120 ;; esac
exit 0
MOCK
  chmod +x "${ROOT}/bin/npm"
  make_release guarded
}

# --- a LIVE process from an earlier attempt must block a new launch ---
guard_fixture
sleep 300 & STRAY=$!
OWNED_PIDS+=("${STRAY}")
PATH="${ROOT}/bin:${PATH}" DEPLOY_CANDIDATE_PORT=39821 bash -c '
  source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
  record_owned_process "guarded" "'"${STRAY}"'"
' >/dev/null 2>&1
BEFORE="$(shasum -a 256 "${DEPLOY_RELEASE_ROOT}/guarded/.candidate.owned" | cut -d' ' -f1)"
GUARD_STATUS=0
GUARD_OUT="$(PATH="${ROOT}/bin:${PATH}" DEPLOY_CANDIDATE_PORT=39821 bash -c '
  source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
  start_candidate "guarded"
' 2>&1)" || GUARD_STATUS=$?
expect "start_candidate refuses while an earlier process is alive" \
  "$([ "${GUARD_STATUS}" -ne 0 ] && echo refused || echo started)" "refused"
expect_contains "the refusal names the surviving process" "still owns process(es) from an earlier attempt" "${GUARD_OUT}"
expect "durable unresolved evidence is written" \
  "$(test -f "${DEPLOY_RELEASE_ROOT}/guarded/.cleanup-unresolved" && echo yes || echo no)" "yes"
expect "the ownership record is not overwritten" \
  "$(shasum -a 256 "${DEPLOY_RELEASE_ROOT}/guarded/.candidate.owned" | cut -d' ' -f1)" "${BEFORE}"
# The guard returns before the spawn, so the absence of a pid record is
# deterministic rather than a race against a detached child.
expect "no replacement candidate was recorded" \
  "$(test -f "${DEPLOY_RELEASE_ROOT}/guarded/.candidate.pid" && echo yes || echo no)" "no"
sleep 1
expect "no replacement candidate was started" \
  "$(test -f "${ROOT}/npm-start-calls" && echo yes || echo no)" "no"
kill -KILL "${STRAY}" 2>/dev/null || true
cleanup

# --- a record naming only DEAD processes must not block anything ---
guard_fixture
# Recorded while alive, then allowed to exit on its own -- killing it here
# would only add job-control noise.
sleep 1 & DEAD=$!
PATH="${ROOT}/bin:${PATH}" DEPLOY_CANDIDATE_PORT=39822 bash -c '
  source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
  record_owned_process "guarded" "'"${DEAD}"'"
' >/dev/null 2>&1
wait "${DEAD}" 2>/dev/null || true
OK_STATUS=0
PATH="${ROOT}/bin:${PATH}" DEPLOY_CANDIDATE_PORT=39822 bash -c '
  source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
  start_candidate "guarded"
' >/dev/null 2>&1 || OK_STATUS=$?
NEWPID="$(cat "${DEPLOY_RELEASE_ROOT}/guarded/.candidate.pid" 2>/dev/null || echo 0)"
OWNED_PIDS+=("${NEWPID}")
expect "a stale record of dead processes does not block a launch" "${OK_STATUS}" "0"
for _ in $(seq 1 50); do [[ -f "${ROOT}/npm-start-calls" ]] && break; sleep 0.1; done
expect "a replacement candidate really started" \
  "$(test -f "${ROOT}/npm-start-calls" && echo yes || echo no)" "yes"
expect "no unresolved marker was written for a dead record" \
  "$(test -f "${DEPLOY_RELEASE_ROOT}/guarded/.cleanup-unresolved" && echo yes || echo no)" "no"
cleanup

echo "F9. timing overrides remain finite, positive, and related"
timing_status=0
timing_out="$(DEPLOY_RECOVERY_READY_SECONDS=12 DEPLOY_VERIFY_TOTAL_TIMEOUT_MS=20000 DEPLOY_KILL_GRACE_MS=30000 bash -c '
  source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
  validate_timing_configuration
' 2>&1)" || timing_status=$?
expect "a grace period that cannot contain readiness and verification is refused" "$([ "${timing_status}" -ne 0 ] && echo refused || echo accepted)" "refused"
expect_contains "the invalid relationship is reported" "must exceed readiness" "${timing_out}"
timing_status=0
timing_out="$(DEPLOY_VERIFY_TOTAL_TIMEOUT_MS=0 bash -c '
  source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
  validate_timing_configuration
' 2>&1)" || timing_status=$?
expect "a zero verifier deadline is refused" "$([ "${timing_status}" -ne 0 ] && echo refused || echo accepted)" "refused"
expect_contains "the verifier override error is explicit" "must be a finite positive integer" "${timing_out}"

printf '\n%s passed, %s failed\n' "${PASS}" "${FAIL}"
[[ "${FAIL}" -eq 0 ]]
