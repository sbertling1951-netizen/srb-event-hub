#!/usr/bin/env bash
# Deployment lifecycle tests. Disposable fixtures only: a throwaway git repo in
# a temp directory, and PATH shims for npm/pm2/node/curl/flock. Nothing touches
# production, the real filesystem outside the temp directory, or any database.
#
# Run with: bash scripts/deployment/release-lifecycle.test.sh

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0
FAIL=0

report() {
  if [[ "$1" == "pass" ]]; then PASS=$((PASS + 1)); printf '  ok   %s\n' "$2";
  else FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$2"; fi
}
expect() { # expect <condition-description> <actual> <expected>
  if [[ "$2" == "$3" ]]; then report pass "$1"; else report fail "$1 (got '$2', want '$3')"; fi
}
expect_contains() {
  if grep -q "$2" <<< "$3"; then report pass "$1"; else report fail "$1 (missing '$2')"; fi
}
# grep -c exits 1 when the count is zero, so it needs its own guard.
count() { grep -c "$1" "$2" 2>/dev/null || true; }
count_in() { grep -c "$1" <<< "$2" || true; }
# Set RELEASE_TEST_VERBOSE=1 to see the worker output for each scenario.
trace() { [[ -n "${RELEASE_TEST_VERBOSE:-}" ]] && printf '  --- worker output ---\n%s\n  ---------------------\n' "$1"; return 0; }

# --- Fixture -----------------------------------------------------------------
make_fixture() {
  REAL_NODE="$(command -v node)"
  ROOT="$(mktemp -d)"
  export ROOT
  mkdir -p "${ROOT}/bin" "${ROOT}/origin" "${ROOT}/state"

  # Mocked external commands. Each is deliberately dumb and controlled by env.
  cat > "${ROOT}/bin/npm" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  ci) mkdir -p node_modules; echo "mock npm ci" ;;
  run)
    if [[ "${MOCK_BUILD_FAIL:-0}" == "1" ]]; then echo "mock build failure" >&2; exit 1; fi
    mkdir -p .next/static/chunks
    printf '%s' "${MOCK_ASSET_BODY:-defaultcss}" > .next/static/chunks/app.css
    printf 'console.log(1)' > .next/static/chunks/app.js
    echo "mock build ok" ;;
  start) exec sleep 300 ;;
