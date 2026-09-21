EpicentraX Event Hub - Deployment Instructions

This is a Next.js application. It is NOT a static site.

Deployment:
1. Ensure local changes are committed and pushed to main.
2. Run once, if needed: chmod +x deploy
3. Run: ./deploy

`./deploy` is the only supported release command. It validates a clean main
branch, builds locally, then runs the deployment worker (do-pull.sh) on the
production host. A push to main may also trigger the GitHub webhook, which runs
the same worker. Both paths take the same server-side deployment lock, so
concurrent manual deployments and duplicate webhook deliveries do not overlap.
Feature and development branches never deploy.

For a local-only preflight that stops before SSH or any remote change:
DEPLOY_DRY_RUN=1 ./deploy

deploy.sh is RETIRED. It used to deploy independently, without the lock,
fast-forward guards, verification or rollback. It now refuses and points here.

ISOLATED RELEASES
-----------------
The checkout on the production host is a controller. It fetches and validates
commits and prepares releases; it never serves traffic.

  ~/srb-event-hub                        controller checkout
  ~/srb-event-hub-releases/<ts>-<sha>/   one release: source, node_modules, .next
  /srv/srb-event-hub/assets/_next/static/  immutable assets shared by all releases
                                         (outside /root: Nginx must be able to
                                         traverse and read them)
  ~/srb-event-hub-state/{current,previous}   active and rollback release names

Each deployment:
  1. fast-forwards the controller (SHA and ancestry guards unchanged);
  2. exports the commit into a NEW release directory and installs and builds
     THERE - never inside the running release;
  3. publishes the release's /_next/static assets into the shared store,
     refusing any path whose bytes differ from an already-published file;
  4. starts the candidate on 127.0.0.1:3001 and verifies it;
  5. rebinds PM2 to the release directory (a brief restart);
  6. verifies again through local Nginx, including TLS;
  7. on failure, restores the previous release, verifies it, and STILL reports
     the deployment as failed. Failed releases are kept as evidence.

Why: a build that runs inside the live directory deletes the assets the running
process is still advertising. On 2026-09-20 the in-place build ran 16:03:05 to
16:04:21 UTC, and missing assets were observed during that window. Assets are
sent with `immutable, max-age=31536000`, so an affected client is unlikely to
re-request promptly. The evidence does not establish that every CSS request
failed for the whole interval, that no client revalidates, or that every
alternative cause was ruled out -- it establishes an unsafe build window and
observed missing assets, which is reason enough to remove the window.

CONFIGURATION, CANCELLATION AND ROLLBACK
----------------------------------------
Configuration: one protected file (default ~/srb-event-hub-config/app.env,
mode 0600 or 0400, override with DEPLOY_CONFIG_FILE). Required keys must be
present AND non-empty. It is validated and PINNED into the release before the
build, and that same snapshot drives the build, the candidate, activation and
every rollback -- so a mid-build change to the host file cannot split them. A
retained release always runs from its own pinned copy; if that is missing the
worker refuses rather than substituting the shared file. Values are never
read, logged or committed.

Candidate: started with `next start -H 127.0.0.1 -p 3001` (the -H flag, not
HOSTNAME, is what actually binds the interface), supervised, then terminated
as a whole process tree and reaped.

Port state has three distinct outcomes - free, occupied, and UNABLE TO VERIFY.
"Unable to verify" is never reported as free. `lsof` is used when present;
otherwise a Node loopback bind probe is used (an existing dependency, no new
system package). Binding proves only that nothing holds a LISTEN socket on
127.0.0.1:port at that instant, so process ownership is checked separately: a
free port is not proof that a non-listening descendant exited, and a leader
exiting is not proof that its children did. When cleanup cannot be proven the
worker says CLEANUP UNPROVEN and retains evidence rather than claiming success.

Bootstrap baseline: created ONCE, before the controller advances, with the
build, its pinned configuration and its commit identity written together and a
completion marker written LAST. A retry only ever validates and reuses it --
identity and configuration are never rewritten, so an advanced controller
cannot relabel preserved build bytes. Incomplete, malformed, inconsistent or
ambiguous provenance is a hard stop: evidence is preserved and nothing is
guessed or auto-deleted.

Cancellation: the worker traps TERM, INT, ERR and EXIT and runs ONE bounded
cleanup path shared with ordinary failure recovery. Every candidate it launches
is registered as owned BEFORE it starts -- the first-install baseline as well as
a normal candidate -- so cleanup terminates that process group and releases
ownership only once it is PROVEN gone and the candidate port is free; if cleanup
cannot be proven it says so and keeps the evidence. If it was interrupted after
PM2 was disturbed it restores the rollback target recorded beforehand, waits for
that release to start answering (DEPLOY_RECOVERY_READY_SECONDS, default 12s),
then verifies it in full -- and the deployment still reports failure. The
verifier has one finite total budget (DEPLOY_VERIFY_TOTAL_TIMEOUT_MS, default
20s), including all HTML, asset, and protected-route requests; a slow or
trickling response cannot extend that deadline. The webhook's
DEPLOY_KILL_GRACE_MS default is 45s and must exceed readiness plus the verifier
budget plus a 5s recovery margin (37s with the defaults). Readiness is only a
gate; it is not full verification. Candidates and the activated service drop
the inherited deployment-lock descriptor (9>&-), so a surviving process cannot
hold the lock.

