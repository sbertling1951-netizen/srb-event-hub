# Isolated-release deployment — first install and rollback

**Review artifact. Nothing here has been run against production.** It describes
the one-time transition from the current in-place layout to isolated releases,
and how to get back if that transition goes wrong.

## Why the transition is needed

Today the controller checkout *is* the live release: `npm run build` rewrites
`.next` underneath the running Next.js process. On 2026-09-20 the build ran in
place from 16:03:05 to 16:04:21 UTC, and missing assets were observed during
that window, because the build can replace assets the still-running process is
still advertising. The evidence supports an unsafe build window and observed
missing assets -- not that every request failed throughout it. After this
change the checkout only ever prepares releases; it never serves.

## Layout after installation

| Path | Role |
|---|---|
| `~/srb-event-hub` | Controller checkout. Runs the worker. Never serves traffic. |
| `~/srb-event-hub-releases/<timestamp>-<sha>/` | One self-contained release: source, `node_modules`, `.next`. |
| `/srv/srb-event-hub/assets/_next/static/` | Shared immutable assets from every retained release. **Outside any user home** so Nginx can read them. |
| `~/srb-event-hub-state/{current,previous,baseline}` | Names of the active release, the rollback release, and the preserved first-install baseline. |

Override any of these with `DEPLOY_RELEASE_ROOT`, `DEPLOY_ASSET_STORE`,
`DEPLOY_STATE_DIR`.

### Why the asset store is not under `$HOME`

Deployments run as `root`, and `/root` is mode 0700. An asset store there
cannot be traversed by the `www-data` Nginx worker, so every `/_next/static`
request would fail — the `alias` would resolve to a path the worker cannot
reach. The worker therefore **refuses** any store under `/root`, and refuses a
relative path: the store must be absolute.

Before publishing, the worker creates the store and sets the modes of its own
three directories. It does **not** inspect ancestors. **After** publishing, it
asserts that the web account can actually read a file this release just
published, by reading it *as that account* rather than by inspecting mode bits.
That check is mandatory and has no override:

- an actual **denial** is reported as `PERMISSION DENIED` and refuses;
- an **inability to determine** access — no such account, no usable `sudo` — is
  reported as `UNVERIFIED` and also refuses.

Because the check reads the file as the web account, **world-traversable
ancestors are only one way to satisfy it.** Group ownership and POSIX ACLs work
equally well; both were exercised against real Nginx on 2026-09-20 (a
`0750`/`0640` `root:www-data` store, and a `0700`/`0600` store reachable only
through an ACL). The `chmod 755` recipe below is one recipe, not a requirement.

Permissions applied on every publish: directories `0755`, files `0644`.
Override with `DEPLOY_ASSET_DIR_MODE` / `DEPLOY_ASSET_FILE_MODE`, the web
account with `DEPLOY_WEB_USER` (default `www-data`), and ownership with
`DEPLOY_ASSET_OWNER`.

If an earlier `~/srb-event-hub-assets` store exists, its contents are copied
into the new location on first use — without overwriting anything already
published — so assets referenced by pages from an existing deployment keep
resolving. The old directory is left in place for manual removal.

Prepare the store once, before the first deployment:

```sh
mkdir -p /srv/srb-event-hub/assets/_next/static
chmod 755 /srv /srv/srb-event-hub /srv/srb-event-hub/assets
```

## Required configuration (names only — never commit values)

The worker refuses to run without an explicit application configuration file.
Neither entry point can supply it: `./deploy` runs over SSH so the caller's
environment does not travel, the webhook service has its own environment, and
activation deletes the PM2 entry, discarding whatever environment that entry
carried. One protected file on the host is therefore the single source, used by
the candidate build, the candidate runtime, the activated runtime and every
rollback.

```sh
mkdir -p ~/srb-event-hub-config
touch    ~/srb-event-hub-config/app.env
chmod 600 ~/srb-event-hub-config/app.env   # 0600 or 0400; the worker refuses anything looser
```

It must define, at minimum:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Override the location with `DEPLOY_CONFIG_FILE`. The worker validates only that
the file exists, is not group/world-readable, and defines a non-empty value for
each required key. It never prints or logs a value, and no value is committed.

It does, however, **read the file and copy it verbatim** into each release as
`<release>/.release-env` (mode 0600), and into the first-install baseline
snapshot, before the build that consumes it. That is what lets a retained
release be restarted or rolled back with exactly the configuration it was
validated against, even after the shared file changes. **Consequence:
`~/srb-event-hub-releases/` contains copies of your secrets** and must be
protected like the configuration file itself.