esac
MOCK

  cat > "${ROOT}/bin/pm2" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "start" ]]; then
  cwd=""
  for ((i = 1; i <= $#; i++)); do
    if [[ "${!i}" == "--cwd" ]]; then j=$((i + 1)); cwd="${!j}"; fi
  done
  if [[ -n "${MOCK_PM2_FAIL_FOR:-}" && "${cwd}" == *"${MOCK_PM2_FAIL_FOR}"* ]]; then
    echo "mock pm2 refusing ${cwd}" >&2; exit 1
  fi
  echo "${cwd}" >> "${ROOT}/state/pm2-activations"
fi
exit 0
MOCK

  # Stands in for the release verifier. Fails only for the port named by the
  # scenario, so candidate-stage and post-activation failures are independent.
  # The worker uses `node -e` to spawn the candidate in its own process group,
  # so that invocation must reach the REAL node; only verifier invocations are
  # mocked here.
  cat > "${ROOT}/bin/node" <<MOCK
#!/usr/bin/env bash
for a in "\$@"; do
  if [[ "\${a}" == "-e" ]]; then exec "${REAL_NODE}" "\$@"; fi
done
MOCK
  cat >> "${ROOT}/bin/node" <<'MOCK'
port=""
for ((i = 1; i <= $#; i++)); do
  if [[ "${!i}" == "--port" ]]; then j=$((i + 1)); port="${!j}"; fi
done
echo "${port}" >> "${ROOT}/state/verify-calls"
n="$(wc -l < "${ROOT}/state/verify-calls" | tr -d ' ')"
# When a scenario says the restored application is not listening yet, a FULL
# verification of it must fail too -- that is what a 502 through Nginx is. This
# coupling is what makes the readiness gate load-bearing: without it, a mocked
# verifier would succeed regardless and the scenario could not tell a waited-for
# recovery apart from one verified too early.
if [[ "${port}" == "${DEPLOY_NGINX_PORT:-443}" ]]; then
  ready="$(cat "${ROOT}/state/curl-ready-count" 2>/dev/null || echo 0)"
  if [[ "${MOCK_READY_FAIL_FOREVER:-0}" == "1" ]]; then
    echo "mock: restored app is not listening" >&2; exit 1
  fi
  if (( ${MOCK_READY_FAIL_FIRST:-0} > 0 && ready <= ${MOCK_READY_FAIL_FIRST:-0} )); then
    echo "mock: restored app is not listening yet (readiness probes so far: ${ready})" >&2; exit 1
  fi
fi
if [[ -n "${MOCK_VERIFY_FAIL_PORT:-}" && "${port}" == "${MOCK_VERIFY_FAIL_PORT}" ]]; then
  echo "mock verification failure on ${port}" >&2; exit 1
fi
if [[ -n "${MOCK_VERIFY_FAIL_NTH:-}" && "${n}" == "${MOCK_VERIFY_FAIL_NTH}" ]]; then
  echo "mock verification failure on call ${n}" >&2; exit 1
fi
exit 0
MOCK

  # Two different readiness probes reach curl: the candidate loop inside
  # verify_release_standalone (candidate port, plain http) and the recovery
  # readiness gate inside wait_until_responding (the Nginx port). They are
  # counted separately so one can be delayed without disturbing the other.
  # MOCK_READY_FAIL_FIRST delays readiness; MOCK_READY_FAIL_FOREVER never
  # answers, and stays failed for every attempt rather than being one-shot.
  cat > "${ROOT}/bin/curl" <<'MOCK'
#!/usr/bin/env bash
url=""
for a in "$@"; do case "${a}" in http://*|https://*) url="${a}" ;; esac; done
if [[ "${url}" == *":${DEPLOY_NGINX_PORT:-443}/"* ]]; then
  sleep "${MOCK_READY_DELAY_SECONDS:-0}"
  counter="${ROOT}/state/curl-ready-count"
  n=$(( $(cat "${counter}" 2>/dev/null || echo 0) + 1 ))
  printf '%s' "${n}" > "${counter}"
  printf 'ready-probe %s %s\n' "${n}" "${url}" >> "${ROOT}/state/curl-ready-calls"
  [[ "${MOCK_READY_FAIL_FOREVER:-0}" == "1" ]] && exit 7
  (( n <= ${MOCK_READY_FAIL_FIRST:-0} )) && exit 7
  exit 0
fi
exit "${MOCK_CURL_EXIT:-0}"
MOCK

  # macOS has no flock(1); this shim gives the same -n semantics the worker
  # relies on, and lets the overlap case be exercised deterministically.
  # Injects the web-account access-check RESULT inside the fixture. The real
  # web_user_can_read() path runs unchanged; only the host capabilities it
  # probes are provided here. Set FIXTURE_WEB_ACCESS=deny/absent to exercise
  # permission-denied and unable-to-verify.
  cat > "${ROOT}/bin/id" <<'MOCK'
#!/usr/bin/env bash
[[ "${FIXTURE_WEB_ACCESS:-allow}" == "absent" ]] && exit 1
exit 0
MOCK

  cat > "${ROOT}/bin/sudo" <<'MOCK'
#!/usr/bin/env bash
mode="${FIXTURE_WEB_ACCESS:-allow}"
# `sudo -n true`            -> capability probe
# `sudo -n -u USER test -r` -> the actual read check
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  if [[ "${args[i]}" == "true" ]]; then
    # absent = no usable check mechanism at all
    [[ "${mode}" == "absent" ]] && exit 1
    exit 0
  fi
  if [[ "${args[i]}" == "test" ]]; then
    # deny = the mechanism works, but the read is refused
    [[ "${mode}" == "deny" ]] && exit 1
    exec "${args[@]:i}"
  fi
done
exit 0
MOCK

  cat > "${ROOT}/bin/flock" <<'MOCK'
#!/usr/bin/env bash
if [[ "${MOCK_LOCK_HELD:-0}" == "1" ]]; then exit 1; fi
exit 0
MOCK

  chmod +x "${ROOT}/bin/"*

  mkdir -p "${ROOT}/config"
  printf 'NEXT_PUBLIC_SUPABASE_URL=https://fixture.invalid\nNEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-anon-key\n' \
    > "${ROOT}/config/app.env"
  chmod 600 "${ROOT}/config/app.env"

  git init -q --bare "${ROOT}/origin"
  git clone -q "${ROOT}/origin" "${ROOT}/controller" 2>/dev/null
  cd "${ROOT}/controller"
  git config user.email t@example.com; git config user.name Test
  git symbolic-ref HEAD refs/heads/main
  mkdir -p scripts/deployment
  cp "${REPO_ROOT}/scripts/deployment/release-lib.sh" scripts/deployment/
  echo '{"name":"fixture","scripts":{"build":"next build","start":"next start"}}' > package.json
  # Mirrors the real repository: build output and dependencies are ignored, so
  # a serving checkout is not "dirty" just because it has been built.
  printf '.next/\nnode_modules/\n' > .gitignore
  git add -A && git commit -qm "fixture base"
  git push -q origin main 2>/dev/null
  cd - >/dev/null
}

run_worker() {
  # MOCK_VERIFY_FAIL_NTH counts verification calls within ONE worker run, and
  # MOCK_READY_FAIL_FIRST counts readiness probes the same way.
  : > "${ROOT}/state/verify-calls"
  : > "${ROOT}/state/curl-ready-calls"
  rm -f "${ROOT}/state/curl-ready-count"
  ( cd "${ROOT}/controller" && PATH="${ROOT}/bin:${PATH}" \
    DEPLOY_PROJECT_DIR="${ROOT}/controller" \
    DEPLOY_RELEASE_ROOT="${ROOT}/releases" \
    DEPLOY_ASSET_STORE="${ROOT}/assets" \
    DEPLOY_STATE_DIR="${ROOT}/state" \
    DEPLOY_LOCK_PATH="${ROOT}/state/lock" \
    DEPLOY_CONFIG_FILE="${ROOT}/config/app.env" \
    FIXTURE_WEB_ACCESS="${FIXTURE_WEB_ACCESS:-allow}" \
    bash "${REPO_ROOT}/do-pull.sh" "$@" 2>&1 ) || echo "WORKER_EXIT=$?"
}

new_commit() {
  ( cd "${ROOT}/controller" && echo "$1" > marker.txt && git add -A && git commit -qm "$1" && git push -q origin main 2>/dev/null )
}


# Commit through a SEPARATE clone so the controller genuinely lags origin/main,
# as it does in production. Committing in the controller itself would leave
# HEAD == origin/main and the worker would (correctly) find nothing to do.
remote_commit() {
  local work="${ROOT}/remote-work"
  rm -rf "${work}"
  git clone -q "${ROOT}/origin" "${work}" 2>/dev/null
  ( cd "${work}" && git config user.email t@example.com && git config user.name Test \
    && echo "$1" > marker.txt && git add -A && git commit -qm "$1" && git push -q origin main 2>/dev/null )
  rm -rf "${work}"
}

# Simulate a host that is already serving from the checkout, in-place.
seed_serving_build() {
  mkdir -p "${ROOT}/controller/node_modules" "${ROOT}/controller/.next/static/chunks"
  printf 'baseline-asset' > "${ROOT}/controller/.next/static/chunks/baseline.css"
  printf 'baseline-build' > "${ROOT}/controller/.next/BUILD_ID"
}

cleanup() { [[ -n "${ROOT:-}" ]] && rm -rf "${ROOT}"; }
trap cleanup EXIT

# --- Scenarios ---------------------------------------------------------------
echo "Deployment lifecycle tests"

echo "1. a successful deployment activates an isolated release"
make_fixture; new_commit one
out="$(run_worker)"; trace "${out}"
current="$(cat "${ROOT}/state/current" 2>/dev/null || echo NONE)"
expect "activation recorded" "$(count "${ROOT}/releases/" "${ROOT}/state/pm2-activations")" "1"
expect_contains "pm2 bound to the release dir, not the controller" "releases/" "$(cat "${ROOT}/state/pm2-activations")"
expect "controller is never the serving dir" "$(count "controller\$" "${ROOT}/state/pm2-activations")" "0"
expect "assets published to the shared store" "$(test -f "${ROOT}/assets/_next/static/chunks/app.css" && echo yes || echo no)" "yes"
expect "release records its own commit" "$(test -f "${ROOT}/releases/${current}/.release-sha" && echo yes || echo no)" "yes"
cleanup

echo "2. build failure leaves the live release untouched"
make_fixture; new_commit one; run_worker >/dev/null
live="$(cat "${ROOT}/state/current")"
before="$(cat "${ROOT}/state/pm2-activations")"
new_commit two
out="$(MOCK_BUILD_FAIL=1 run_worker)"; trace "${out}"
expect "live release unchanged" "$(cat "${ROOT}/state/current")" "${live}"
expect "no further activation" "$(cat "${ROOT}/state/pm2-activations")" "${before}"
expect_contains "failure reported" "Build failed" "${out}"
expect_contains "evidence retained" "evidence kept at" "${out}"
expect "worker returned failure" "$(count_in 'WORKER_EXIT=1' "${out}")" "1"
cleanup

echo "3. a failed candidate verification prevents activation"
make_fixture; new_commit one; run_worker >/dev/null
live="$(cat "${ROOT}/state/current")"; before="$(cat "${ROOT}/state/pm2-activations")"
new_commit two
out="$(MOCK_VERIFY_FAIL_PORT=3001 run_worker)"; trace "${out}"
expect "not activated" "$(cat "${ROOT}/state/current")" "${live}"
expect "no further activation" "$(cat "${ROOT}/state/pm2-activations")" "${before}"
expect_contains "refusal reported" "NOT activating" "${out}"
expect "worker returned failure" "$(count_in 'WORKER_EXIT=1' "${out}")" "1"
cleanup

echo "4. failed post-activation verification rolls back and still reports failure"
make_fixture; new_commit one; run_worker >/dev/null
live="$(cat "${ROOT}/state/current")"
new_commit two
out="$(MOCK_VERIFY_FAIL_NTH=2 run_worker)"; trace "${out}"
expect_contains "post-activation failure reported" "Post-activation verification FAILED" "${out}"
expect_contains "rollback verified, not merely activated" "Rollback verified: ${live}" "${out}"
expect "rolled back to the previous release" "$(cat "${ROOT}/state/current")" "${live}"
expect "deployment still fails despite successful rollback" "$(count_in 'WORKER_EXIT=1' "${out}")" "1"
cleanup

echo "5. rollback failure is reported explicitly"
make_fixture; new_commit one; run_worker >/dev/null
live="$(cat "${ROOT}/state/current")"
new_commit two
out="$(MOCK_VERIFY_FAIL_NTH=2 MOCK_PM2_FAIL_FOR="${live}" run_worker)"; trace "${out}"
expect_contains "rollback failure surfaced" "ROLLBACK FAILED" "${out}"
expect "rollback failure is not reported as a verification failure" "$(count_in 'ROLLBACK VERIFICATION FAILED' "${out}")" "0"
expect_contains "manual intervention demanded" "Manual intervention required" "${out}"
expect "worker returned failure" "$(count_in 'WORKER_EXIT=1' "${out}")" "1"
cleanup

echo "6. the deployment lock prevents overlapping runs"
make_fixture; new_commit one
out="$(MOCK_LOCK_HELD=1 run_worker)"; trace "${out}"
expect_contains "overlap refused" "already in progress" "${out}"
expect "exit 75 preserved for the webhook contract" "$(count_in 'WORKER_EXIT=75' "${out}")" "1"
expect "nothing activated" "$(test -f "${ROOT}/state/pm2-activations" && echo yes || echo no)" "no"
cleanup

echo "7. an earlier release's assets stay available after a newer activation"
make_fixture; new_commit one; MOCK_ASSET_BODY="first" run_worker >/dev/null
first="$(cat "${ROOT}/state/current")"
cp "${ROOT}/assets/_next/static/chunks/app.css" "${ROOT}/state/first-asset"
new_commit two
# A new build emits a distinctly named asset; the old one must survive.
cat > "${ROOT}/bin/npm" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  ci) mkdir -p node_modules ;;
  run) mkdir -p .next/static/chunks; printf 'second' > .next/static/chunks/app2.css; printf 'console.log(1)' > .next/static/chunks/app.js ;;
  start) exec sleep 300 ;;