Limit: SIGKILL or host loss cannot run any cleanup. Nothing is promised there.
What is guaranteed is that state pointers are written only after the step they
describe succeeds, and that the next attempt refuses to proceed on incomplete
or ambiguous state rather than guessing.

Cancellation: the webhook runs the worker in its own process group with
streamed output, so neither an output limit nor a timeout can abandon
descendants. On DEPLOY_TIMEOUT_MS (default 30m) the tree gets SIGTERM, then
SIGKILL after DEPLOY_KILL_GRACE_MS (default 45s). The deployment lock is held
by a file descriptor, so serialization lasts until the last holder exits.

Limit: the readiness and verifier budgets bound the normal recovery path, but
a stuck PM2 or system call may still prevent the worker from reaching its
cleanup or recovery deadline. In that case the webhook's grace can expire and
recovery is reported incomplete; the retained evidence and fail-closed state
must be handled before another attempt.

Limit: an uncatchable termination (SIGKILL of the worker, or host loss) can
leave a prepared-but-unactivated release behind. It is never activated, and
the next invocation reuses a complete snapshot or discards an incomplete one;
state pointers are only written after the step they describe succeeds.

Rollback: every activation failure and every failed post-activation
verification restores the previous release AND verifies it. A successful,
verified rollback still reports the deployment as failed. "Could not
reactivate" and "reactivated but did not verify" are reported distinctly.
Manual rollback: `bash scripts/deployment/rollback.sh [release]`, which takes
the same deployment lock (exit 75 if a deployment is running).

WHAT VERIFICATION CHECKS
------------------------
The old health check fetched the home page with --output /dev/null and accepted
any non-error status. That could not see the failure. Verification now fetches
the document over loopback with the canonical Host header, extracts every local
CSS/JS file it references, and requires each to return 200, a non-empty body
and a correct content type - explicitly rejecting an HTML document returned in
place of an asset. Never verified through Cloudflare: a cached 200 at the edge
can mask a 404 at the origin.

Set DEPLOY_VERIFY_PATHS to check more than "/" (space separated).
Set DEPLOY_PROTECTED_PATHS to assert that routes stay unauthenticated-blocked.

ASSET READABILITY
-----------------
Assets are published to /srv/srb-event-hub/assets (outside any user home; a
store under /root is refused outright). Directories are 0755 and files 0644,
and a failed chmod/chown fails the deployment rather than being ignored. After
publishing, a representative published file must be readable by the web
account (DEPLOY_WEB_USER, default www-data) -- tested directly, so legitimate
group or ACL access counts.

There is NO environment flag that can turn this into a pass. Both outcomes
fail closed on every production path, and they are reported distinctly:
  PERMISSION DENIED - the check ran and the read was refused
  UNVERIFIED        - the account or check mechanism was unavailable
Local fixtures inject the access-check result inside the fixture; deployable
code contains no bypass.

OUTSTANDING HOST GATES
----------------------
Not yet exercised on a real host: `nginx -t` and live serving of the asset
location block, real PM2 rebinding, and real web-account permission checks.
The Nginx template is an installation artifact, not a validated config.

ASSET RETENTION (FINITE)
------------------------
The active release and the rollback release, and their assets, are never
removed. Other releases are kept at least DEPLOY_ASSET_RETENTION_DAYS (default
7) after they were last activated, and their assets survive while any retained
release still lists them.

This boundary is finite and deliberate: a client holding an HTML document older
than the window can still request a purged asset and receive a 404. Raise
DEPLOY_ASSET_RETENTION_DAYS to widen it.

WHAT IS ACTUALLY DEPLOYED
-------------------------
The controller's HEAD is not authoritative - it can advance past the active
release. The serving commit is recorded per release:

  cat ~/srb-event-hub-releases/"$(cat ~/srb-event-hub-state/current)"/.release-sha

FIRST INSTALL AND ROLLBACK
--------------------------
See scripts/deployment/FIRST_INSTALL.md. The Nginx asset location lives in
scripts/deployment/nginx/asset-store.conf.template and must be installed by
hand inside the existing TLS server block for BOTH application hostnames,
epicentrax.com and app.eventsyncapp.com. Installing it for only one leaves the
other serving assets from the release directory. Preserve TLS, proxy headers,
authentication, tenant resolution and all other locations.

The webhook service requires GITHUB_WEBHOOK_SECRET in its service environment.
Do not place the secret in this repository.

Environment variables required by the application:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY

Notes:
- This app uses Supabase as the backend
- Node.js environment is required
