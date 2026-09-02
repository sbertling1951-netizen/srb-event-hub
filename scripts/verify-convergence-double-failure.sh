#!/usr/bin/env bash
# ===========================================================================
# verify-convergence-double-failure.sh
#
# Executable regression for the registration <-> canonical-person convergence
# DOUBLE-FAILURE observability contract (Doug final re-review):
#
#   identity engine fails  AND  the durable issue recorder itself fails
#     -> tentative identity work rolls back
#     -> registration still survives
#     -> NO durable registration_identity_convergence_issues row (broken on purpose)
#     -> the recorder emits exactly ONE bounded PostgreSQL WARNING
#     -> that WARNING carries only safe operational identifiers + SQLSTATEs
#     -> that WARNING contains no email / phone / name / secret
#
# PostgreSQL has no in-SQL WARNING interception, so this runner executes the
# full convergence integration suite and independently verifies the WARNING
# from captured psql stderr, scoped to the O2 window markers the .sql file
# prints. The .sql file itself asserts every state effect.
#
#   scripts/verify-convergence-double-failure.sh
#
# Requires: local Supabase up with the migration chain applied
# (npm run db:verify-replay first if unsure). Never touches a linked project.
# ===========================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DB_URL="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
SQL="supabase/integration-tests/20260920000000_registration_identity_convergence_behavior.sql"

echo "==> Running the convergence integration suite (incl. TEST O and TEST O2)"
OUT="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL" 2>&1)" || {
  echo "FAIL: integration suite errored"; echo "$OUT" | tail -40; exit 1;
}

# whole-suite gate
echo "$OUT" | grep -q 'ALL REGISTRATION IDENTITY CONVERGENCE ASSERTIONS PASSED' \
  || { echo "FAIL: suite did not reach the final all-pass NOTICE"; echo "$OUT" | tail -40; exit 1; }
echo "$OUT" | grep -q 'TEST O: PASS'  || { echo "FAIL: TEST O missing"; exit 1; }
echo "$OUT" | grep -q 'TEST O2: PASS' || { echo "FAIL: TEST O2 state effects missing"; exit 1; }

# WARNING verification, scoped to the O2 window the .sql file prints
WIN="$(printf '%s\n' "$OUT" | awk '/===O2-WARNING-WINDOW-START===/{f=1} f{print} /===O2-WARNING-WINDOW-END===/{f=0}')"

C="$(printf '%s\n' "$WIN" | grep -c 'durable issue persistence FAILED' || true)"
[ "$C" = "1" ] || { echo "FAIL: expected exactly ONE bounded WARNING in the O2 window, got $C"; printf '%s\n' "$WIN"; exit 1; }

printf '%s\n' "$WIN" | grep -Eq \
  'WARNING:  \[registration_identity_convergence\] durable issue persistence FAILED; identity failure is now log-only\. attendee_id=[0-9a-f-]{36} event_id=[0-9a-f-]{36} issue_type=ENGINE_ERROR role_key=\(none\) original_sqlstate=[0-9A-Z]{5} recorder_sqlstate=[0-9A-Z]{5} recorder_error=' \
  || { echo "FAIL: WARNING did not match the bounded identifier + SQLSTATE format"; printf '%s\n' "$WIN"; exit 1; }

# PII / payload must NOT appear on the WARNING line itself (the O2 fixture
# uses the name "Ollytwo Doublefail" and email "olly2.doublefail@example.test"
# -- none of that may surface in the bounded WARNING).
WLINE="$(printf '%s\n' "$WIN" | grep 'durable issue persistence FAILED')"
if printf '%s\n' "$WLINE" | grep -Eiq '@|ollytwo|doublefail|olly2'; then
  echo "FAIL: the WARNING line leaked PII / payload"; printf '%s\n' "$WLINE"; exit 1
fi

echo ""
echo "PASS: double-failure observability verified"
echo "      - integration suite fully green (incl. O and O2 state effects)"
echo "      - exactly one bounded WARNING emitted when issue persistence fails"
echo "      - WARNING carries only attendee_id / event_id / issue_type / role_key / SQLSTATEs"
echo "      - WARNING contains no email / phone / name / payload"
exit 0
