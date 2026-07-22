/* eslint-disable @typescript-eslint/no-require-imports, no-console, curly */
const http = require("http");
const crypto = require("crypto");
const { execFile } = require("child_process");
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

function runDeployment(onComplete) {
  execFile("./do-pull.sh", [], { cwd: PROJECT_DIR }, onComplete);
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

module.exports = { createWebhookServer, verifySignature };