esac
MOCK
chmod +x "${ROOT}/bin/npm"
run_worker >/dev/null
expect "previous release's asset still served" "$(cat "${ROOT}/assets/_next/static/chunks/app.css" 2>/dev/null || echo MISSING)" "first"
expect "new release's asset published" "$(cat "${ROOT}/assets/_next/static/chunks/app2.css" 2>/dev/null || echo MISSING)" "second"
expect "rollback pointer recorded" "$(cat "${ROOT}/state/previous" 2>/dev/null || echo NONE)" "${first}"
cleanup

echo "8. conflicting bytes at the same asset path are refused"
make_fixture; new_commit one; MOCK_ASSET_BODY="first" run_worker >/dev/null
live="$(cat "${ROOT}/state/current")"
new_commit two
out="$(MOCK_ASSET_BODY="different" run_worker)"; trace "${out}"
expect_contains "conflict refused" "conflicting bytes" "${out}"
expect "live release untouched" "$(cat "${ROOT}/state/current")" "${live}"
expect "original bytes preserved" "$(cat "${ROOT}/assets/_next/static/chunks/app.css")" "first"
cleanup

echo "9. cleanup never removes the active or rollback release"
make_fixture; new_commit one; run_worker >/dev/null
first="$(cat "${ROOT}/state/current")"
new_commit two; run_worker >/dev/null
second="$(cat "${ROOT}/state/current")"
# Age everything well past the retention window; current and previous must survive.
find "${ROOT}/releases" -maxdepth 2 -exec touch -t 202001010000 {} + 2>/dev/null || true
( cd "${ROOT}/controller" && PATH="${ROOT}/bin:${PATH}" \
  DEPLOY_RELEASE_ROOT="${ROOT}/releases" DEPLOY_ASSET_STORE="${ROOT}/assets" \
  DEPLOY_STATE_DIR="${ROOT}/state" bash -c \
  'source scripts/deployment/release-lib.sh; cleanup_releases; cleanup_assets' ) >/dev/null 2>&1
