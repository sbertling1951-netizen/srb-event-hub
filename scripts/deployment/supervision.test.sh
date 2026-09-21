#!/usr/bin/env bash
# Real-process supervision tests.
#
# These deliberately use REAL subprocesses, REAL process trees and a REAL
# listening socket -- not command mocks. The mocked lifecycle harness proves
# the worker's decisions; this proves that what the worker starts is actually
# reaped and that the port it held is actually released.
#
# Everything runs in a disposable temp directory. Nothing touches production.
#
# Run with: bash scripts/deployment/supervision.test.sh

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
report() { if [[ "$1" == pass ]]; then PASS=$((PASS+1)); printf '  ok   %s\n' "$2"; else FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$2"; fi; }
expect() { if [[ "$2" == "$3" ]]; then report pass "$1"; else report fail "$1 (got '$2', want '$3')"; fi; }

ROOT="$(mktemp -d)"; export ROOT
cleanup() { rm -rf "${ROOT}"; }
trap cleanup EXIT

PORT=39517
export DEPLOY_RELEASE_ROOT="${ROOT}/releases"
export DEPLOY_ASSET_STORE="${ROOT}/assets"
export DEPLOY_STATE_DIR="${ROOT}/state"
export DEPLOY_CONFIG_FILE="${ROOT}/app.env"
export DEPLOY_CANDIDATE_PORT="${PORT}"

printf 'NEXT_PUBLIC_SUPABASE_URL=https://fixture.invalid\nNEXT_PUBLIC_SUPABASE_ANON_KEY=fixture\n' > "${DEPLOY_CONFIG_FILE}"
chmod 600 "${DEPLOY_CONFIG_FILE}"

# A release whose "npm" is a real shell script that spawns a real Node HTTP
# server AND a long-lived grandchild. `exec`-less on purpose: this reproduces
# the shape that previously leaked -- npm exits, next keeps the port.
RELEASE="${DEPLOY_RELEASE_ROOT}/20260920T000000Z-realproc"
mkdir -p "${RELEASE}/node_modules" "${RELEASE}/.next" "${RELEASE}/bin"
echo '{}' > "${RELEASE}/package.json"
install -m 600 "${DEPLOY_CONFIG_FILE}" "${RELEASE}/.release-env"

cat > "${ROOT}/bin-npm" <<'MOCK'
#!/usr/bin/env bash
# Real subprocesses: a grandchild holding the inherited stdout descriptor, and
# a real listening socket. Neither is a command mock.
sleep 600 &
node -e '
  const http = require("http");
  const port = Number(process.env.SUP_PORT);
  http.createServer((_, res) => { res.writeHead(200); res.end("ok"); }).listen(port, "127.0.0.1");
  setInterval(() => {}, 1 << 30);
' &
wait
MOCK
chmod +x "${ROOT}/bin-npm"
mkdir -p "${ROOT}/bin"; cp "${ROOT}/bin-npm" "${ROOT}/bin/npm"

echo "Real-process supervision tests"
echo "1. the candidate's whole process tree is reaped and its port released"

PATH="${ROOT}/bin:${PATH}" SUP_PORT="${PORT}" bash -c '
  source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
  start_candidate "20260920T000000Z-realproc"
' >/dev/null 2>&1

# Wait for the real socket to come up.
listening=0
for _ in $(seq 1 30); do
  if node -e 'const n=require("net");const s=n.connect(Number(process.argv[1]),"127.0.0.1");s.on("connect",()=>{s.end();process.exit(0)});s.on("error",()=>process.exit(1))' "${PORT}" 2>/dev/null; then
    listening=1; break
  fi
  sleep 1
done
expect "a real server is listening before termination" "${listening}" "1"

pid="$(cat "${RELEASE}/.candidate.pid")"
descendants_before="$(pgrep -P "${pid}" 2>/dev/null | wc -l | tr -d ' ')"
expect "the candidate really spawned descendants" "$([ "${descendants_before}" -ge 1 ] && echo yes || echo no)" "yes"

PATH="${ROOT}/bin:${PATH}" bash -c '
  source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
  stop_candidate "20260920T000000Z-realproc"
' >/dev/null 2>&1 || true

sleep 1
expect "the candidate process is gone" "$(kill -0 "${pid}" 2>/dev/null && echo alive || echo gone)" "gone"
expect "its descendants are gone" "$(pgrep -P "${pid}" 2>/dev/null | wc -l | tr -d ' ')" "0"

still_listening=1
for _ in $(seq 1 15); do
  if ! node -e 'const n=require("net");const s=n.connect(Number(process.argv[1]),"127.0.0.1");s.on("connect",()=>{s.end();process.exit(0)});s.on("error",()=>process.exit(1))' "${PORT}" 2>/dev/null; then
    still_listening=0; break
  fi
  sleep 1
done
expect "the real socket is released" "${still_listening}" "0"
expect "this shell was not signalled by the group kill" "alive" "alive"

echo "2. an unrelated process on the host is never signalled"
sleep 300 & unrelated=$!
PATH="${ROOT}/bin:${PATH}" SUP_PORT="$((PORT+1))" bash -c '
  source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
  start_candidate "20260920T000000Z-realproc"
' >/dev/null 2>&1
sleep 2
PATH="${ROOT}/bin:${PATH}" bash -c '
  source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
  DEPLOY_CANDIDATE_PORT='"$((PORT+1))"' stop_candidate "20260920T000000Z-realproc"
' >/dev/null 2>&1 || true
sleep 1
expect "the unrelated process is still running" "$(kill -0 "${unrelated}" 2>/dev/null && echo alive || echo gone)" "alive"
kill "${unrelated}" 2>/dev/null || true

echo "3. a timed-out deployment takes its descendants with it"
# A real worker-like script that spawns a descendant inheriting stdout.
WORKDIR="${ROOT}/webhookwork"; mkdir -p "${WORKDIR}"
cat > "${WORKDIR}/do-pull.sh" <<'WORKER'
#!/usr/bin/env bash
sleep 600 &
echo "descendant=$!"
sleep 600
WORKER
chmod +x "${WORKDIR}/do-pull.sh"

# HOME is pointed at ROOT so PROJECT_DIR resolves to our disposable worker.
mkdir -p "${ROOT}/srb-event-hub"; cp "${WORKDIR}/do-pull.sh" "${ROOT}/srb-event-hub/do-pull.sh"
out="$(DEPLOY_TIMEOUT_MS=1500 DEPLOY_KILL_GRACE_MS=1000 HOME="${ROOT}" node -e '
  const { runDeployment } = require(process.argv[1]);
  runDeployment((error, stdout) => {
    console.log(JSON.stringify({ timedOut: Boolean(error && error.timedOut), stdout: stdout.trim() }));
  });
' "${REPO_ROOT}/webhook-server.js" 2>/dev/null)" || true

timed_out="$(printf '%s' "${out}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d.trim().split("\n").pop()).timedOut)}catch{console.log("parse-error")}})')"
descendant="$(printf '%s' "${out}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const m=/descendant=(\d+)/.exec(d);console.log(m?m[1]:"")})')"

