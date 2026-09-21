import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import test from "node:test";

import { assetProblem, expectedType, referencedAssets } from "./verify-release.mjs";

// Run with: node --test scripts/deployment/verify-release.test.mjs


const VERIFIER = new URL("./verify-release.mjs", import.meta.url).pathname;

/** Runs the verifier asynchronously. spawnSync would block this process's own
 *  event loop, so the fixture server in the same process could never answer. */
function runVerifier(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [VERIFIER, ...args], { encoding: "utf8" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const asset = (status, contentType, body) => ({
  status,
  contentType,
  body: Buffer.from(body),
});

test("referenced assets are extracted from stylesheet links, preloads and scripts", () => {
  const html = `<!doctype html><html><head>
    <link rel="stylesheet" href="/_next/static/chunks/a.css"/>
    <link rel="preload" as="style" href="/_next/static/chunks/b.css"/>
    <link rel="icon" href="/favicon.ico"/>
    </head><body><script src="/_next/static/chunks/c.js"></script></body></html>`;
  assert.deepEqual(referencedAssets(html).sort(), [
    "/_next/static/chunks/a.css",
    "/_next/static/chunks/b.css",
    "/_next/static/chunks/c.js",
  ]);
});

test("third-party and non-asset references are ignored -- this verifies what THIS release serves", () => {
  const html = `<link rel="stylesheet" href="https://cdn.example.com/x.css"/>
    <link rel="stylesheet" href="//cdn.example.com/y.css"/>
    <script src="https://example.com/z.js"></script>
    <link rel="icon" href="/favicon.ico"/>`;
  assert.deepEqual(referencedAssets(html), []);
});

test("an asset that answers with HTML is rejected -- the exact shape of the incident", () => {
  const problem = assetProblem(
    "/_next/static/chunks/a.css",
    asset(200, "text/html; charset=utf-8", "<!doctype html><html>404</html>"),
  );
  assert.match(problem, /HTML returned as an asset/);
});

test("a missing asset is rejected on status", () => {
  assert.equal(assetProblem("/_next/static/chunks/a.css", asset(404, "text/html", "x")), "status 404");
});

test("an empty asset is rejected even with a correct status and type", () => {
  assert.equal(assetProblem("/_next/static/chunks/a.css", asset(200, "text/css", "")), "empty body");
});

test("content type must match the asset kind", () => {
  assert.match(
    assetProblem("/_next/static/chunks/a.css", asset(200, "application/javascript", "body{}")),
    /expected text\/css/,
  );
  assert.match(
    assetProblem("/_next/static/chunks/a.js", asset(200, "text/css", "x")),
    /expected JavaScript/,
  );
  assert.equal(assetProblem("/_next/static/chunks/a.css", asset(200, "text/css; charset=UTF-8", "body{}")), null);
  assert.equal(assetProblem("/_next/static/chunks/a.js", asset(200, "text/javascript", "x")), null);
});

test("expected type is derived from the asset extension", () => {
  assert.equal(expectedType("/x/a.css"), "text/css");
  assert.equal(expectedType("/x/a.js"), "application/javascript");
});

test("the canonical Host header is sent to the loopback release", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, host: req.headers.host });
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<link rel="stylesheet" href="/_next/static/chunks/a.css"/>');
      return;
    }
    res.writeHead(200, { "content-type": "text/css" });
    res.end("body{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const result = await runVerifier(["--port", String(port), "--host-header", "epicentrax.com", "--path", "/"]);
  server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.ok(seen.length >= 2, "expected the document and its asset to be fetched");
  for (const request of seen) assert.equal(request.host, "epicentrax.com");
});

test("a page referencing no local CSS/JS is not treated as verified", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body>bare</body></html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const result = await runVerifier(["--port", String(port), "--path", "/"]);
  server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /no local CSS\/JS referenced/);
});

test("a cumulative verifier deadline stops later requests and never reports success", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    setTimeout(() => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(req.url === "/first" ? '<link rel="stylesheet" href="/first.css"/>' : "<html></html>");
    }, 70);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const result = await runVerifier([
    "--port", String(port), "--total-timeout-ms", "100", "--path", "/first", "--path", "/second",
  ]);
  server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /total verifier deadline exceeded/);
  assert.doesNotMatch(result.stdout, /Release verification passed/);
  assert.deepEqual(seen, ["/first", "/first.css"]);
});

test("a continuously trickling response is aborted by the total verifier deadline", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.write('<link rel="stylesheet" href="/slow.css">');
    const interval = setInterval(() => res.write("x"), 10);
    req.on("close", () => clearInterval(interval));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const result = await runVerifier([
    "--port", String(port), "--total-timeout-ms", "80", "--path", "/",
  ]);
  server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /total verifier deadline exceeded/);
  assert.doesNotMatch(result.stdout, /Release verification passed/);
});

test("a non-positive verifier deadline is rejected", async () => {
  const result = await runVerifier(["--total-timeout-ms", "0", "--path", "/"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /total verifier timeout must be finite and positive/);
});