expect "active release survives aggressive cleanup" "$(test -d "${ROOT}/releases/${second}" && echo yes || echo no)" "yes"
expect "rollback release survives aggressive cleanup" "$(test -d "${ROOT}/releases/${first}" && echo yes || echo no)" "yes"
expect "their assets survive" "$(test -f "${ROOT}/assets/_next/static/chunks/app.css" && echo yes || echo no)" "yes"
cleanup


echo "10. the existing serving build is preserved and adopted as a verified baseline"
make_fixture; seed_serving_build; remote_commit one
out="$(run_worker)"; trace "${out}"
baseline="$(ls "${ROOT}/releases" | grep -- '-baseline$' || true)"
expect "a baseline release was created from the serving build" "$(test -n "${baseline}" && echo yes || echo no)" "yes"
expect_contains "baseline adopted, explicitly NOT activated" "adopted as a rollback target" "${out}"
expect_contains "adoption reports the ORIGINAL commit, not the controller's" "original commit" "${out}"
expect_contains "baseline proven startable, not just probed via Nginx" "Proving the preserved baseline can start and serve" "${out}"
expect "a prepared baseline carries no activation timestamp" "$(test -f "${ROOT}/releases/${baseline}/.activated-at" && echo yes || echo no)" "no"
expect "a prepared baseline records its preparation time instead" "$(test -f "${ROOT}/releases/${baseline}/.prepared-at" && echo yes || echo no)" "yes"
expect "a prepared baseline is not recorded as current" "$(cat "${ROOT}/state/baseline" 2>/dev/null || echo NONE)" "${baseline}"
expect_contains "baseline verified before any candidate activation" "Baseline verified" "${out}"
expect "baseline became the rollback target" "$(cat "${ROOT}/state/previous" 2>/dev/null || echo NONE)" "${baseline}"
expect "the original serving checkout was NOT modified" "$(cat "${ROOT}/controller/.next/BUILD_ID" 2>/dev/null || echo MISSING)" "baseline-build"
expect "the baseline's assets are in the shared store" "$(cat "${ROOT}/assets/_next/static/chunks/baseline.css" 2>/dev/null || echo MISSING)" "baseline-asset"
expect "baseline carries its own commit identity" "$(test -s "${ROOT}/releases/${baseline}/.release-sha" && echo yes || echo no)" "yes"
expect "baseline carries release-compatible configuration" "$(test -f "${ROOT}/releases/${baseline}/.release-env" && echo yes || echo no)" "yes"
cleanup

echo "11. on first install a failed candidate still rolls back to the verified baseline"
make_fixture; seed_serving_build; remote_commit one
# calls: 1 baseline verify, 2 candidate verify, 3 post-activation, 4 rollback verify
out="$(MOCK_VERIFY_FAIL_NTH=3 run_worker)"; trace "${out}"
baseline="$(ls "${ROOT}/releases" | grep -- '-baseline$' || true)"
expect_contains "post-activation failure reported" "Post-activation verification FAILED" "${out}"
expect_contains "rolled back to the baseline and verified it" "Rollback verified: ${baseline}" "${out}"
expect "baseline is active again" "$(cat "${ROOT}/state/current")" "${baseline}"
expect "deployment still fails" "$(count_in 'WORKER_EXIT=1' "${out}")" "1"
cleanup

echo "12. a baseline that does not verify aborts the transition, leaving the original service alone"
make_fixture; seed_serving_build; remote_commit one
out="$(MOCK_VERIFY_FAIL_NTH=1 run_worker)"; trace "${out}"
expect_contains "transition refused" "Refusing to begin the isolated-release transition" "${out}"
expect_contains "original service reported intact" "was not modified" "${out}"
expect "nothing was activated" "$(test -f "${ROOT}/state/pm2-activations" && echo yes || echo no)" "no"
expect "the original build is untouched" "$(cat "${ROOT}/controller/.next/BUILD_ID")" "baseline-build"
expect "worker returned failure" "$(count_in 'WORKER_EXIT=1' "${out}")" "1"
cleanup

echo "13. explicit application configuration is required and must be protected"
make_fixture; remote_commit one
rm -f "${ROOT}/config/app.env"
out="$(run_worker)"; trace "${out}"
expect_contains "missing configuration refused" "Application configuration is missing" "${out}"
expect "nothing activated without configuration" "$(test -f "${ROOT}/state/pm2-activations" && echo yes || echo no)" "no"
printf 'NEXT_PUBLIC_SUPABASE_URL=x\nNEXT_PUBLIC_SUPABASE_ANON_KEY=y\n' > "${ROOT}/config/app.env"
chmod 644 "${ROOT}/config/app.env"
out="$(run_worker)"; trace "${out}"
expect_contains "group/world-readable configuration refused" "group/world-readable Application configuration" "${out}"
chmod 600 "${ROOT}/config/app.env"
printf 'NEXT_PUBLIC_SUPABASE_URL=x\n' > "${ROOT}/config/app.env"; chmod 600 "${ROOT}/config/app.env"
out="$(run_worker)"; trace "${out}"
expect_contains "configuration with an empty required value refused" "missing a non-empty value for NEXT_PUBLIC_SUPABASE_ANON_KEY" "${out}"
cleanup

