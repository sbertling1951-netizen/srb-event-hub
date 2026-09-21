import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WEBHOOK_SERVER =
  process.env.WEBHOOK_SERVER_UNDER_TEST || join(REPOSITORY_ROOT, "webhook-server.js");
const SECRET = "b1-test-secret";
const PAYLOAD = JSON.stringify({ ref: "refs/heads/main", after: "b1-test-sha" });

function signedHeaders() {
  return {
    "content-type": "application/json",
    "x-github-event": "push",
    "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET)
      .update(PAYLOAD)
      .digest("hex")}`,
  };
}

async function waitForPort(getOutput) {
  const deadline = Date.now() + 3000;
  while (!getOutput().includes("PORT=")) {
    if (Date.now() >= deadline) throw new Error(`server did not start: ${getOutput()}`);
    await delay(10);
  }
  return Number(getOutput().match(/PORT=(\d+)/)[1]);
}

async function startFixture({ env = {} } = {}) {
  const home = await mkdtemp(join(tmpdir(), "epicentrax-b1-"));
  const project = join(home, "srb-event-hub");
  await mkdir(project, { recursive: true });
  const marker = join(project, "launched");
  await writeFile(
    join(project, "do-pull.sh"),
    `#!/bin/sh\nprintf launched > ${JSON.stringify(marker)}\n`,
    { mode: 0o755 },
  );

  const child = spawn(process.execPath, [
    "-e",
    `const { createWebhookServer, runDeployment } = require(${JSON.stringify(WEBHOOK_SERVER)});\n` +
      `const server = createWebhookServer({ deploy: runDeployment });\n` +
      `server.listen(0, '127.0.0.1', () => console.log('PORT=' + server.address().port));\n`,
  ], {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, HOME: home, GITHUB_WEBHOOK_SECRET: SECRET, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const port = await waitForPort(() => output);
  return { child, marker, port, output: () => output, stderr: () => stderr };
}

async function sendPush(port) {
  const response = await fetch(`http://127.0.0.1:${port}/github-webhook`, {
    method: "POST",
    headers: signedHeaders(),
    body: PAYLOAD,
  });
  return { status: response.status, body: await response.text() };
}

async function collectOutput(fixture, requestCount) {
  for (let index = 0; index < 100; index += 1) {
    const output = fixture.output();
    if ((output.match(/Webhook deployment (?:failed:|completed\.)/g) || []).length >= requestCount) return output;
    await delay(10);
  }
  throw new Error(`deployment did not complete: ${fixture.output()}${fixture.stderr()}`);
}

async function stopFixture(fixture) {
  fixture.child.kill("SIGTERM");
  await new Promise((resolve) => fixture.child.once("close", resolve));
}

async function assertInvalidOverride(variable, value) {
  const fixture = await startFixture({ env: { [variable]: value } });
  try {
    assert.deepEqual(await sendPush(fixture.port), { status: 202, body: "Deployment started" });
    const output = await collectOutput(fixture, 1);
    assert.match(output, /Webhook deployment failed: .*must be finite and positive/);
    assert.equal((output.match(/Webhook deployment failed:/g) || []).length, 1);
    await delay(50);
    await assert.rejects(readFile(fixture.marker));
    assert.deepEqual(await sendPush(fixture.port), { status: 202, body: "Deployment started" });
    const secondOutput = await collectOutput(fixture, 2);
    assert.equal((secondOutput.match(/Webhook deployment failed:/g) || []).length, 2);
    assert.equal(fixture.child.exitCode, null);
  } finally {
    await stopFixture(fixture);
  }
}

await assertInvalidOverride("DEPLOY_TIMEOUT_MS", "0");
await assertInvalidOverride("DEPLOY_KILL_GRACE_MS", "abc");

const validFixture = await startFixture({ env: { DEPLOY_TIMEOUT_MS: "1000", DEPLOY_KILL_GRACE_MS: "1000" } });
try {
  assert.deepEqual(await sendPush(validFixture.port), { status: 202, body: "Deployment started" });
  const output = await collectOutput(validFixture, 1);
  assert.match(output, /Webhook deployment completed\./);
  assert.equal(await readFile(validFixture.marker, "utf8"), "launched");
  assert.equal((output.match(/Webhook deployment completed\./g) || []).length, 1);
} finally {
  await stopFixture(validFixture);
}

console.log("B1 webhook regression passed");