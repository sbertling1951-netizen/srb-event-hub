#!/usr/bin/env bash
# Isolated-release deployment library for the Event Hub.
#
# Why this exists: the previous worker ran `npm run build` inside the directory
# the live Next.js process was serving from. `next build` clears and rewrites
# `.next/static`, so between the start of the build and the restart the running
# process served HTML referencing asset files that had already been deleted.
# Assets are sent with `immutable, max-age=31536000`, so a client that loaded
# that HTML is cached hard, so an affected client is unlikely to re-request it
# promptly -- though immutable caching alone does not prove that no client ever
# revalidates.
#
# What the 2026-09-20 evidence supports: the build ran in place from 16:03:05
# to 16:04:21 UTC, creating a window in which the running process could
# advertise assets the build had already replaced, and missing assets were
# observed during that window. It does not establish that every CSS request
# failed for the whole interval, nor that every alternative cause was excluded.
#
# The model here keeps the git checkout as a controller that only ever prepares
# releases in a separate versioned directory. The live release is never built
# into, never has dependencies installed into it, and is only replaced after a
# candidate has been started and verified on an alternate loopback port.
#
# Sourced by do-pull.sh. Every function is individually testable; nothing here
# runs on load.

# --- Paths -----------------------------------------------------------------
# All overridable so tests can run entirely inside a disposable directory.
RELEASE_ROOT="${DEPLOY_RELEASE_ROOT:-${HOME}/srb-event-hub-releases}"
# Public assets must live somewhere Nginx can actually reach. The deploying
# user is root, so a $HOME default would place the store under /root, which is
# mode 0700: the www-data worker cannot traverse it and every asset request
# would fail. The store therefore lives outside any user home by default.
ASSET_STORE="${DEPLOY_ASSET_STORE:-/srv/srb-event-hub/assets}"
# Legacy location, migrated on first use so assets published by an earlier
# layout stay readable rather than being abandoned.
LEGACY_ASSET_STORE="${DEPLOY_LEGACY_ASSET_STORE:-${HOME}/srb-event-hub-assets}"
# The account Nginx workers run as. Only used for read/traversal preflight.
WEB_USER="${DEPLOY_WEB_USER:-www-data}"
ASSET_DIR_MODE="${DEPLOY_ASSET_DIR_MODE:-755}"
ASSET_FILE_MODE="${DEPLOY_ASSET_FILE_MODE:-644}"
STATE_DIR="${DEPLOY_STATE_DIR:-${HOME}/srb-event-hub-state}"
PM2_PROCESS_NAME="${DEPLOY_PM2_PROCESS_NAME:-srb-event-hub}"
APP_PORT="${DEPLOY_APP_PORT:-3000}"
CANDIDATE_PORT="${DEPLOY_CANDIDATE_PORT:-3001}"
CANONICAL_HOST="${DEPLOY_CANONICAL_HOST:-epicentrax.com}"
# Assets belonging to a release that is neither current nor rollback are kept
# for this long after that release was last activated. This is a FINITE
# boundary: a client holding HTML older than this may still request a purged
# asset. See DEPLOY_README.txt.
ASSET_RETENTION_DAYS="${DEPLOY_ASSET_RETENTION_DAYS:-7}"
# How long a restored release may take to begin answering before recovery stops
# waiting for it. Deliberately well inside the webhook's TERM-to-KILL grace
# (DEPLOY_KILL_GRACE_MS, default 45000ms): when the worker has been cancelled,
# recovery runs inside that grace, so it must finish rather than be killed
# part-way through a PM2 replacement.
RECOVERY_READY_SECONDS="${DEPLOY_RECOVERY_READY_SECONDS:-12}"
VERIFY_TOTAL_TIMEOUT_MS="${DEPLOY_VERIFY_TOTAL_TIMEOUT_MS:-20000}"
DEPLOY_KILL_GRACE_MS_VALUE="${DEPLOY_KILL_GRACE_MS:-45000}"

validate_timing_configuration() {
  local grace_ms="${DEPLOY_KILL_GRACE_MS_VALUE}" minimum_ms
  [[ "${RECOVERY_READY_SECONDS}" =~ ^[0-9]+$ ]] && (( RECOVERY_READY_SECONDS > 0 )) || {
    die "DEPLOY_RECOVERY_READY_SECONDS must be a finite positive integer"
    return 1
  }
  [[ "${VERIFY_TOTAL_TIMEOUT_MS}" =~ ^[0-9]+$ ]] && (( VERIFY_TOTAL_TIMEOUT_MS > 0 )) || {
    die "DEPLOY_VERIFY_TOTAL_TIMEOUT_MS must be a finite positive integer"
    return 1
  }
  [[ "${grace_ms}" =~ ^[0-9]+$ ]] && (( grace_ms > 0 )) || {
    die "DEPLOY_KILL_GRACE_MS must be a finite positive integer"
    return 1
  }
  minimum_ms=$(( RECOVERY_READY_SECONDS * 1000 + VERIFY_TOTAL_TIMEOUT_MS + 5000 ))
  (( grace_ms > minimum_ms )) || {
    die "DEPLOY_KILL_GRACE_MS must exceed readiness plus verifier budget and recovery margin (${minimum_ms}ms required)"
    return 1
  }
}

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
# Errors go to STDERR, never stdout. A diagnostic written to stdout can be
# captured by a surrounding $( ) and mistaken for data: that is how a missing
# required configuration key was once accepted, because an ERR-trap line
# became the "value".
die() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; return 1; }

# --- State -----------------------------------------------------------------
# `current` and `previous` name release directories under RELEASE_ROOT. They
# are plain files rather than symlinks so a partially written state is easy to
# detect and so nothing can accidentally follow a stale link into a deleted
# release.
state_path() { printf '%s/%s' "${STATE_DIR}" "$1"; }

read_state() {
  local name="$1" file
  file="$(state_path "${name}")"
  [[ -f "${file}" ]] || return 1
  tr -d '\n' < "${file}"
}