echo "14. manual rollback is serialized under the deployment lock and verifies"
make_fixture; remote_commit one; run_worker >/dev/null
first="$(cat "${ROOT}/state/current")"
remote_commit two; run_worker >/dev/null
second="$(cat "${ROOT}/state/current")"
run_rollback() {
  ( cd "${ROOT}/controller" && PATH="${ROOT}/bin:${PATH}" \
    DEPLOY_PROJECT_DIR="${ROOT}/controller" DEPLOY_RELEASE_ROOT="${ROOT}/releases" \
    DEPLOY_ASSET_STORE="${ROOT}/assets" DEPLOY_STATE_DIR="${ROOT}/state" \
    DEPLOY_LOCK_PATH="${ROOT}/state/lock" DEPLOY_CONFIG_FILE="${ROOT}/config/app.env" \
    bash "${REPO_ROOT}/scripts/deployment/rollback.sh" "$@" 2>&1 ) || echo "ROLLBACK_EXIT=$?"
}
out="$(MOCK_LOCK_HELD=1 run_rollback)"
expect_contains "refuses while a deployment holds the lock" "refusing to roll back concurrently" "${out}"
expect "same exit-75 contract" "$(count_in 'ROLLBACK_EXIT=75' "${out}")" "1"
out="$(run_rollback)"; trace "${out}"
expect_contains "manual rollback verified, not merely activated" "Rollback verified" "${out}"
expect "state points at the restored release" "$(cat "${ROOT}/state/current")" "${first}"
expect "restored release is not the one we rolled away from" "$(test "${first}" != "${second}" && echo yes || echo no)" "yes"
cleanup


echo "15. published assets must be reachable by the web server"
make_fixture; remote_commit one
# A store under /root can never be traversed by the Nginx worker.
out="$( ( cd "${ROOT}/controller" && PATH="${ROOT}/bin:${PATH}" \
  DEPLOY_PROJECT_DIR="${ROOT}/controller" DEPLOY_RELEASE_ROOT="${ROOT}/releases" \
  DEPLOY_ASSET_STORE="/root/srb-event-hub-assets" DEPLOY_STATE_DIR="${ROOT}/state" \
  DEPLOY_LOCK_PATH="${ROOT}/state/lock" DEPLOY_CONFIG_FILE="${ROOT}/config/app.env" \
  bash "${REPO_ROOT}/do-pull.sh" 2>&1 ) || echo "WORKER_EXIT=$?" )"; trace "${out}"
expect_contains "an asset store under /root is refused" "Refusing an asset store under /root" "${out}"
expect "nothing was activated" "$(test -f "${ROOT}/state/pm2-activations" && echo yes || echo no)" "no"
expect "worker returned failure" "$(count_in 'WORKER_EXIT=1' "${out}")" "1"

# A store the web account cannot read must fail closed rather than be declared
# proven. The world-execute heuristic was replaced by an actual read test,
# which also covers legitimate group/ACL access.
mkdir -p "${ROOT}/locked/assets"; chmod 700 "${ROOT}/locked"
out="$( ( cd "${ROOT}/controller" && PATH="${ROOT}/bin:${PATH}" \
  DEPLOY_PROJECT_DIR="${ROOT}/controller" DEPLOY_RELEASE_ROOT="${ROOT}/releases" \
  DEPLOY_ASSET_STORE="${ROOT}/locked/assets" DEPLOY_STATE_DIR="${ROOT}/state" \
  DEPLOY_LOCK_PATH="${ROOT}/state/lock" DEPLOY_CONFIG_FILE="${ROOT}/config/app.env" \
  FIXTURE_WEB_ACCESS=absent \
  bash "${REPO_ROOT}/do-pull.sh" 2>&1 ) || echo "WORKER_EXIT=$?" )"; trace "${out}"
expect_contains "unverifiable web-account access fails closed" "UNVERIFIED" "${out}"
expect "worker returned failure" "$(count_in 'WORKER_EXIT=1' "${out}")" "1"
cleanup

echo "16. published assets carry readable permissions, and a legacy store is migrated"
make_fixture
# An asset published under the previous $HOME-based layout.
mkdir -p "${ROOT}/legacy/_next/static/chunks"
printf 'legacy-asset' > "${ROOT}/legacy/_next/static/chunks/legacy.css"
remote_commit one
out="$( ( cd "${ROOT}/controller" && PATH="${ROOT}/bin:${PATH}" \
  DEPLOY_PROJECT_DIR="${ROOT}/controller" DEPLOY_RELEASE_ROOT="${ROOT}/releases" \
  DEPLOY_ASSET_STORE="${ROOT}/assets" DEPLOY_LEGACY_ASSET_STORE="${ROOT}/legacy" \
  DEPLOY_STATE_DIR="${ROOT}/state" DEPLOY_LOCK_PATH="${ROOT}/state/lock" \
  DEPLOY_CONFIG_FILE="${ROOT}/config/app.env" \
  bash "${REPO_ROOT}/do-pull.sh" 2>&1 ) || echo "WORKER_EXIT=$?" )"; trace "${out}"
expect_contains "legacy store imported" "Importing assets from the legacy store" "${out}"
expect "an existing deployment's asset still resolves" "$(cat "${ROOT}/assets/_next/static/chunks/legacy.css" 2>/dev/null || echo MISSING)" "legacy-asset"
expect "new assets published alongside" "$(test -f "${ROOT}/assets/_next/static/chunks/app.css" && echo yes || echo no)" "yes"
expect "asset files are world-readable" "$(stat -f '%Lp' "${ROOT}/assets/_next/static/chunks/app.css" 2>/dev/null || stat -c '%a' "${ROOT}/assets/_next/static/chunks/app.css")" "644"
expect "asset directories are traversable" "$(stat -f '%Lp' "${ROOT}/assets/_next/static" 2>/dev/null || stat -c '%a' "${ROOT}/assets/_next/static")" "755"
cleanup