`GITHUB_WEBHOOK_SECRET` remains required in the webhook service environment and
is unchanged by this work. Do not place it in the repository.

## First install

Run as the deploying user on the production host.

### Bootstrap ordering (the worker performs steps 3–6 itself, in this order)

1. **Create the configuration file** (above). The worker refuses to run
   without it, before it touches anything.
2. **Install the Nginx asset location — for BOTH hostnames.** Paste the block
   from `scripts/deployment/nginx/asset-store.conf.template` inside the
   existing TLS `server { }` block for **`epicentrax.com` and
   `app.eventsyncapp.com`**, substituting `__ASSET_STORE__`, then
   `nginx -t && systemctl reload nginx`. Safe to do before any release exists:
   the `try_files` fallback sends unresolved assets to the application, which
   is today's behaviour. Preserve TLS, proxy headers, authentication and every
   other location exactly as they are.

   **Exercised, but not against production:** on 2026-09-20 this block was
   rendered into two synthetic TLS `server { }` blocks (one per hostname) in an
   isolated Ubuntu 24.04 / Nginx 1.24.0 container, with a synthetic application
   and a self-signed certificate over loopback. `nginx -t` passed, and stored
   assets, the `try_files` fallback, missing assets, Host forwarding, cache
   headers and unchanged application/protected routes all behaved as described.
   **Production's Nginx version and real server blocks, and the actual Next.js
   application's behaviour, were NOT verified by that test.**
3. **Snapshot the running build — before anything advances.** The worker copies
   the entire serving checkout (source, `node_modules`, `.next`, configuration,
   commit identity and static assets) into a release directory. This happens
   *before* the fast-forward, because afterwards the checkout's source would no
   longer match the build that is actually serving. It is a pure copy: nothing
   is reset, installed, built or moved, and the original service keeps running
   from the original checkout.
4. **Adopt and verify the baseline.** The snapshot's assets are published and
   it is recorded as `baseline` — **not** `current`, and it is given no
   `.activated-at`, because PM2 is still serving the original checkout at this
   point. It is then proven to start and serve by being run supervised on the
   alternate loopback port (3001) and checked by the release verifier, and the
   processes it started are terminated and proven gone. **If baseline
   verification fails, or its cleanup cannot be proven, the transition stops
   here** and the original service is still running, untouched.
5. **Prepare and verify the candidate** in its own directory, on port 3001.
6. **Activate and verify**, with the baseline from step 4 as a real rollback
   target.

There is **no first-install exception to rollback**: by the time any candidate
is activated, a complete, verified, recoverable release already exists.

### Running it

From your workstation, on a clean `main`:

```sh
./deploy
```

Before starting, record the current state for your own reference:

```sh
cd ~/srb-event-hub
git rev-parse HEAD
pm2 jlist | node -e 'const p=JSON.parse(require("fs").readFileSync(0,"utf8")).find(x=>x.name==="srb-event-hub");console.log(p.pm2_env.pm_cwd, p.pm2_env.status)'
df -h /     # the baseline snapshot plus the first release roughly triples disk use at peak
```

### Confirming the switch

```sh
cat ~/srb-event-hub-state/current
cat ~/srb-event-hub-state/previous    # the preserved baseline
pm2 jlist | node -e 'const p=JSON.parse(require("fs").readFileSync(0,"utf8")).find(x=>x.name==="srb-event-hub");console.log(p.pm2_env.pm_cwd)'
# must be a release directory, NOT ~/srb-event-hub
```

### Interruption recovery

The transition never runs `git reset`, `npm ci` or `npm run build` inside a
directory that is serving traffic, so the serving checkout is never damaged.
Interruption safety beyond that is **bounded, not absolute**:

- cleanup and recovery run only for **catchable** signals (TERM, INT) and
  ordinary failures;
- they cover every candidate the worker has registered as owned — both the
  first-install baseline and a normal candidate — and ownership is released only
  once cleanup has been *proven* (process group gone **and** candidate port
  released);
- an interruption **after** `pm2 delete` does take the service down until
  recovery restores it;
- a SIGKILL or host loss runs no cleanup at all, and ambiguous state fails
  closed on the next attempt rather than being guessed at.