write_state() {
  local name="$1" value="$2" file tmp
  file="$(state_path "${name}")"
  mkdir -p "${STATE_DIR}"
  tmp="${file}.tmp.$$"
  printf '%s' "${value}" > "${tmp}"
  mv -f "${tmp}" "${file}"
}

release_dir() { printf '%s/%s' "${RELEASE_ROOT}" "$1"; }

# A release is usable only if it has both an install and a build.
release_is_complete() {
  local dir
  dir="$(release_dir "$1")"
  [[ -d "${dir}/.next" && -f "${dir}/package.json" && -d "${dir}/node_modules" ]]
}

# A timestamp alone collides when two releases are prepared in the same second,
# which made prepare_release refuse a legitimate second attempt. A short
# uniquifier keeps names distinct without changing their shape.
new_release_name() {
  local base suffix n=0
  base="$(date -u '+%Y%m%dT%H%M%SZ')-${1:0:12}"
  suffix="${base}"
  while [[ -e "$(release_dir "${suffix}")" ]]; do
    n=$((n + 1))
    suffix="${base}-${n}"
  done
  printf '%s' "${suffix}"
}

# --- Preparation -----------------------------------------------------------
# Export the commit from the controller checkout into a brand-new directory,
# install dependencies there, and build there. The live release is untouched by
# every step; a failure here leaves production exactly as it was.
prepare_release() {
  local sha="$1" name="$2" dir
  dir="$(release_dir "${name}")"

  if [[ -e "${dir}" ]]; then
    die "Release directory already exists: ${dir}"
    return 1
  fi

  log "Preparing release ${name} in ${dir}"
  mkdir -p "${dir}"
  # git archive gives exactly the tracked tree at that commit -- no build
  # output, no node_modules, nothing from the controller's working state.
  if ! git archive "${sha}" | tar -x -C "${dir}"; then
    die "Failed to export ${sha} into ${dir}"
    return 1
  fi

  # Pin the validated configuration BEFORE anything consumes it, so the build,
  # the candidate, activation and rollback all use one identical snapshot.
  pin_release_config "${name}" || return 1
  local pinned
  pinned="$(release_config_file "${name}")" || return 1

  log "Installing dependencies for ${name}"
  if ! (cd "${dir}" && npm ci); then
    die "Dependency installation failed for ${name}; live release untouched."
    return 1
  fi

  log "Building ${name}"
  # NEXT_PUBLIC_* are needed at build time; they come from the release's own
  # pinned snapshot, never from the caller's environment or the mutable file.
  if ! (cd "${dir}" && set -a && . "${pinned}" && set +a && npm run build); then
    die "Build failed for ${name}; live release untouched."
    return 1
  fi

  if ! release_is_complete "${name}"; then
    die "Release ${name} is incomplete after build."
    return 1
  fi

  log "Release ${name} prepared."
}

# --- Asset publication -----------------------------------------------------
# Immutable assets are published into a store shared by every release, so a
# page served by an older release keeps working after activation. Publication
# happens BEFORE activation and is atomic per file: a reader either sees the
# complete previous file or the complete new one.
#
# Identical content at the same path is expected -- unchanged chunks keep their
# hashed name across builds. DIFFERENT bytes at the same path would mean the
# hash no longer identifies the content, which would silently corrupt other
# releases, so that is refused outright.
# --- Asset-store preflight -------------------------------------------------
# Refuses a store the web server cannot read, rather than publishing into it
# and discovering the problem as 404s in production.
# Can the web account actually READ a given path? Tested directly rather than
# inferred from mode bits, so legitimate group ownership or an ACL counts.
#   0 = confirmed readable
#   1 = confirmed NOT readable
#   2 = could not be determined here
web_user_can_read() {
  local path="$1"
  id "${WEB_USER}" >/dev/null 2>&1 || return 2
  command -v sudo >/dev/null 2>&1 || return 2
  sudo -n true 2>/dev/null || return 2
  if sudo -n -u "${WEB_USER}" test -r "${path}" 2>/dev/null; then return 0; fi
  return 1
}