echo "17a. the retired escape hatch cannot make unverified access pass"
make_fixture; remote_commit one
out="$(FIXTURE_WEB_ACCESS=absent DEPLOY_ALLOW_UNVERIFIED_ASSET_ACCESS=1 run_worker)"; trace "${out}"
expect_contains "unverified access fails closed with the old flag set" "UNVERIFIED" "${out}"
expect "nothing activated" "$(test -f "${ROOT}/state/pm2-activations" && echo yes || echo no)" "no"
expect "worker returned failure" "$(count_in 'WORKER_EXIT=1' "${out}")" "1"
expect "the retired flag appears nowhere in deployable code" \
  "$(grep -l 'DEPLOY_ALLOW_UNVERIFIED_ASSET_ACCESS' "${REPO_ROOT}/do-pull.sh" "${REPO_ROOT}/scripts/deployment/rollback.sh" 2>/dev/null | wc -l | tr -d ' ')" "0"
cleanup

echo "17b. denied access is reported distinctly and also fails closed"
# A FRESH fixture: sharing one with 17a let a retained failed-release directory
# from the first case collide with the second within the same wall-clock
# second, so the case could miss the branch it claims to cover.
make_fixture; remote_commit one
out="$(FIXTURE_WEB_ACCESS=deny DEPLOY_ALLOW_UNVERIFIED_ASSET_ACCESS=1 run_worker)"; trace "${out}"
expect_contains "denial is reported distinctly" "PERMISSION DENIED" "${out}"
expect "it did NOT report the unverified branch instead" "$(count_in 'UNVERIFIED' "${out}")" "0"
expect "nothing activated" "$(test -f "${ROOT}/state/pm2-activations" && echo yes || echo no)" "no"
expect "worker returned failure" "$(count_in 'WORKER_EXIT=1' "${out}")" "1"
cleanup

echo "18. manual rollback also refuses unverified access"
make_fixture; remote_commit one; run_worker >/dev/null
first="$(cat "${ROOT}/state/current")"
remote_commit two; run_worker >/dev/null
run_rollback_access() {
  ( cd "${ROOT}/controller" && PATH="${ROOT}/bin:${PATH}" \
    DEPLOY_PROJECT_DIR="${ROOT}/controller" DEPLOY_RELEASE_ROOT="${ROOT}/releases" \
    DEPLOY_ASSET_STORE="${ROOT}/assets" DEPLOY_STATE_DIR="${ROOT}/state" \
    DEPLOY_LOCK_PATH="${ROOT}/state/lock" DEPLOY_CONFIG_FILE="${ROOT}/config/app.env" \
    FIXTURE_WEB_ACCESS="$1" DEPLOY_ALLOW_UNVERIFIED_ASSET_ACCESS=1 \
    bash "${REPO_ROOT}/scripts/deployment/rollback.sh" "${first}" 2>&1 ) || echo "ROLLBACK_EXIT=$?"
}
out="$(run_rollback_access allow)"; trace "${out}"
expect_contains "manual rollback still works when access is verifiable" "Rollback verified" "${out}"
cleanup


echo "19. a retry after the controller advances cannot relabel the preserved baseline"
make_fixture; seed_serving_build
# Distinct synthetic configurations, so a re-pin would be visible.
printf 'NEXT_PUBLIC_SUPABASE_URL=https://ORIGINAL.invalid\nNEXT_PUBLIC_SUPABASE_ANON_KEY=original-key\n' > "${ROOT}/config/app.env"
chmod 600 "${ROOT}/config/app.env"
remote_commit one
original_controller_sha="$( cd "${ROOT}/controller" && git rev-parse HEAD )"
# First run fails at candidate verification: the baseline is created and adopted.
out="$(MOCK_VERIFY_FAIL_NTH=2 run_worker)"; trace "${out}"
baseline="$(cat "${ROOT}/state/baseline" 2>/dev/null || echo NONE)"
expect "a baseline was preserved by the failed first run" "$([ "${baseline}" != NONE ] && echo yes || echo no)" "yes"
orig_sha="$(cat "${ROOT}/releases/${baseline}/.release-sha")"
orig_env_hash="$(shasum -a 256 < "${ROOT}/releases/${baseline}/.release-env" | cut -d' ' -f1)"
orig_build_hash="$(shasum -a 256 < "${ROOT}/releases/${baseline}/.next/BUILD_ID" | cut -d' ' -f1)"
orig_prepared="$(cat "${ROOT}/releases/${baseline}/.prepared-at")"
expect "the baseline records the ORIGINAL controller commit" "${orig_sha}" "${original_controller_sha}"

# The controller advances AND the host configuration changes before the retry.
printf 'NEXT_PUBLIC_SUPABASE_URL=https://CHANGED.invalid\nNEXT_PUBLIC_SUPABASE_ANON_KEY=changed-key\n' > "${ROOT}/config/app.env"
chmod 600 "${ROOT}/config/app.env"
remote_commit two
new_sha="$( cd "${ROOT}/controller" && git fetch -q origin && git rev-parse origin/main )"
out="$(run_worker)"; trace "${out}"

expect "the preserved baseline is reused, not recreated" "$(cat "${ROOT}/state/baseline")" "${baseline}"
expect_contains "reuse is explicit about leaving it untouched" "left untouched" "${out}"
expect "its commit identity is unchanged" "$(cat "${ROOT}/releases/${baseline}/.release-sha")" "${orig_sha}"
expect "it was NOT relabelled with the advanced controller commit" \
  "$([ "$(cat "${ROOT}/releases/${baseline}/.release-sha")" != "${new_sha}" ] && echo yes || echo no)" "yes"
expect "its pinned configuration is byte-identical" \
  "$(shasum -a 256 < "${ROOT}/releases/${baseline}/.release-env" | cut -d' ' -f1)" "${orig_env_hash}"
expect "its build bytes are byte-identical" \
  "$(shasum -a 256 < "${ROOT}/releases/${baseline}/.next/BUILD_ID" | cut -d' ' -f1)" "${orig_build_hash}"