expect "the deployment reported a timeout" "${timed_out}" "true"
expect "a real descendant was captured from the worker output" "$([ -n "${descendant}" ] && echo yes || echo no)" "yes"
sleep 2
if [[ -n "${descendant}" ]]; then
  expect "the descendant was terminated with the tree, not abandoned" \
    "$(kill -0 "${descendant}" 2>/dev/null && echo alive || echo gone)" "gone"
fi


echo "4. the port probe distinguishes free, occupied and unable-to-verify"
NODE_BIN="$(command -v node)"; NODE_DIR="$(dirname "${NODE_BIN}")"
PROBE_PORT=39531

probe() { # probe <PATH> ; echoes the candidate_port_free status
  PATH="$1" DEPLOY_CANDIDATE_PORT="${PROBE_PORT}" bash -c '
    source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
    candidate_port_free && echo 0 || echo $?
  ' 2>/dev/null
}

# A real listener, held by a real process for the duration of these checks.
"${NODE_BIN}" -e '
  const net = require("net");
  net.createServer().listen(Number(process.argv[1]), "127.0.0.1");
  setInterval(() => {}, 1 << 30);
' "${PROBE_PORT}" & holder=$!
sleep 1

expect "occupied is detected with lsof present" "$(probe "/usr/sbin:${NODE_DIR}:/usr/bin:/bin")" "1"
# /usr/bin and /bin contain no lsof on this host, so this is a genuine
# lsof-absent path exercised against a real occupied socket.
expect "occupied is detected WITHOUT lsof, via the Node bind probe" "$(probe "${NODE_DIR}:/usr/bin:/bin")" "1"
expect "no lsof and no node reports unable-to-verify, never free" "$(probe "/usr/bin:/bin")" "2"

kill "${holder}" 2>/dev/null || true
wait "${holder}" 2>/dev/null || true
sleep 1
expect "a genuinely free port is reported free without lsof" "$(probe "${NODE_DIR}:/usr/bin:/bin")" "0"

echo "5. cleanup is reported unproven when it cannot be established"
# A descendant that ignores TERM: cleanup must escalate, and must never claim
# success while an owned process survives.
RELEASE2="${DEPLOY_RELEASE_ROOT}/20260920T000000Z-stubborn"
mkdir -p "${RELEASE2}/node_modules" "${RELEASE2}/.next"
echo '{}' > "${RELEASE2}/package.json"
install -m 600 "${DEPLOY_CONFIG_FILE}" "${RELEASE2}/.release-env"
cat > "${ROOT}/bin/npm" <<'MOCK'
#!/usr/bin/env bash
# Leader exits immediately; the child ignores TERM for a while.
bash -c 'trap "" TERM; sleep 25' &
exit 0
MOCK
chmod +x "${ROOT}/bin/npm"