# Pre-publish sanity. Path shape and creation only; readability of real files
# is asserted after publication, because an empty directory proves nothing.
assert_asset_store_readable() {
  local path="${ASSET_STORE}"

  case "${path}" in
    /root|/root/*)
      die "Refusing an asset store under /root (${path}): public assets must not live beside root's private files, and Nginx cannot traverse a 0700 home. Set DEPLOY_ASSET_STORE."
      return 1 ;;
    /*) ;;
    *)  die "Asset store must be an absolute path: ${path}"; return 1 ;;
  esac

  mkdir -p "${path}/_next/static" || { die "Cannot create asset store ${path}"; return 1; }
  chmod "${ASSET_DIR_MODE}" "${path}" "${path}/_next" "${path}/_next/static" || {
    die "Could not set directory permissions on the asset store ${path}"
    return 1
  }
  log "Asset store ready: ${path}"
}

# Post-publish gate: a representative file this release just published must be
# readable by the web account. Production fails CLOSED when that cannot be
# determined; a local run may opt out explicitly, and the result is reported as
# unproven rather than proven.
assert_published_assets_readable() {
  local name="$1" manifest rel sample status
  manifest="$(release_dir "${name}")/.release-assets"
  [[ -s "${manifest}" ]] || { die "Release ${name} published no assets to verify."; return 1; }
  rel="$(head -1 "${manifest}")"
  sample="${ASSET_STORE}/_next/static/${rel}"
  [[ -f "${sample}" ]] || { die "Published asset is missing from the store: ${rel}"; return 1; }

  # There is deliberately NO environment flag that can turn this into a pass.
  # An earlier DEPLOY_ALLOW_UNVERIFIED_ASSET_ACCESS bypass was accepted in any
  # environment, which made a production path skip a required host check.
  # Fixtures override web_user_can_read() inside the fixture instead, so no
  # escape hatch exists in deployable code.
  web_user_can_read "${sample}" && status=0 || status=$?
  case "${status}" in
    0) log "Web account ${WEB_USER} can read published assets (checked ${rel})."; return 0 ;;
    1) die "PERMISSION DENIED: web account ${WEB_USER} cannot read published asset ${rel}; Nginx would 404 it."; return 1 ;;
    *) die "UNVERIFIED: cannot determine whether ${WEB_USER} can read published assets (account or check mechanism unavailable). Failing closed."; return 1 ;;
  esac
}

# Imports an earlier $HOME-based store using the SAME semantics as publication:
# identical bytes at a path are fine; conflicting bytes or a failed copy fail
# visibly. The previous `cp -Rn ... || true` silently tolerated both.
#
# Imported files are recorded in their own manifest and their mtimes refreshed,
# so retention treats them as currently required rather than pruning them for
# looking old on the filesystem.
migrate_legacy_asset_store() {
  local src="${LEGACY_ASSET_STORE}/_next/static" rel target tmp manifest count=0
  [[ -d "${src}" ]] || return 0
  [[ "${LEGACY_ASSET_STORE}" != "${ASSET_STORE}" ]] || return 0

  log "Importing assets from the legacy store ${LEGACY_ASSET_STORE}"
  mkdir -p "${ASSET_STORE}/_next/static"
  manifest="${ASSET_STORE}/.imported-assets"
  : > "${manifest}"

  while IFS= read -r file; do
    rel="${file#"${src}/"}"
    target="${ASSET_STORE}/_next/static/${rel}"
    printf '%s\n' "${rel}" >> "${manifest}"

    if [[ -f "${target}" ]]; then
      if cmp -s "${file}" "${target}"; then
        touch "${target}" 2>/dev/null || true
        continue
      fi
      die "Refusing to import: conflicting bytes at _next/static/${rel}"
      return 1
    fi

    mkdir -p "$(dirname "${target}")" || { die "Could not create asset directory for ${rel}"; return 1; }
    tmp="${target}.importing.$$"
    cp "${file}" "${tmp}" || { die "Failed to stage imported asset ${rel}"; return 1; }
    mv -f "${tmp}" "${target}" || { die "Failed to import asset ${rel}"; return 1; }
    count=$((count + 1))
  done < <(find "${src}" -type f)

  apply_asset_permissions || return 1
  log "Imported ${count} new asset(s) from the legacy store; ${LEGACY_ASSET_STORE} left in place for manual removal."
}

# A failed chmod/chown can leave assets the web server cannot read, so these
# are hard failures rather than notes.
apply_asset_permissions() {
  [[ -d "${ASSET_STORE}" ]] || return 0
  if ! find "${ASSET_STORE}" -type d -exec chmod "${ASSET_DIR_MODE}" {} + ; then
    die "Could not set directory permissions (${ASSET_DIR_MODE}) under ${ASSET_STORE}"
    return 1
  fi
  if ! find "${ASSET_STORE}" -type f -exec chmod "${ASSET_FILE_MODE}" {} + ; then
    die "Could not set file permissions (${ASSET_FILE_MODE}) under ${ASSET_STORE}"
    return 1
  fi
  if [[ -n "${DEPLOY_ASSET_OWNER:-}" ]]; then
    if ! chown -R "${DEPLOY_ASSET_OWNER}" "${ASSET_STORE}"; then
      die "Could not set asset ownership to ${DEPLOY_ASSET_OWNER} under ${ASSET_STORE}"
      return 1
    fi
  fi
}

publish_assets() {
  local name="$1" dir src manifest rel target tmp
  dir="$(release_dir "${name}")"
  src="${dir}/.next/static"
  manifest="${dir}/.release-assets"

  [[ -d "${src}" ]] || { die "Release ${name} has no .next/static to publish."; return 1; }

  mkdir -p "${ASSET_STORE}/_next/static"
  : > "${manifest}"

  while IFS= read -r file; do
    rel="${file#"${src}/"}"
    target="${ASSET_STORE}/_next/static/${rel}"
    printf '%s\n' "${rel}" >> "${manifest}"

    if [[ -f "${target}" ]]; then
      if cmp -s "${file}" "${target}"; then
        continue
      fi
      die "Refusing to publish ${name}: conflicting bytes at _next/static/${rel}"
      return 1
    fi

    mkdir -p "$(dirname "${target}")"
    tmp="${target}.publishing.$$"
    cp "${file}" "${tmp}" || { die "Failed to stage asset ${rel}"; return 1; }
    mv -f "${tmp}" "${target}" || { die "Failed to publish asset ${rel}"; return 1; }
  done < <(find "${src}" -type f)

  apply_asset_permissions || return 1
  log "Published $(wc -l < "${manifest}" | tr -d ' ') assets for ${name} (dirs ${ASSET_DIR_MODE}, files ${ASSET_FILE_MODE})."
}

# --- Candidate on an alternate port ----------------------------------------
# Next only binds to a specific interface when told explicitly; the HOSTNAME
# environment variable alone does not do it, so `-H` is passed through.
# The candidate is started in its own process group (setsid where available)
# so the whole tree can be terminated and reaped, rather than leaving `next`
# holding the port after `npm` exits.
# Starts the candidate in its OWN process group, so the whole tree stays
# identifiable no matter how it reparents.
#
# Polling `pgrep -P <leader>` after the fact cannot work: a leader that spawns
# a child and exits immediately leaves that child reparented and unfindable,
# which is exactly how a surviving process was previously missed. Node's
# `detached: true` calls setsid(2) on both Linux and macOS, so the candidate
# becomes a group leader and `pgrep -g <pgid>` enumerates the entire tree for
# as long as any member lives. No new dependency: Node already runs the app.
start_candidate() {
  local name="$1" dir pinned pgid
  dir="$(release_dir "${name}")"
  pinned="$(release_config_file "${name}")" || return 1

  command -v node >/dev/null 2>&1 || { die "node is required to supervise a candidate"; return 1; }

  # Ownership evidence from an earlier attempt is never overwritten. Nothing
  # catchable leaves it behind any more, but an uncatchable termination
  # (SIGKILL, host loss) runs no cleanup at all, and erasing the record would
  # destroy the only pointer to processes that are still alive.
  if [[ -s "${dir}/.candidate.owned" ]]; then
    local opid ostarted
    local -a live_from_earlier=()
    while IFS=$'\t' read -r opid ostarted; do
      if owned_process_alive "${opid}" "${ostarted}"; then live_from_earlier+=("${opid}"); fi
    done < "${dir}/.candidate.owned"
    if (( ${#live_from_earlier[@]} > 0 )); then
      log "CLEANUP UNPROVEN: ${name} still owns process(es) from an earlier attempt: ${live_from_earlier[*]}. Refusing to start another candidate or to overwrite that record."
      date -u '+%Y-%m-%dT%H:%M:%SZ' > "${dir}/.cleanup-unresolved"
      die "Refusing to start ${name}: unresolved processes from an earlier attempt."
      return 1
    fi
  fi

  log "Starting candidate ${name} on 127.0.0.1:${CANDIDATE_PORT}"
  rm -f "${dir}/.candidate.pid" "${dir}/.candidate.pgid" "${dir}/.candidate.owned"

  pgid="$(
    cd "${dir}" || exit 1
    set -a; . "${pinned}"; set +a
    # 9>&- : the candidate must not inherit the deployment-lock descriptor.
    exec 9>&-
    PORT="${CANDIDATE_PORT}" node -e '
      const { spawn } = require("child_process");
      const fs = require("fs");
      // node -e consumes the script and `--`, so argv[1] is the first real arg.
      const out = fs.openSync(process.argv[1], "a");
      const child = spawn(process.argv[2], process.argv.slice(3), {
        detached: true,            // setsid(2): its own session and group
        stdio: ["ignore", out, out],
      });
      child.unref();
      process.stdout.write(String(child.pid));
    ' -- "${dir}/.candidate.log" npm start -- -H 127.0.0.1 -p "${CANDIDATE_PORT}"
  )" || { die "Could not start candidate ${name}"; return 1; }

  [[ "${pgid}" =~ ^[0-9]+$ ]] || { die "Candidate ${name} did not report a usable process id"; return 1; }
  # A detached child is its own group leader, so pid == pgid.
  printf '%s' "${pgid}" > "${dir}/.candidate.pid"
  printf '%s' "${pgid}" > "${dir}/.candidate.pgid"
  record_owned_process "${name}" "${pgid}"
}

# Records <pid>\t<start-time>. The start time pins the identity of the PID, so
# a recycled PID belonging to something else is never signalled.
record_owned_process() {
  local name="$1" pid="$2" dir started
  dir="$(release_dir "${name}")"
  [[ -n "${pid}" ]] || return 0
  started="$(ps -o lstart= -p "${pid}" 2>/dev/null | tr -s ' ' || true)"
  [[ -n "${started}" ]] || return 0
  grep -q "^${pid}	" "${dir}/.candidate.owned" 2>/dev/null && return 0
  printf '%s\t%s\n' "${pid}" "${started}" >> "${dir}/.candidate.owned"
}

# True only when the PID still exists AND is the same process we recorded.
owned_process_alive() {
  local pid="$1" recorded="$2" started
  kill -0 "${pid}" 2>/dev/null || return 1
  started="$(ps -o lstart= -p "${pid}" 2>/dev/null | tr -s ' ' || true)"
  [[ "${started}" == "${recorded}" ]]
}

# Every live member of the candidate's own process group.
owned_group_members() {
  local pgid="$1"
  [[ -n "${pgid}" ]] || return 0
  pgrep -g "${pgid}" 2>/dev/null || true
}

# Refuses to signal a group we are part of, or one that is not genuinely ours.
owned_group_is_separate() {
  local pgid="$1" own
  [[ -n "${pgid}" ]] || return 1
  own="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ' || true)"
  [[ -n "${own}" && "${pgid}" != "${own}" ]]
}

# Is the candidate port free?
#   0 = proven free       (a probe successfully bound it)
#   1 = proven occupied   (bind refused with EADDRINUSE, or lsof saw a listener)
#   2 = UNABLE TO VERIFY  (no usable probe, or the probe itself failed)
#
# The previous version returned success when `lsof` was absent, which claimed
# release without proving it. Never conflate "cannot tell" with "free".
#
# The fallback probe binds the loopback port with Node -- an existing
# dependency, no new system package. Binding proves only that nothing else
# holds a LISTEN socket on 127.0.0.1:port at that instant; it does not prove a
# non-listening descendant has exited, which is why process ownership is
# checked separately.
# Is the candidate port free?
#   0 = proven free      (a probe made a valid observation and saw nothing)
#   1 = proven occupied  (EADDRINUSE, or lsof positively listed a listener)
#   2 = UNABLE TO VERIFY (no probe, or the probe itself failed)
#
# The Node loopback bind probe is preferred because its outcome is
# unambiguous: it either binds, reports EADDRINUSE, or errors. `lsof` exit
# status 1 means "nothing matched" but any status >1 is a tool error, and the
# earlier code mapped every nonzero status to "free".
#
# Binding proves only that nothing holds a LISTEN socket on 127.0.0.1:port at
# that instant. It says nothing about a non-listening descendant, which is why
# process ownership is checked separately and never inferred from the socket.
candidate_port_free() {
  local port="${CANDIDATE_PORT}" status=0

  if command -v node >/dev/null 2>&1; then
    node -e '
      const net = require("net");
      const server = net.createServer();
      server.once("error", (error) => process.exit(error && error.code === "EADDRINUSE" ? 1 : 2));
      server.listen(Number(process.argv[1]), "127.0.0.1", () => server.close(() => process.exit(0)));
    ' "${port}" >/dev/null 2>&1 || status=$?
    case "${status}" in
      0|1) return "${status}" ;;
      *)   return 2 ;;
    esac
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1 || status=$?
    case "${status}" in
      0) return 1 ;;   # a listener was positively listed
      1) return 0 ;;   # lsof ran and matched nothing
      *) return 2 ;;   # lsof itself failed -- unknown, never "free"
    esac
  fi

  return 2
}

# Terminates the candidate's whole process tree and reaps it. Only processes
# descended from the recorded pid (or sharing its process group) are signalled,
# so nothing unrelated on the host is touched.
# Terminates every process this candidate owns and proves they are gone.
#
# Leader death, a missing PID record and a free port are all explicitly NOT
# accepted as proof. Ownership evidence is retained on failure so the next
# attempt can detect unresolved state; it is deleted only after success.
# Terminates every process the candidate owns and PROVES they are gone.
#
# Leader death, a missing PID record and a free port are explicitly not
# accepted as proof. Evidence is retained on failure so the next attempt can
# detect unresolved state; it is removed only after success.
stop_candidate() {
  local name="$1" dir pgid deadline members pid started
  dir="$(release_dir "${name}")"
  pgid="$(cat "${dir}/.candidate.pgid" 2>/dev/null || true)"

  [[ -f "${dir}/.candidate.pid" || -s "${dir}/.candidate.owned" || -n "${pgid}" ]] || return 0

  if [[ -n "${pgid}" ]] && ! owned_group_is_separate "${pgid}"; then
    log "CLEANUP UNPROVEN: candidate ${name}'s process group is not separate from this worker's; refusing to signal it."
    date -u '+%Y-%m-%dT%H:%M:%SZ' > "${dir}/.cleanup-unresolved"
    return 1
  fi

  # TERM the whole group -- safe precisely because we created it.
  if [[ -n "${pgid}" ]]; then
    kill -TERM "-${pgid}" 2>/dev/null || true
  fi
  while IFS=$'\t' read -r pid started; do
    owned_process_alive "${pid}" "${started}" && kill -TERM "${pid}" 2>/dev/null || true
  done < <(cat "${dir}/.candidate.owned" 2>/dev/null || true)

  deadline=$((SECONDS + 15))
  while (( SECONDS < deadline )); do
    members="$(owned_group_members "${pgid}")"
    [[ -z "${members}" ]] && break
    sleep 1
  done

  # Anything that ignored TERM is killed outright.
  members="$(owned_group_members "${pgid}")"
  if [[ -n "${members}" ]]; then
    log "Candidate ${name}: process(es) ignored TERM; escalating to KILL: $(tr '\n' ' ' <<< "${members}")"
    kill -KILL "-${pgid}" 2>/dev/null || true
    sleep 1
  fi

  members="$(owned_group_members "${pgid}")"
  local stragglers=()
  while IFS=$'\t' read -r pid started; do
    owned_process_alive "${pid}" "${started}" && stragglers+=("${pid}")
  done < <(cat "${dir}/.candidate.owned" 2>/dev/null || true)

  if [[ -n "${members}" ]] || (( ${#stragglers[@]} > 0 )); then
    log "CLEANUP UNPROVEN: candidate ${name} still owns live process(es): $(tr '\n' ' ' <<< "${members}")${stragglers[*]-}. Evidence retained at ${dir}."
    date -u '+%Y-%m-%dT%H:%M:%SZ' > "${dir}/.cleanup-unresolved"
    return 1
  fi

  # Only now is the socket consulted, and only as an additional requirement.
  local port_state=2
  deadline=$((SECONDS + 10))
  while (( SECONDS < deadline )); do
    candidate_port_free && port_state=0 || port_state=$?
    [[ "${port_state}" == "0" ]] && break
    sleep 1
  done
  case "${port_state}" in
    0) ;;
    1) log "CLEANUP UNPROVEN: port ${CANDIDATE_PORT} is still occupied after stopping candidate ${name}."
       date -u '+%Y-%m-%dT%H:%M:%SZ' > "${dir}/.cleanup-unresolved"; return 1 ;;
    *) log "CLEANUP UNPROVEN: could not verify whether port ${CANDIDATE_PORT} was released."
       date -u '+%Y-%m-%dT%H:%M:%SZ' > "${dir}/.cleanup-unresolved"; return 1 ;;
  esac

  rm -f "${dir}/.candidate.pid" "${dir}/.candidate.pgid" "${dir}/.candidate.owned" "${dir}/.cleanup-unresolved"
  log "Candidate ${name} stopped: all owned processes gone and port ${CANDIDATE_PORT} released."
}

# --- Activation ------------------------------------------------------------
# PM2 is bound explicitly to the release directory. `pm2 restart` alone would
# keep the previous cwd, so the process is recreated with an explicit --cwd.
activate_release() {
  local name="$1" dir
  dir="$(release_dir "${name}")"
  release_is_complete "${name}" || { die "Refusing to activate incomplete release ${name}"; return 1; }

  log "Activating ${name} (pm2 ${PM2_PROCESS_NAME}, cwd ${dir}, port ${APP_PORT})"
  # Deleting the PM2 entry discards whatever environment it carried, so the
  # replacement is started from the release's own pinned configuration.
  pm2 delete "${PM2_PROCESS_NAME}" >/dev/null 2>&1 || true
  if ! (
    set -a; . "$(release_config_file "${name}")"; set +a
    # The long-lived service must not inherit the deployment lock either.
    exec 9>&-
    PORT="${APP_PORT}" pm2 start npm --name "${PM2_PROCESS_NAME}" --cwd "${dir}" -- start
  ); then
    die "pm2 failed to start ${name}"
    return 1
  fi
  date -u '+%Y-%m-%dT%H:%M:%SZ' > "${dir}/.activated-at"
  write_state current "${name}"
}

# --- Retention -------------------------------------------------------------
# Never removes the active or rollback release. Everything else is kept for at
# least ASSET_RETENTION_DAYS after its last activation.
cleanup_releases() {
  local current previous name dir keep
  current="$(read_state current 2>/dev/null || true)"
  previous="$(read_state previous 2>/dev/null || true)"

  [[ -d "${RELEASE_ROOT}" ]] || return 0

  for dir in "${RELEASE_ROOT}"/*; do
    [[ -d "${dir}" ]] || continue
    name="$(basename "${dir}")"
    keep=0
    [[ -n "${current}"  && "${name}" == "${current}"  ]] && keep=1
    [[ -n "${previous}" && "${name}" == "${previous}" ]] && keep=1
    if (( keep )); then
      continue
    fi
    # Releases never activated, or activated within the window, are retained.
    if [[ -f "${dir}/.activated-at" ]]; then
      if [[ -z "$(find "${dir}/.activated-at" -mtime "+${ASSET_RETENTION_DAYS}" 2>/dev/null)" ]]; then
        continue
      fi
    else
      if [[ -z "$(find "${dir}" -maxdepth 0 -mtime "+${ASSET_RETENTION_DAYS}" 2>/dev/null)" ]]; then
        continue
      fi
    fi
    log "Removing expired release ${name}"
    rm -rf "${dir}"
  done
}

# Assets are pruned only when no retained release still lists them. Current and
# rollback assets are therefore unconditionally safe.
cleanup_assets() {
  local keep_list rel target
  [[ -d "${ASSET_STORE}/_next/static" ]] || return 0
  keep_list="$(mktemp)"
  # Every surviving release's manifest defines what must stay.
  if [[ -d "${RELEASE_ROOT}" ]]; then
    cat "${RELEASE_ROOT}"/*/.release-assets 2>/dev/null | sort -u > "${keep_list}" || true
  fi
  # Assets imported from an earlier store back a deployment that is still
  # retained; their filesystem mtimes are not evidence that they are stale.
  if [[ -f "${ASSET_STORE}/.imported-assets" ]]; then
    cat "${ASSET_STORE}/.imported-assets" >> "${keep_list}"
    sort -u -o "${keep_list}" "${keep_list}"
  fi
  while IFS= read -r target; do
    rel="${target#"${ASSET_STORE}/_next/static/"}"
    if grep -qxF "${rel}" "${keep_list}" 2>/dev/null; then
      continue
    fi
    if [[ -n "$(find "${target}" -mtime "+${ASSET_RETENTION_DAYS}" 2>/dev/null)" ]]; then
      log "Pruning unreferenced asset ${rel}"
      rm -f "${target}"
    fi
  done < <(find "${ASSET_STORE}/_next/static" -type f)
  rm -f "${keep_list}"
}

