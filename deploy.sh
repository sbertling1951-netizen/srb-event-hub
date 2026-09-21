#!/usr/bin/env bash
#
# Retired. This script used to deploy independently: `git pull` (not
# fast-forward-only), `npm install` (not `npm ci`), an in-place build, a PM2
# restart and an Nginx restart -- with no deployment lock, no SHA validation,
# no release isolation, no verification and no rollback. Running it alongside
# the governed worker could corrupt a deployment in progress.
#
# It is kept as a refusal rather than deleted so that anyone (or any runbook)
# still invoking it is told where to go instead of silently getting nothing.

set -Eeuo pipefail

cat >&2 <<'MESSAGE'
deploy.sh no longer performs deployments.

Use the governed entry point instead:

  ./deploy                 controlled release from a clean local main
  DEPLOY_DRY_RUN=1 ./deploy   local validation and build only, no remote changes

Both that command and the GitHub webhook run the same worker (do-pull.sh),
which holds the deployment lock, enforces fast-forward and SHA guards,
prepares each release in isolation, verifies it before and after activation,
and rolls back on failure.
MESSAGE

exit 64