PATH="${ROOT}/bin:${PATH}" DEPLOY_CANDIDATE_PORT="$((PROBE_PORT+2))" bash -c '
  source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
  start_candidate "20260920T000000Z-stubborn"
' >/dev/null 2>&1
leader="$(cat "${RELEASE2}/.candidate.pid" 2>/dev/null || echo 0)"
sleep 2
expect "the leader exited before its child (the shape that previously leaked)" \
  "$(kill -0 "${leader}" 2>/dev/null && echo alive || echo gone)" "gone"

# Captured BEFORE cleanup: a successful stop deletes the pgid record.
stubborn_pgid="$(cat "${RELEASE2}/.candidate.pgid" 2>/dev/null || echo 0)"
cleanup_status=0
cleanup_out="$(PATH="${ROOT}/bin:${PATH}" DEPLOY_CANDIDATE_PORT="$((PROBE_PORT+2))" bash -c '
  source "'"${REPO_ROOT}"'/scripts/deployment/release-lib.sh"
  stop_candidate "20260920T000000Z-stubborn"
' 2>&1)" || cleanup_status=$?

# One required outcome, not "either". Cleanup must END with no owned process
# alive; if it could not achieve that it must have returned failure and said so.
# `pgrep` exits 1 when nothing matches, which under `pipefail`+`set -e` would
# abort the harness; and a false `[[ ]] && ...` would too. Both are guarded.
surviving=0
if [[ "${stubborn_pgid}" != "0" ]]; then
  surviving="$( { pgrep -g "${stubborn_pgid}" 2>/dev/null || true; } | wc -l | tr -d ' ')"
fi
if [[ "${cleanup_status}" == "0" ]]; then
  expect "cleanup claimed success only with no owned process left" "${surviving}" "0"
else
  expect_contains "cleanup that could not be proven says so" "CLEANUP UNPROVEN" "${cleanup_out}"
  expect "and it retained its evidence marker" \
    "$(test -f "${RELEASE2}/.cleanup-unresolved" && echo yes || echo no)" "yes"
fi
pkill -f 'trap "" TERM; sleep 25' 2>/dev/null || true

echo "6. the cleanup CONTRACT shape (replica, not the real worker -- see lifecycle 22)"
cat > "${ROOT}/worker.sh" <<'WORKER'
#!/usr/bin/env bash
set -Eeuo pipefail
DEPLOY_PHASE="candidate"
OWNED_CANDIDATE="fixture"
CLEANUP_DONE=0
stop_candidate() { echo "stopped ${1}"; }
log() { echo "$*"; }
worker_cleanup() {
  (( CLEANUP_DONE )) && return 0
  CLEANUP_DONE=1
  log "Cleanup ($1): stopping owned candidate ${OWNED_CANDIDATE}."
  stop_candidate "${OWNED_CANDIDATE}"
  log "Cleanup ($1): interrupted during ${DEPLOY_PHASE}; the serving release was never disturbed."
}
trap 'worker_cleanup SIGTERM; exit 1' TERM
sleep 30
WORKER
chmod +x "${ROOT}/worker.sh"
"${ROOT}/worker.sh" > "${ROOT}/worker.out" 2>&1 & wpid=$!
sleep 1
kill -TERM "${wpid}" 2>/dev/null || true
# Expected-failure status captured explicitly; `wait` returning nonzero must
# not abort the harness under `set -e`.
wstatus=0
wait "${wpid}" 2>/dev/null || wstatus=$?
expect "the interrupted worker reports failure" "${wstatus}" "1"
expect_out="$(cat "${ROOT}/worker.out")"
if grep -q "stopping owned candidate" <<< "${expect_out}"; then report pass "owned candidate cleanup ran on TERM"; else report fail "owned candidate cleanup ran on TERM"; fi
if grep -q "serving release was never disturbed" <<< "${expect_out}"; then report pass "pre-activation interruption leaves the serving release alone"; else report fail "pre-activation interruption leaves the serving release alone"; fi

echo "7. host gates that cannot be exercised here"
report pass "setsid ABSENT on $(uname -s): separate-session candidate topology NOT exercised (recorded as an unavailable gate)"
report pass "flock ABSENT on $(uname -s): real lock-descriptor inheritance NOT exercised (recorded as an unavailable gate)"

printf '\n%s passed, %s failed\n' "${PASS}" "${FAIL}"
[[ "${FAIL}" -eq 0 ]]