# --- Application configuration ---------------------------------------------
# Neither entry point can be trusted to supply the application environment:
# `./deploy` runs the worker over SSH (the caller's environment does not
# travel), the webhook runs it from a service with its own environment, and
# activation deletes the PM2 entry, discarding whatever env that entry held.
# So configuration comes from one protected file on the host, and every stage
# that needs it -- candidate build, candidate runtime, activated runtime and
# rollback -- loads it from there.
#
# Values are never read, logged or copied into the repository; only key
# PRESENCE is checked.
CONFIG_FILE="${DEPLOY_CONFIG_FILE:-${HOME}/srb-event-hub-config/app.env}"
REQUIRED_CONFIG_KEYS=(NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY)

# Validates a configuration file without ever printing or inspecting values.
validate_config_file() {
  local file="$1" label="${2:-configuration}"

  if [[ ! -f "${file}" ]]; then
    die "${label} is missing: ${file} (see scripts/deployment/FIRST_INSTALL.md)"
    return 1
  fi
  if [[ ! -r "${file}" ]]; then
    die "${label} is not readable: ${file}"
    return 1
  fi
  local mode
  mode="$(stat -c '%a' "${file}" 2>/dev/null || stat -f '%Lp' "${file}" 2>/dev/null || echo "")"
  if [[ -n "${mode}" && "${mode}" != "600" && "${mode}" != "400" ]]; then
    die "Refusing a group/world-readable ${label} (mode ${mode}): ${file}"
    return 1
  fi
  local key value
  for key in "${REQUIRED_CONFIG_KEYS[@]}"; do
    # Presence AND non-emptiness, without ever emitting the value.
    # awk is used rather than grep|tail because a non-matching grep fails the
    # pipeline under `pipefail`, which fires the ERR trap whose output would
    # then be captured here as if it were the value. awk always exits 0.
    value="$(awk -v k="${key}" '
      $0 ~ "^[[:space:]]*(export[[:space:]]+)?" k "=" { sub(/^[^=]*=/, ""); v = $0 }
      END { print v }
    ' "${file}")"
    # Strip one layer of surrounding quotes. A single quote cannot be escaped
    # inside double quotes, so it is held in a variable.
    local dq='"' sq="'"
    value="${value%$dq}"; value="${value#$dq}"
    value="${value%$sq}"; value="${value#$sq}"
    if [[ -z "${value}" ]]; then
      die "${label} is missing a non-empty value for ${key}"
      return 1
    fi
  done
  return 0
}