| Interrupted during | State | What to do |
|---|---|---|
| Config/Nginx setup (1–2) | Nothing changed | Re-run; both steps are idempotent |
| Snapshot (3) | A `*-baseline` directory exists without `.baseline-complete` | **The next run refuses to proceed** and names the directory. Inspect it, then remove it by hand once its contents are understood — it is never auto-deleted or auto-completed, because its bytes may copy a build that is still serving |
| Baseline adopt/verify (4) | `baseline` points at the snapshot; PM2 still on the original checkout; the supervised copy has been terminated and proven gone | Re-run `./deploy`. The preserved snapshot is **reused unchanged** — its commit identity and pinned configuration are never rewritten, even if the controller or the host configuration has since changed |
| Candidate prepare/verify (5) | Candidate directory retained as evidence; nothing activated | Re-run. The live service never changed |
| Activation (6) | Worker rolls back to the baseline, waits for it to answer, then verifies it in full | Read the log; fix the cause and re-run. A restored-and-verified release is still reported as a **failed** deployment |
| Any phase, worker TERMed or INTed | Bounded cleanup runs: every owned candidate — baseline or normal — has its process group terminated and *proven* gone before ownership is released, and if PM2 had been disturbed the recorded rollback target is restored, waited for, and verified | Re-run. If cleanup cannot be proven the worker says so, keeps the evidence, and the next attempt refuses rather than activating over it. A SIGKILL or host loss runs no cleanup at all; the next attempt refuses to proceed on incomplete or ambiguous state rather than guessing |

At no point is `git reset`, `npm ci` or `npm run build` executed inside a
directory that is serving traffic.

## Rollback

Every activation failure and every failed post-activation verification uses one
recovery path: confirm the target's retained assets are present and readable
*before* PM2 is touched, restore the release, update the state pointers, **wait
for the restored release to start answering**, and then verify it through Nginx
— HTML, every referenced asset, and any configured protected routes.

`pm2 start` returns before the application is listening, so that wait is
required: without it a recovery that had in fact worked was reported as a
verification failure. The wait is bounded by wall clock —
`DEPLOY_RECOVERY_READY_SECONDS`, default 12 — and is deliberately inside the
webhook's TERM-to-KILL grace (`DEPLOY_KILL_GRACE_MS`, default 45 000 ms),
because recovery after a cancellation runs inside that grace. Full verification
has its own finite total budget (`DEPLOY_VERIFY_TOTAL_TIMEOUT_MS`, default
20 000 ms) covering HTML, assets, and protected routes. The grace must exceed
the 12 000 ms readiness budget plus the 20 000 ms verifier budget plus a 5 000
ms margin; invalid relationships are refused. Answering is only a readiness
gate: **the full verification still has to pass**, and a release that never
answers is put through it anyway so the failure is reported in detail. A slow
or trickling response cannot extend the verifier's total deadline. In the 2026-09-20 container runs the restored release answered on the
second attempt and the whole signal-to-outcome recovery took 3 s; that is a
measurement, not a guarantee for production.

A stuck PM2 or system call can still prevent the worker from reaching these
deadlines. The webhook grace may then expire and recovery is reported
incomplete; retained evidence and fail-closed state require manual handling
before another attempt.

**A successful, verified rollback still reports the deployment as failed.**
Rollback failure (could not reactivate) and rollback-verification failure
(reactivated but did not verify) are reported distinctly, because they need
different responses.

Deliberate manual rollback, serialized under the same deployment lock so it
cannot interleave with a running deployment:

```sh
bash scripts/deployment/rollback.sh              # to the recorded previous release
bash scripts/deployment/rollback.sh <release>    # to a specific retained release
```

Exit codes:

- `0` — restored and **fully verified**.
- `1` — failed. The log distinguishes three cases: a **preflight refusal**
  (`Manual rollback REFUSED` — the target's retained assets are missing or
  unreadable, and **PM2 was not touched**), an **activation failure**
  (`could not be activated`), and a **verification failure**
  (`ACTIVATED BUT DID NOT VERIFY`).
- `75` — a deployment holds the lock; nothing was attempted.

There is no separate first-install rollback procedure, and no path that resets
or rebuilds a serving directory.

## Retention boundary (finite, deliberate)

- The active release and its assets are never removed.
- The rollback release and its assets are never removed.
- Any other release is kept for at least `DEPLOY_ASSET_RETENTION_DAYS`
  (default 7) after it was last activated; its assets survive as long as any
  retained release still lists them.

**This boundary is finite.** A client holding an HTML document older than the
retention window can still request a purged asset and receive a 404. That is a
deliberate trade against unbounded disk growth, and it is vastly longer than
the seconds-long window this work removes. Raise `DEPLOY_ASSET_RETENTION_DAYS`
if that trade needs to change.

## Release identity

The controller checkout's `HEAD` is **not** what is serving: it can advance
past the active release. The serving commit is recorded in
`<release>/.release-sha`, and the worker reports it at the end of every
deployment. Resolve "what is deployed?" as:
```sh
cat ~/srb-event-hub-releases/"$(cat ~/srb-event-hub-state/current)"/.release-sha
```
