import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveDeploymentIdentity } from "./route";

// Behavioural tests for deployment-identity resolution run against real
// disposable directories, plus source assertions (the convention for routes in
// this repository) for the authorization gates. No secrets are read.

const source = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");
/** Comments stripped: the route's own explanation names the things it avoids,
 *  which would otherwise satisfy an absence check. */
const codeOnly = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const FULL_SHA = "0123456789abcdef0123456789abcdef01234567";

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "system-status-"));
}

test("bearer authentication and Super-Admin authorization still gate every response", () => {
  assert.match(source, /resolveAdminActorFromBearer\(\s*req\.headers\.get\("authorization"\),?\s*\)/);
  assert.match(source, /if \(!adminResolved\.admin\)/);
  assert.match(source, /adminResolved\.status \|\| 401/);
  assert.match(source, /if \(!adminResolved\.admin\.isSuperAdmin\)/);
  assert.match(source, /"Super administrator capability is required\."[\s\S]*?status: 403/);
  // The authorization checks must precede any deployment metadata resolution.
  assert.ok(
    source.indexOf("isSuperAdmin") < source.indexOf("resolveDeploymentIdentity(process.cwd())"),
    "authorization must be resolved before deployment metadata",
  );
});

test("identity is read from the serving directory, never from state/current or the controller", () => {
  assert.match(source, /resolveDeploymentIdentity\(process\.cwd\(\)\)/);
  assert.doesNotMatch(codeOnly, /state\/current|srb-event-hub-state/);
});

test("a valid archived release reports its short commit, null cleanliness and its activation time", () => {
  const dir = tempDir();
  try {
    writeFileSync(path.join(dir, ".release-sha"), `${FULL_SHA}\n`);
    writeFileSync(path.join(dir, ".activated-at"), "2026-09-20T16:04:22Z\n");
    const identity = resolveDeploymentIdentity(dir);
    assert.equal(identity.source, "release");
    assert.equal(identity.commit, "0123456");
    assert.equal(identity.dirty, null, "an immutable export has no worktree cleanliness");
    assert.equal(identity.lastDeployedAt, new Date("2026-09-20T16:04:22Z").toISOString());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a prepared baseline reports no deployment time -- preparation is not activation", () => {
  const dir = tempDir();
  try {
    writeFileSync(path.join(dir, ".release-sha"), FULL_SHA);
    writeFileSync(path.join(dir, ".prepared-at"), "2026-09-20T16:00:00Z");
    const identity = resolveDeploymentIdentity(dir);
    assert.equal(identity.source, "release");
    assert.equal(identity.lastDeployedAt, null, "a prepared-but-unactivated release has no activation time");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the copied first-install baseline is a release even though it still contains Git metadata", () => {
  const dir = tempDir();
  try {
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "config", "user.email", "t@example.com"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "Test"]);
    writeFileSync(path.join(dir, "file.txt"), "x");
    execFileSync("git", ["-C", dir, "add", "-A"]);
    execFileSync("git", ["-C", dir, "commit", "-qm", "base"]);
    // The baseline is a copy of the old checkout, so .git is present -- but it
    // describes the controller, not what is being served.
    writeFileSync(path.join(dir, ".release-sha"), FULL_SHA);

    const identity = resolveDeploymentIdentity(dir);
    assert.equal(identity.source, "release");
    assert.equal(identity.commit, "0123456", "release metadata must win over Git metadata");
    assert.equal(identity.dirty, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a malformed or truncated .release-sha reports unavailable rather than a guessed identity", () => {
  for (const bad of ["not-a-sha", "0123456", `${FULL_SHA}extra`, "0123456789ABCDEF0123456789abcdef01234567"]) {
    const dir = tempDir();
    try {
      writeFileSync(path.join(dir, ".release-sha"), bad);
      const identity = resolveDeploymentIdentity(dir);
      assert.equal(identity.source, "release");
      assert.equal(identity.commit, null, `"${bad}" must not be reported as a commit`);
      assert.equal(identity.dirty, null);
      assert.equal(identity.lastDeployedAt, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("an unparseable activation timestamp is reported as null, never invented", () => {
  const dir = tempDir();
  try {
    writeFileSync(path.join(dir, ".release-sha"), FULL_SHA);
    writeFileSync(path.join(dir, ".activated-at"), "whenever");
    assert.equal(resolveDeploymentIdentity(dir).lastDeployedAt, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a genuine checkout keeps commit and boolean cleanliness", () => {
  const dir = tempDir();
  try {
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "config", "user.email", "t@example.com"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "Test"]);
    writeFileSync(path.join(dir, "file.txt"), "x");
    execFileSync("git", ["-C", dir, "add", "-A"]);
    execFileSync("git", ["-C", dir, "commit", "-qm", "base"]);

    const clean = resolveDeploymentIdentity(dir);
    assert.equal(clean.source, "checkout");
    assert.match(String(clean.commit), /^[0-9a-f]{7,}$/);
    assert.equal(clean.dirty, false);
    assert.equal(clean.lastDeployedAt, null, "a checkout has no recorded activation time");

    writeFileSync(path.join(dir, "file.txt"), "changed");
    assert.equal(resolveDeploymentIdentity(dir).dirty, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a directory with neither release metadata nor its own .git is unknown, not clean", () => {
  const dir = tempDir();
  try {
    const identity = resolveDeploymentIdentity(dir);
    assert.equal(identity.source, "unknown");
    assert.equal(identity.commit, null);
    assert.equal(identity.dirty, null);
    assert.equal(identity.lastDeployedAt, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("identity is never recovered from an unrelated parent Git repository", () => {
  const parent = tempDir();
  try {
    execFileSync("git", ["init", "-q", parent]);
    execFileSync("git", ["-C", parent, "config", "user.email", "t@example.com"]);
    execFileSync("git", ["-C", parent, "config", "user.name", "Test"]);
    writeFileSync(path.join(parent, "file.txt"), "x");
    execFileSync("git", ["-C", parent, "add", "-A"]);
    execFileSync("git", ["-C", parent, "commit", "-qm", "base"]);

    // A release directory nested inside some other repository.
    const nested = path.join(parent, "releases", "20260920T000000Z-abc");
    mkdirSync(nested, { recursive: true });

    const identity = resolveDeploymentIdentity(nested);
    assert.equal(identity.source, "unknown", "the parent repository must not supply identity");
    assert.equal(identity.commit, null);
    assert.equal(identity.dirty, null);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("the service label reports only that the endpoint answered, and adds no health subsystem", () => {
  assert.match(source, /status: "Responding"/);
  assert.doesNotMatch(codeOnly, /healthCheck|pingPm2|checkAssets|fetch\(/);
});

test("the request time is never reported as a deployment time", () => {
  assert.doesNotMatch(codeOnly, /lastDeployedAt:\s*new Date\(\)\.toISOString\(\)/);
});