require_config() {
  validate_config_file "${CONFIG_FILE}" "Application configuration" || return 1
  log "Application configuration present, protected and complete: ${CONFIG_FILE}"
}

# Each release keeps the configuration it was built and activated against, so a
# retained release stays runnable even if the shared file later changes.
# Pinning happens BEFORE the build so that one validated snapshot drives the
# build, the candidate, activation and every later rollback. Copying after the
# build could capture different values if the host file changed mid-build.
pin_release_config() {
  local name="$1" dir
  dir="$(release_dir "${name}")"
  install -m 600 "${CONFIG_FILE}" "${dir}/.release-env" || { die "Could not pin configuration into ${name}"; return 1; }
  validate_config_file "${dir}/.release-env" "Pinned configuration for ${name}" || return 1
  log "Configuration pinned for ${name} before build."
}

# Prefer the release's pinned copy; fall back to the shared file for a release
# that predates pinning.
# A retained release runs with the configuration it was validated against.
# Silently substituting the mutable shared file could start an old release
# against settings it was never built for, so a missing pin is a hard failure.
release_config_file() {
  local dir
  dir="$(release_dir "$1")"
  if [[ -f "${dir}/.release-env" ]]; then
    printf '%s' "${dir}/.release-env"
    return 0
  fi
  die "Release $1 has no pinned configuration (.release-env); refusing to substitute the shared file."
  return 1
}