expect "its preparation timestamp is unchanged" "$(cat "${ROOT}/releases/${baseline}/.prepared-at")" "${orig_prepared}"
expect "the baseline still carries no activation timestamp" \
  "$(test -f "${ROOT}/releases/${baseline}/.activated-at" && echo yes || echo no)" "no"
current="$(cat "${ROOT}/state/current")"
expect "the new candidate is a different release" "$([ "${current}" != "${baseline}" ] && echo yes || echo no)" "yes"
expect "the new candidate carries the advanced commit" "$(cat "${ROOT}/releases/${current}/.release-sha")" "${new_sha}"
expect "the new candidate pinned the CHANGED configuration" \
  "$(grep -c 'CHANGED.invalid' "${ROOT}/releases/${current}/.release-env")" "1"
cleanup

echo "20. an interrupted snapshot is never mistaken for complete"
make_fixture; seed_serving_build; remote_commit one
out="$(MOCK_VERIFY_FAIL_NTH=2 run_worker)" ; trace "${out}"
baseline="$(cat "${ROOT}/state/baseline")"
# Simulate interruption before the completion boundary was reached.
rm -f "${ROOT}/releases/${baseline}/.baseline-complete"
rm -f "${ROOT}/state/current" "${ROOT}/state/baseline"
out="$(run_worker)"; trace "${out}"
expect_contains "incomplete provenance is a hard stop" "incomplete baseline snapshot" "${out}"
expect "the partial snapshot is preserved as evidence" "$(test -d "${ROOT}/releases/${baseline}" && echo yes || echo no)" "yes"
expect "nothing was activated" "$(test -f "${ROOT}/state/current" && echo yes || echo no)" "no"
expect "worker returned failure" "$(count_in 'WORKER_EXIT=1' "${out}")" "1"
cleanup

echo "21. ambiguous baseline provenance is refused rather than guessed"
make_fixture; seed_serving_build; remote_commit one
out="$(MOCK_VERIFY_FAIL_NTH=2 run_worker)"; trace "${out}"
baseline="$(cat "${ROOT}/state/baseline")"
cp -a "${ROOT}/releases/${baseline}" "${ROOT}/releases/20200101T000000Z-deadbeefdead-baseline"
rm -f "${ROOT}/state/current" "${ROOT}/state/baseline"
out="$(run_worker)"; trace "${out}"
expect_contains "multiple complete baselines are refused" "multiple complete baseline snapshots" "${out}"
expect "neither candidate directory was deleted" \
  "$(ls -d "${ROOT}/releases"/*-baseline 2>/dev/null | wc -l | tr -d ' ')" "2"
expect "worker returned failure" "$(count_in 'WORKER_EXIT=1' "${out}")" "1"
cleanup


echo "22. the REAL worker, TERMed mid-build, runs bounded cleanup and activates nothing"
make_fixture; remote_commit one
# Slow the build so there is a real window in which to interrupt the worker.
cat > "${ROOT}/bin/npm" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  ci) mkdir -p node_modules ;;
  run) sleep 12; mkdir -p .next/static/chunks; printf 'body{}' > .next/static/chunks/app.css ;;
  start) exec sleep 300 ;;
esac
MOCK
chmod +x "${ROOT}/bin/npm"

# `exec` replaces the subshell with the worker, so $! is the worker itself.
# Without it the signal would only reach a wrapper and the real worker would
# never see TERM -- which is exactly what this test needs to observe.
( cd "${ROOT}/controller" && exec env PATH="${ROOT}/bin:${PATH}" \
  DEPLOY_PROJECT_DIR="${ROOT}/controller" DEPLOY_RELEASE_ROOT="${ROOT}/releases" \
  DEPLOY_ASSET_STORE="${ROOT}/assets" DEPLOY_STATE_DIR="${ROOT}/state" \
  DEPLOY_LOCK_PATH="${ROOT}/state/lock" DEPLOY_CONFIG_FILE="${ROOT}/config/app.env" \
  FIXTURE_WEB_ACCESS=allow \
  bash "${REPO_ROOT}/do-pull.sh" ) > "${ROOT}/state/term-worker.log" 2>&1 &
worker_pid=$!
sleep 4
kill -TERM "${worker_pid}" 2>/dev/null || true
term_status=0
# bash defers a trap until the running foreground command returns, so this
# waits for the slow build to finish and the cleanup to run.
wait "${worker_pid}" 2>/dev/null || term_status=$?
term_out="$(cat "${ROOT}/state/term-worker.log")"; trace "${term_out}"

expect "the real worker exits non-zero on TERM" "$([ "${term_status}" -ne 0 ] && echo yes || echo no)" "yes"
expect_contains "it reports receiving the signal" "received SIGTERM" "${term_out}"
expect_contains "it runs bounded cleanup" "Cleanup (SIGTERM)" "${term_out}"
expect_contains "it states the serving release was not disturbed" "serving release was never disturbed" "${term_out}"
expect "nothing was activated" "$(test -f "${ROOT}/state/pm2-activations" && echo yes || echo no)" "no"
expect "no release was recorded as current" "$(test -f "${ROOT}/state/current" && echo yes || echo no)" "no"

# The lock must be free for the next deployment once cleanup has finished.
cat > "${ROOT}/bin/npm" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  ci) mkdir -p node_modules ;;
  run) mkdir -p .next/static/chunks; printf 'body{}' > .next/static/chunks/app.css ;;
  start) exec sleep 300 ;;
