#!/usr/bin/env bash
# ===========================================================================
# verify-fresh-replay.sh
#
# Proves the checked-in migration history rebuilds EpicentraX FROM ZERO:
#
#   empty local Supabase database  ->  every supabase/migrations/*.sql  ->  success
#
# This is the permanent regression gate for the "reproducible database
# history" contract (see docs/DATABASE_HISTORY.md). It NEVER touches a
# linked/production project and contains no credentials.
#
# Usage:
#   npm run db:verify-replay
#   scripts/verify-fresh-replay.sh            # keep the stack up afterwards
#   scripts/verify-fresh-replay.sh --stop     # stop the local stack afterwards
#
# Requires: Docker running, the Supabase CLI, and a local supabase/config.toml
# (run `supabase init` once in a scratch checkout if this is a fresh clone --
# config.toml is a local artifact and is not committed).
#
# Exit code: 0 = clean from-zero replay; non-zero = a migration errored.
# ===========================================================================
set -euo pipefail

STOP_AFTER=0
[[ "${1:-}" == "--stop" ]] && STOP_AFTER=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v supabase >/dev/null 2>&1; then
  echo "FAIL: supabase CLI not found on PATH" >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "FAIL: Docker daemon is not running" >&2
  exit 2
fi
if [[ ! -f supabase/config.toml ]]; then
  echo "FAIL: supabase/config.toml is missing. Run 'supabase init' once (it is a local, uncommitted artifact)." >&2
  exit 2
fi

# Hard guard: this script must never operate against a linked/remote project.
if [[ -f supabase/.temp/project-ref ]]; then
  echo "NOTE: a linked project ref is present; 'supabase db reset' below still targets ONLY the local database." >&2
fi

LOG="$(mktemp -t fresh-replay.XXXXXX.log)"
trap 'rm -f "$LOG"' EXIT

echo "==> Bringing up a disposable local Supabase database (127.0.0.1 only)"
supabase start -x studio,realtime,imgproxy,logflare,vector,edge-runtime,mailpit,supavisor,postgres-meta >/dev/null 2>&1 || true

echo "==> Replaying the ENTIRE migration history from migration #1 (supabase db reset --local)"
set +e
supabase db reset --local 2>&1 | tee "$LOG"
RESET_RC=${PIPESTATUS[0]}
set -e

# `supabase db reset` exits non-zero on any migration error; also scan the log
# for error markers the CLI sometimes prints without a non-zero code.
if [[ $RESET_RC -ne 0 ]] || grep -qiE '^ERROR:|migration .* failed|violates .* constraint|does not exist \(SQLSTATE' "$LOG"; then
  echo ""
  echo "FAIL: from-zero migration replay did NOT complete cleanly."
  grep -nE '^Applying migration|^ERROR:|At statement|does not exist|violates|SQLSTATE' "$LOG" | tail -25 >&2
  [[ $STOP_AFTER -eq 1 ]] && supabase stop >/dev/null 2>&1 || true
  exit 1
fi

APPLIED=$(grep -c '^Applying migration' "$LOG" || true)
echo ""
echo "PASS: fresh database rebuilt from zero -- ${APPLIED} migrations applied, no errors."

[[ $STOP_AFTER -eq 1 ]] && { echo "==> Stopping local stack"; supabase stop >/dev/null 2>&1 || true; }
exit 0