# --- Single recovery path --------------------------------------------------
# Used by BOTH failure modes (failed activation and failed post-activation
# verification) so there is exactly one recovery behaviour to reason about.
#   0 = restored and verified
#   2 = could not be reactivated        (rollback failure)
#   3 = reactivated but did not verify  (rollback VERIFICATION failure)
#   4 = no usable target
# The caller still reports the deployment as failed in every case.
recover_to() {
  local target="$1" reason="$2"

  if [[ -z "${target}" ]] || ! release_is_complete "${target}"; then
    log "ROLLBACK UNAVAILABLE (${reason}): no complete release to restore. Manual intervention required."
    return 4
  fi

  # Preflight BEFORE PM2 is disturbed: restoring a release whose retained
  # assets are missing or unreadable would take the service down in a
  # different way. A later HTTP check does not replace this.
  if ! assert_release_assets_available "${target}"; then
    log "RECOVERY PREFLIGHT FAILED (${reason}): ${target}'s retained assets are not present and accessible. Not switching."
    return 5
  fi

  log "Recovering to ${target} (${reason})."
  if ! activate_release "${target}"; then
    log "ROLLBACK FAILED: ${target} could not be reactivated. Manual intervention required."
    return 2
  fi
  write_state current "${target}"

  # Readiness first, then the unchanged full verification: the document, every
  # asset it references, and any configured protected routes. A service that
  # merely answers is NOT treated as verified, and a service that never answers
  # is still put through the full check so the failure is reported in detail.
  wait_until_responding || true
  if ! verify_through_nginx; then
    log "ROLLBACK VERIFICATION FAILED: ${target} is active but did not verify. Manual intervention required."
    return 3
  fi
  log "Rollback verified: ${target} is active and serving correctly."
  return 0
}

