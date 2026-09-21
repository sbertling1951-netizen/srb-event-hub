import { execFileSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { NextResponse } from "next/server";
import path from "path";

import { resolveAdminActorFromBearer } from "@/lib/server/adminAuthz";

// Deployment metadata for the Super-Admin diagnostics panel.
//
// Under isolated releases the serving process runs from a release directory
// produced by `git archive` -- it has no `.git`, so the previous
// `git rev-parse` call could not identify it, and walking up to a parent
// repository would report an unrelated commit. Identity therefore comes from
// the release's own recorded metadata, read from the directory this process is
// actually running in. It is never taken from `state/current` or the
// controller checkout: both can advance past what is being served.

/** How the reported identity was established. */
export type DeploymentSource = "release" | "checkout" | "unknown";

export type SystemStatusPayload = {
  status: string;
  source: DeploymentSource;
  commit: string | null;
  /** null when cleanliness is unverified or does not apply to a release. */
  dirty: boolean | null;
  environment: string;
  /** A recorded activation time, or null. Never the request time. */
  lastDeployedAt: string | null;
};

const FULL_SHA = /^[0-9a-f]{40}$/;

function readTrimmed(file: string): string | null {
  try {
    if (!existsSync(file) || !statSync(file).isFile()) {return null;}
    const value = readFileSync(file, "utf8").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** A recorded ISO timestamp, or null if absent or unparseable. */
function readTimestamp(file: string): string | null {
  const raw = readTrimmed(file);
  if (!raw) {return null;}
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function resolveDeploymentIdentity(cwd: string): Omit<
  SystemStatusPayload,
  "status" | "environment"
> {
  // An isolated release is identified by its own recorded commit. This is
  // checked FIRST because the first-install baseline is a copy of the old
  // checkout and therefore still contains .git -- it is a release, and its
  // Git metadata describes the controller, not what is being served.
  const releaseSha = readTrimmed(path.join(cwd, ".release-sha"));
  if (releaseSha !== null) {
    if (!FULL_SHA.test(releaseSha)) {
      // Present but malformed: report unavailable rather than a partial or
      // guessed identity.
      return { source: "release", commit: null, dirty: null, lastDeployedAt: null };
    }
    return {
      source: "release",
      commit: releaseSha.slice(0, 7),
      // A release is an immutable export; worktree cleanliness does not apply.
      dirty: null,
      // Only a real activation counts. The baseline carries `.prepared-at`
      // instead, and preparation is not deployment, so it stays null.
      lastDeployedAt: readTimestamp(path.join(cwd, ".activated-at")),
    };
  }

  // A genuine checkout keeps its existing behaviour. `.git` must be in this
  // directory: resolving upwards would report an unrelated repository.
  if (existsSync(path.join(cwd, ".git"))) {
    try {
      const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd,
        encoding: "utf8",
      }).trim();
      const porcelain = execFileSync("git", ["status", "--porcelain"], {
        cwd,
        encoding: "utf8",
      });
      return {
        source: "checkout",
        commit: commit.length > 0 ? commit : null,
        dirty: porcelain.trim().length > 0,
        lastDeployedAt: null,
      };
    } catch {
      // Git present but unusable: cleanliness is unverified, not clean.
      return { source: "checkout", commit: null, dirty: null, lastDeployedAt: null };
    }
  }

  return { source: "unknown", commit: null, dirty: null, lastDeployedAt: null };
}

export async function GET(req: Request) {
  const adminResolved = await resolveAdminActorFromBearer(
    req.headers.get("authorization"),
  );

  if (!adminResolved.admin) {
    return NextResponse.json(
      { error: "Administrative authentication is required." },
      { status: adminResolved.status || 401 },
    );
  }

  if (!adminResolved.admin.isSuperAdmin) {
    return NextResponse.json(
      { error: "Super administrator capability is required." },
      { status: 403 },
    );
  }

  const identity = resolveDeploymentIdentity(process.cwd());

  return NextResponse.json({
    // The endpoint answered. This is not a health check of assets, PM2 or
    // integrations, and deliberately does not become one.
    status: "Responding",
    ...identity,
    environment:
      process.env.NODE_ENV === "production" ? "Production" : "Development",
  } satisfies SystemStatusPayload);
}