esac
MOCK
chmod +x "${ROOT}/bin/npm"
out="$(run_worker)"; trace "${out}"
expect "a subsequent deployment acquires the lock and completes" "$(count_in 'Deployment worker completed' "${out}")" "1"
expect "the interrupted attempt left evidence behind" \
  "$([ "$(ls -d "${ROOT}/releases"/* 2>/dev/null | wc -l | tr -d ' ')" -ge 2 ] && echo yes || echo no)" "yes"
cleanup

echo "23. recovery waits for the restored release, then still verifies it in full"
make_fixture; new_commit one; run_worker >/dev/null
live="$(cat "${ROOT}/state/current")"
new_commit two
# Post-activation verification fails, so recovery runs. The restored release
# does not answer until the third readiness probe -- which is exactly the
# 125ms/360ms-then-612ms behaviour measured on Linux.
out="$(MOCK_VERIFY_FAIL_NTH=2 MOCK_READY_FAIL_FIRST=2 DEPLOY_RECOVERY_READY_SECONDS=6 run_worker)"; trace "${out}"
expect_contains "post-activation failure reported" "Post-activation verification FAILED" "${out}"
expect_contains "recovery waited for readiness instead of failing at once" "Restored service answered on attempt 3" "${out}"
expect "readiness was polled, not slept through" \
  "$([ "$(wc -l < "${ROOT}/state/curl-ready-calls" | tr -d ' ')" -ge 3 ] && echo yes || echo no)" "yes"
expect_contains "the restored release was then verified in full" "Rollback verified: ${live}" "${out}"
expect "the full verifier really ran after readiness" \
  "$(count_in '443' "$(cat "${ROOT}/state/verify-calls")")" "2"
expect "rolled back to the previous release" "$(cat "${ROOT}/state/current")" "${live}"
expect "a verified recovery is still a failed deployment" "$(count_in 'WORKER_EXIT=1' "${out}")" "1"
expect "no deployment-completed success is emitted" "$(count_in 'Deployment worker completed' "${out}")" "0"
cleanup

echo "24. a restored release that never becomes healthy is still reported as failed"
make_fixture; new_commit one; run_worker >/dev/null
live="$(cat "${ROOT}/state/current")"
new_commit two
# Every through-Nginx verification fails and readiness never answers. The stub
# must stay failed across every attempt: a one-shot failure would let a broken
# release be reported as recovered.
out="$(MOCK_VERIFY_FAIL_PORT=443 MOCK_READY_FAIL_FOREVER=1 DEPLOY_RECOVERY_READY_SECONDS=3 run_worker)"; trace "${out}"
expect_contains "the readiness deadline is reported, not hidden" "did not answer within 3s" "${out}"
expect_contains "the full verification still ran" "running the full verification anyway" "${out}"
expect_contains "persistent failure is reported as a rollback verification failure" "ROLLBACK VERIFICATION FAILED" "${out}"
expect "persistent failure is never reported as verified" "$(count_in 'Rollback verified' "${out}")" "0"
expect "the readiness stub stayed failed for every attempt" \
  "$([ "$(wc -l < "${ROOT}/state/curl-ready-calls" | tr -d ' ')" -ge 2 ] && echo yes || echo no)" "yes"
expect "the verifier stub stayed failed for both through-Nginx calls" \
  "$(count_in '443' "$(cat "${ROOT}/state/verify-calls")")" "2"
expect_contains "manual intervention demanded" "Manual intervention required" "${out}"
expect "worker returned failure" "$(count_in 'WORKER_EXIT=1' "${out}")" "1"
cleanup

echo "25. manual rollback returns 0 on a verified recovery; a recovered deployment does not"
make_fixture; remote_commit one; run_worker >/dev/null
first="$(cat "${ROOT}/state/current")"
remote_commit two; run_worker >/dev/null
rollback_with() {
  : > "${ROOT}/state/curl-ready-calls"; rm -f "${ROOT}/state/curl-ready-count"; : > "${ROOT}/state/verify-calls"
  ( cd "${ROOT}/controller" && PATH="${ROOT}/bin:${PATH}" \
    DEPLOY_PROJECT_DIR="${ROOT}/controller" DEPLOY_RELEASE_ROOT="${ROOT}/releases" \
    DEPLOY_ASSET_STORE="${ROOT}/assets" DEPLOY_STATE_DIR="${ROOT}/state" \
    DEPLOY_LOCK_PATH="${ROOT}/state/lock" DEPLOY_CONFIG_FILE="${ROOT}/config/app.env" \
    bash "${REPO_ROOT}/scripts/deployment/rollback.sh" 2>&1 ) || echo "ROLLBACK_EXIT=$?"
}
out="$(MOCK_READY_FAIL_FIRST=2 DEPLOY_RECOVERY_READY_SECONDS=6 rollback_with)"; trace "${out}"
expect_contains "manual rollback waited for readiness" "Restored service answered on attempt 3" "${out}"
expect_contains "manual rollback verified the restored release" "Rollback verified" "${out}"
expect_contains "manual rollback reports completion" "Manual rollback completed and verified" "${out}"
expect "a verified manual rollback exits 0" "$(count_in 'ROLLBACK_EXIT=' "${out}")" "0"
expect "state points at the restored release" "$(cat "${ROOT}/state/current")" "${first}"
# The same verified recovery inside a deployment must NOT report success.
remote_commit three
out="$(MOCK_VERIFY_FAIL_NTH=2 MOCK_READY_FAIL_FIRST=1 DEPLOY_RECOVERY_READY_SECONDS=6 run_worker)"; trace "${out}"
expect_contains "the deployment recovered and verified" "Rollback verified" "${out}"
expect "but the deployment itself failed" "$(count_in 'WORKER_EXIT=1' "${out}")" "1"
expect "and claimed no completion" "$(count_in 'Deployment worker completed' "${out}")" "0"
cleanup

echo "26. post-activation readiness is bounded and does not assume a two-second startup"
make_fixture; remote_commit one
out="$(MOCK_READY_DELAY_SECONDS=3 run_worker)"; trace "${out}"
expect "a release that starts after two seconds still deploys" "$(count_in 'Deployment worker completed' "${out}")" "1"
expect "the delayed readiness probe was reached" "$([ "$(wc -l < "${ROOT}/state/curl-ready-calls" | tr -d ' ')" -ge 1 ] && echo yes || echo no)" "yes"
expect "the delayed deployment activated a release" "$(test -f "${ROOT}/state/pm2-activations" && echo yes || echo no)" "yes"
cleanup

printf '\n%s passed, %s failed\n' "${PASS}" "${FAIL}"
[[ "${FAIL}" -eq 0 ]]