# Every asset the release recorded must still be in the shared store, and the
# web account must be able to read a representative one. Denial and
# unavailability are distinct, and both refuse.
assert_release_assets_available() {
  local name="$1" manifest rel missing=0 sample="" status
  manifest="$(release_dir "${name}")/.release-assets"
  [[ -s "${manifest}" ]] || { die "Release ${name} has no recorded asset manifest; cannot confirm its assets are retained."; return 1; }

  while IFS= read -r rel; do
    [[ -n "${rel}" ]] || continue
    if [[ ! -f "${ASSET_STORE}/_next/static/${rel}" ]]; then
      log "Retained asset missing for ${name}: _next/static/${rel}"
      missing=$((missing + 1))
    elif [[ -z "${sample}" ]]; then
      sample="${ASSET_STORE}/_next/static/${rel}"
    fi
  done < "${manifest}"

  if (( missing > 0 )); then
    die "Release ${name} is missing ${missing} retained asset(s); refusing to switch to it."
    return 1
  fi

  web_user_can_read "${sample}" && status=0 || status=$?
  case "${status}" in
    0) log "Retained assets for ${name} are present and readable by ${WEB_USER}."; return 0 ;;
    1) die "PERMISSION DENIED: web account ${WEB_USER} cannot read ${name}'s retained assets."; return 1 ;;
    *) die "UNVERIFIED: cannot determine whether ${WEB_USER} can read ${name}'s retained assets. Failing closed."; return 1 ;;
  esac
}

# Waits, against the wall clock, for a restored release to begin answering the
# canonical document through Nginx.
#
# `pm2 start` returns once PM2 has forked the process, not once the application
# is listening, so verifying immediately reported a 502 for a recovery that had
# in fact worked -- and told the operator to intervene by hand. This closes that
# gap without weakening anything: answering is only a readiness gate, and the
# full through-Nginx verification still has to pass before recovery is reported
# as successful.
#
#   0 = the service answered
#   1 = it did not answer in time
#
# The bound is wall-clock rather than a retry count, because the requests
# themselves take time. Worst case is RECOVERY_READY_SECONDS plus one in-flight
# request (--max-time 3).
wait_until_responding() {
  local scheme="${DEPLOY_NGINX_SCHEME:-https}" port="${DEPLOY_NGINX_PORT:-443}"
  local deadline=$((SECONDS + RECOVERY_READY_SECONDS)) attempts=0
  local -a insecure=()
  # The certificate is issued for the public name, not for 127.0.0.1. This hop
  # never leaves the host, and the verifier relaxes the same check.
  [[ "${scheme}" == "https" ]] && insecure=(--insecure)
  while (( SECONDS < deadline )); do
    attempts=$((attempts + 1))
    if curl --fail --silent --output /dev/null --max-time 3 \
      ${insecure[@]+"${insecure[@]}"} --header "Host: ${CANONICAL_HOST}" \
      "${scheme}://127.0.0.1:${port}/"; then
      log "Restored service answered on attempt ${attempts}, within ${RECOVERY_READY_SECONDS}s."
      return 0
    fi
    sleep 1
  done
  log "Restored service did not answer within ${RECOVERY_READY_SECONDS}s; running the full verification anyway so the failure is reported precisely."
  return 1
}

# Verification through the real serving path (Nginx + TLS), including the
# document, every local asset it references, and any configured protected
# routes. Never through Cloudflare: a cached edge 200 can mask an origin 404.
verify_through_nginx() {
  local scheme="${DEPLOY_NGINX_SCHEME:-https}" port="${DEPLOY_NGINX_PORT:-443}"
  DEPLOY_VERIFY_TOTAL_TIMEOUT_MS="${VERIFY_TOTAL_TIMEOUT_MS}" node "${VERIFIER}" --scheme "${scheme}" --port "${port}" --host-header "${CANONICAL_HOST}" \
    "${VERIFY_PATHS[@]}" ${VERIFY_PROTECTED[@]+"${VERIFY_PROTECTED[@]}"}
}

