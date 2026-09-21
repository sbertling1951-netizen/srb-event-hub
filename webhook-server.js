/* eslint-disable @typescript-eslint/no-require-imports, no-console, curly */
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");
const os = require("os");
const path = require("path");

const PORT = 9000;
const WEBHOOK_PATH = "/github-webhook";
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const PROJECT_DIR = path.join(os.homedir(), "srb-event-hub");

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}

function verifySignature(req, body) {
  const signature = req.headers["x-hub-signature-256"];

  if (!WEBHOOK_SECRET || typeof signature !== "string") return false;

  const expected = `sha256=${crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(body)
    .digest("hex")}`;
  const supplied = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return (
    supplied.length === expectedBuffer.length &&
    crypto.timingSafeEqual(supplied, expectedBuffer)
  );
}

// The worker is spawned in its OWN PROCESS GROUP and its output is streamed
// rather than buffered. Both matter:
//
//   * execFile buffers everything in memory and kills the child once the
//     buffer is exceeded -- a full `npm ci` plus build can pass any sane
//     limit, and the deployment would die mid-flight. Streaming removes the
//     limit entirely.
//   * execFile's timeout signals only the direct child. `npm` immediately
//     spawns `next`, `git`, and more; signalling npm alone orphans those and
//     leaves the deployment lock held by descendants nobody is tracking.
//     Killing the process group terminates the whole tree.
//
// Cancellation is bounded: TERM first so the worker's own traps can run, then
// KILL after a grace period. The lock the worker holds is released by the
// kernel when the last holder of the descriptor exits, so serialization stays
// effective until the tree is actually gone.
function deployTimeoutMs() {
  const raw = process.env.DEPLOY_TIMEOUT_MS;
  const value = Number(raw === undefined ? 30 * 60 * 1000 : raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error("DEPLOY_TIMEOUT_MS must be finite and positive");
  return value;
}
function deployKillGraceMs() {
  const raw = process.env.DEPLOY_KILL_GRACE_MS;
  const value = Number(raw === undefined ? 45 * 1000 : raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error("DEPLOY_KILL_GRACE_MS must be finite and positive");
  return value;
}

function runDeployment(onComplete) {
  let timeoutMs;
  let killGraceMs;
  try {
    timeoutMs = deployTimeoutMs();
    killGraceMs = deployKillGraceMs();
  } catch (error) {
    onComplete(error, "", "");
    return;
  }
  const child = spawn("./do-pull.sh", [], {
    cwd: PROJECT_DIR,
    detached: true, // own process group, so the whole tree can be signalled
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let killTimer = null;

  // Streamed, not accumulated without bound: keep only a tail for the log.
  const keepTail = (existing, chunk) => {
    const next = existing + chunk;
    return next.length > 64 * 1024 ? next.slice(next.length - 64 * 1024) : next;
  };
  child.stdout.on("data", (d) => (stdout = keepTail(stdout, d.toString())));
  child.stderr.on("data", (d) => (stderr = keepTail(stderr, d.toString())));

  const signalTree = (signal) => {
    try {
      process.kill(-child.pid, signal); // negative pid = the whole group
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    }
  };

  const timer = setTimeout(() => {
    timedOut = true;
    // SIGTERM first, then a grace period long enough for the worker's own
    // cleanup/recovery to run. Escalating immediately would kill the recovery
    // it was just asked to perform.
    log(`Deployment exceeded ${timeoutMs}ms; requesting bounded cleanup from the process tree.`);
    signalTree("SIGTERM");
    killTimer = setTimeout(() => {
      log(
        "Deployment did not exit after SIGTERM and its grace period; escalating to SIGKILL. " +
          "Cleanup and recovery may be incomplete, and the next deployment must resolve the state.",
      );
      signalTree("SIGKILL");
    }, killGraceMs);
  }, timeoutMs);

  // Fires exactly once: "error" and "close" can both arrive.
  let finished = false;
  const finish = (error) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    onComplete(error, stdout, stderr);
  };

  child.on("error", (error) => finish(error));
  // "close" means this child exited and its pipes are drained. It does NOT
  // establish that every descendant is gone -- a detached grandchild can keep
  // running. The worker proves its own cleanup; this callback only reports the
  // worker's outcome.
  child.on("close", (code, signal) => {
    if (code === 0 && !timedOut) return finish(null);
    const error = new Error(
      timedOut
        ? "Deployment timed out and its process tree was terminated"
        : `Deployment exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
    );
    error.code = code === null ? undefined : code;
    error.signal = signal;
    error.timedOut = timedOut;
    finish(error);
  });
}

function createWebhookServer({ deploy = runDeployment } = {}) {
  return http.createServer((req, res) => {
    let responseSent = false;
    let requestErrored = false;

    const finishResponse = (statusCode, body) => {
      if (responseSent) return false;
      responseSent = true;
      res.writeHead(statusCode);
      res.end(body);
      return true;
    };

    if (req.method !== "POST" || req.url !== WEBHOOK_PATH) {
      finishResponse(404, "Not found");
      return;
    }

    const chunks = [];
    let bodySize = 0;
    let bodyTooLarge = false;

    req.on("error", () => {
      requestErrored = true;
      if (responseSent) return;
      log("Webhook request-stream error.");
      finishResponse(400, "Request stream error");
    });

    req.on("data", (chunk) => {
      if (responseSent || requestErrored) return;

      bodySize += chunk.length;

      if (bodySize > MAX_WEBHOOK_BODY_BYTES) {
        if (!bodyTooLarge) {
          bodyTooLarge = true;
          chunks.length = 0;
          log("Webhook request rejected: body exceeds the 1 MB limit.");
          finishResponse(413, "Payload too large");
        }
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      if (responseSent || requestErrored || bodyTooLarge) {
        return;
      }

      const body = Buffer.concat(chunks);

      if (!WEBHOOK_SECRET) {
        log("Webhook configuration error: signing secret is not configured.");
        finishResponse(503, "Webhook is not configured");
        return;
      }

      if (!verifySignature(req, body)) {
        log("Webhook request rejected: invalid or missing signature.");
        finishResponse(401, "Invalid signature");
        return;
      }

      const eventType = req.headers["x-github-event"];

      if (eventType !== "push") {
        log(`Webhook event ignored: ${String(eventType || "unknown")}.`);
        finishResponse(202, "Event ignored");
        return;
      }

      let payload;

      try {
        payload = JSON.parse(body.toString("utf8"));
      } catch {
        log("Webhook request rejected: invalid JSON payload.");
        finishResponse(400, "Invalid payload");
        return;
      }

      if (payload?.ref !== "refs/heads/main") {
        log(`Webhook push ignored: ${String(payload?.ref || "unknown")}.`);
        finishResponse(202, "Push ignored");
        return;
      }

      const shortSha =
        typeof payload.after === "string"
          ? payload.after.slice(0, 12)
          : "unknown";
      log(`Webhook main push accepted: ${shortSha}.`);
      finishResponse(202, "Deployment started");

      setImmediate(() => {
        deploy((error, stdout, stderr) => {
          if (stdout) console.log(stdout.trim());
          if (stderr) console.error(stderr.trim());

          if (error?.code === 75) {
            log("Deployment already in progress; webhook deployment skipped.");
          } else if (error) {
            log(`Webhook deployment failed: ${error.message}`);
          } else {
            log("Webhook deployment completed.");
          }
        });
      });
    });
  });
}

if (require.main === module) {
  if (!WEBHOOK_SECRET) {
    log(
      "Webhook configuration error: signing secret is not configured; requests will be rejected.",
    );
  }

  createWebhookServer().listen(PORT, () => {
    log(`Webhook server listening on port ${PORT}.`);
  });
}

module.exports = { createWebhookServer, verifySignature, runDeployment };