# --- First-install baseline ------------------------------------------------
# The pre-merge snapshot is taken by do-pull.sh with a plain copy, because on a
# genuine first install this library does not yet exist in the checkout. This
# function only REGISTERS that snapshot: it never builds, installs or resets
# anything, and the original service keeps running from the original checkout
# throughout.
# Registers a snapshot as a PREPARED rollback baseline. It is deliberately not
# recorded as `current` and gets no `.activated-at`: PM2 is still serving the
# original checkout at this point, so calling it activated would misstate both
# the pointer and the timestamp. It becomes `current` only if it is really
# activated later.
# Adopts an ALREADY-CREATED baseline snapshot. It deliberately never writes
# .release-sha and never re-pins configuration: on a retry after the controller
# has advanced, doing so would stamp a newer commit and a newer environment
# onto the older build bytes that are actually preserved. Creation happens once,
# before the controller moves; everything afterwards only validates and
# publishes.
#
# The snapshot is not recorded as `current` and gets no `.activated-at`: PM2 is
# still serving the original checkout, so calling it activated would misstate
# both the pointer and the timestamp.
adopt_baseline() {
  local name="$1" dir sha
  dir="$(release_dir "${name}")"

  validate_baseline_provenance "${name}" || return 1
  sha="$(cat "${dir}/.release-sha")"

  publish_assets "${name}" || return 1
  assert_published_assets_readable "${name}" || return 1
  write_state baseline "${name}"
  log "Baseline ${name} adopted as a rollback target (original commit ${sha:0:12}); not activated."
}

# A baseline is usable only when its provenance is complete, well-formed and
# self-consistent. Anything less is a hard stop: identity is never invented and
# a plausible-looking directory is never selected on faith.
validate_baseline_provenance() {
  local name="$1" dir sha
  dir="$(release_dir "${name}")"

  [[ -f "${dir}/.baseline-complete" ]] || {
    die "Baseline ${name} has no completion marker; its snapshot is partial. Refusing to use it."
    return 1
  }
  [[ -f "${dir}/.release-sha" ]] || { die "Baseline ${name} has no recorded commit identity."; return 1; }
  sha="$(cat "${dir}/.release-sha" 2>/dev/null || true)"
  [[ "${sha}" =~ ^[0-9a-f]{40}$ ]] || {
    die "Baseline ${name} has a malformed commit identity; refusing to guess."
    return 1
  }
  [[ -f "${dir}/.release-env" ]] || {
    die "Baseline ${name} has no pinned configuration; refusing to substitute the current one."
    return 1
  }
  validate_config_file "${dir}/.release-env" "Pinned configuration for ${name}" || return 1
  release_is_complete "${name}" || { die "Baseline ${name} is not a complete serving build."; return 1; }
  [[ -f "${dir}/.prepared-at" ]] || { die "Baseline ${name} has no preparation timestamp."; return 1; }
  [[ ! -f "${dir}/.activated-at" ]] || {
    die "Baseline ${name} carries an activation timestamp it should not have; provenance is inconsistent."
    return 1
  }
  return 0
}

# Proves a release can actually START and serve, by running it supervised on
# the alternate loopback port. Verifying through Nginx while PM2 still serves
# something else proves nothing about the copy.
# Proves a release can START and SERVE, and that everything it started was
# cleaned up. A verification that leaves owned processes behind is a FAILED
# verification: previously the cleanup result was logged as a warning and the
# earlier content result was returned regardless.
verify_release_standalone() {
  local name="$1" content_ok=0 cleanup_ok=0
  start_candidate "${name}" || return 1

  local deadline=$((SECONDS + 60))
  while (( SECONDS < deadline )); do
    if curl --fail --silent --output /dev/null --max-time 5 \
      --header "Host: ${CANONICAL_HOST}" "http://127.0.0.1:${CANDIDATE_PORT}/"; then
      content_ok=1; break
    fi
    sleep 2
  done

  if (( content_ok )); then
    log "Verifying ${name} on 127.0.0.1:${CANDIDATE_PORT}"
    node "${VERIFIER}" --port "${CANDIDATE_PORT}" --host-header "${CANONICAL_HOST}" \
      "${VERIFY_PATHS[@]}" ${VERIFY_PROTECTED[@]+"${VERIFY_PROTECTED[@]}"} || content_ok=0
  else
    log "${name} did not start listening on ${CANDIDATE_PORT}."
  fi

  # Ownership is cleared only by a proven cleanup; stop_candidate retains its
  # own evidence otherwise.
  stop_candidate "${name}" && cleanup_ok=1 || cleanup_ok=0

  if (( ! content_ok )); then
    log "Verification FAILED for ${name}: content checks did not pass."
    return 1
  fi
  if (( ! cleanup_ok )); then
    log "Verification FAILED for ${name}: content checks passed but cleanup could not be established."
    return 1
  fi
  return 0
}

# --- Running identity ------------------------------------------------------
# The directory PM2 is actually serving from, when that can be established.
# Prints nothing and returns 1 when it cannot be determined.
running_release_dir() {
  command -v pm2 >/dev/null 2>&1 || return 1
  local json
  json="$(pm2 jlist 2>/dev/null)" || return 1
  [[ -n "${json}" ]] || return 1
  printf '%s' "${json}" | node -e '
    let raw = "";
    process.stdin.on("data", (d) => (raw += d));
    process.stdin.on("end", () => {
      try {
        const found = JSON.parse(raw).find((p) => p.name === process.argv[1]);
        if (!found || found.pm2_env?.status !== "online") process.exit(1);
        process.stdout.write(found.pm2_env.pm_cwd || "");
      } catch { process.exit(1); }
    });
  ' "${PM2_PROCESS_NAME}" 2>/dev/null
}

# True only when the commit is demonstrably the one being served AND the
# service answers. When identity cannot be established we return false, so the
# worker deploys rather than skipping on an unverified assumption.
already_deployed() {
  local incoming="$1" current dir running sha
  current="$(read_state current 2>/dev/null || true)"
  [[ -n "${current}" ]] || return 1
  release_is_complete "${current}" || return 1

  dir="$(release_dir "${current}")"
  sha="$(cat "${dir}/.release-sha" 2>/dev/null || true)"
  [[ "${sha}" == "${incoming}" ]] || return 1

  running="$(running_release_dir 2>/dev/null || true)"
  if [[ -z "${running}" ]]; then
    log "Could not establish the running release identity; treating ${incoming:0:12} as not yet deployed."
    return 1
  fi
  if [[ "${running%/}" != "${dir%/}" ]]; then
    log "PM2 is serving ${running}, not the recorded release ${current}; a deployment is required."
    return 1
  fi
  verify_through_nginx >/dev/null 2>&1 || {
    log "Recorded release ${current} matches ${incoming:0:12} but did not verify; a deployment is required."
    return 1
  }
  return 0
}
