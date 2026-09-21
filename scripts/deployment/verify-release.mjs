#!/usr/bin/env node
// Verifies a running Event Hub release over loopback.
//
// The health check this replaces fetched the root HTML with `--output
// /dev/null` and asked only for a non-error status. That cannot see the defect
// it needed to catch: during an in-place build the HTML kept returning 200
// while every asset it referenced had already been deleted. So this fetches
// the document, parses out the local CSS/JS it actually references, and
// retrieves each one.
//
// Uses node:http rather than fetch because the canonical Host header must be
// set explicitly -- the candidate is reached on 127.0.0.1 but must be asked
// the same question Nginx will ask it, so tenant/host resolution behaves the
// same way.
//
// No dependencies. Exits 0 only when everything checked passed.

import http from "node:http";
import https from "node:https";

function parseArgs(argv) {
  const args = {
    port: 3000,
    host: "127.0.0.1",
    hostHeader: "epicentrax.com",
    scheme: "http",
    paths: [],
    protected: [],
    totalTimeoutMs: Number(process.env.DEPLOY_VERIFY_TOTAL_TIMEOUT_MS || 20000),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split("=");
    const next = () => (inline !== undefined ? inline : argv[++i]);
    if (flag === "--port") args.port = Number(next());
    else if (flag === "--host") args.host = next();
    else if (flag === "--host-header") args.hostHeader = next();
    else if (flag === "--scheme") args.scheme = next();
    else if (flag === "--path") args.paths.push(next());
    else if (flag === "--protected") args.protected.push(next());
    else if (flag === "--total-timeout-ms") args.totalTimeoutMs = Number(next());
  }
  if (!Number.isFinite(args.totalTimeoutMs) || args.totalTimeoutMs <= 0) {
    throw new Error("total verifier timeout must be finite and positive");
  }
  if (args.paths.length === 0) args.paths.push("/");
  return args;
}

function request(args, path, deadline) {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(new Error("total verifier deadline exceeded"));
      return;
    }
    const controller = new AbortController();
    const expiry = setTimeout(() => controller.abort(), remaining);
    // Loopback + explicit Host is deliberate: the release must be asked the
    // same question Nginx will ask it, so tenant/host resolution behaves
    // identically. Over TLS the certificate is for the public name, not for
    // 127.0.0.1, so SNI carries the canonical name and verification is
    // relaxed -- this hop never leaves the host, and it is checking the
    // application, not the certificate chain.
    const transport = args.scheme === "https" ? https : http;
    const options = {
      hostname: args.host,
      port: args.port,
      path,
      method: "GET",
      headers: { Host: args.hostHeader },
      timeout: Math.min(15000, remaining),
      signal: controller.signal,
    };
    if (args.scheme === "https") {
      options.servername = args.hostHeader;
      options.rejectUnauthorized = false;
    }
    const req = transport.request(
      options,
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          clearTimeout(expiry);
          resolve({
            status: res.statusCode,
            location: res.headers.location,
            contentType: String(res.headers["content-type"] || ""),
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", (error) => {
      clearTimeout(expiry);
      reject(error);
    });
    req.end();
  });
}

/** Local CSS/JS the document actually references. Absolute URLs are skipped:
 *  this verifies what this release must serve, not third-party origins. */
export function referencedAssets(html) {
  const found = new Set();
  const add = (href) => {
    if (!href || /^[a-z]+:/i.test(href) || href.startsWith("//")) return;
    if (!href.startsWith("/")) return;
    if (/\.(css|js)(\?|$)/i.test(href)) found.add(href);
  };
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?(stylesheet|preload)["']?/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (href) add(href[1]);
  }
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) add(m[1]);
  return [...found];
}

export function expectedType(path) {
  return /\.css(\?|$)/i.test(path) ? "text/css" : "application/javascript";
}

/** An asset path that answers with an HTML document is the exact failure this
 *  check exists for: a rewrite or a 404 page masquerading as a 200 asset. */
export function assetProblem(path, res) {
  if (res.status !== 200) return `status ${res.status}`;
  if (res.body.length === 0) return "empty body";
  const type = res.contentType.toLowerCase();
  if (type.includes("text/html")) return `HTML returned as an asset (content-type ${res.contentType})`;
  const wanted = expectedType(path);
  if (wanted === "text/css" && !type.includes("css")) return `content-type ${res.contentType}, expected text/css`;
  if (wanted === "application/javascript" && !/javascript|ecmascript/.test(type))
    return `content-type ${res.contentType}, expected JavaScript`;
  return null;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Release verification configuration error: ${error.message}`);
    process.exit(1);
  }
  const failures = [];
  let assetCount = 0;
  const deadline = Date.now() + args.totalTimeoutMs;
  let expired = false;

  const checkedRequest = async (path) => {
    if (Date.now() >= deadline) {
      expired = true;
      throw new Error("total verifier deadline exceeded");
    }
    try {
      return await request(args, path, deadline);
    } catch (error) {
      if (Date.now() >= deadline || error.name === "AbortError") expired = true;
      throw error;
    }
  };

  for (const path of args.paths) {
    if (expired) break;
    let res;
    try {
      res = await checkedRequest(path);
    } catch (error) {
      failures.push(`${path}: request failed (${error.message})`);
      if (expired) break;
      continue;
    }
    if (res.status !== 200) { failures.push(`${path}: status ${res.status}`); continue; }
    if (!res.contentType.toLowerCase().includes("text/html")) {
      failures.push(`${path}: content-type ${res.contentType}, expected text/html`);
      continue;
    }
    if (res.body.length === 0) { failures.push(`${path}: empty HTML`); continue; }

    const assets = referencedAssets(res.body.toString("utf8"));
    if (assets.length === 0) failures.push(`${path}: no local CSS/JS referenced -- refusing to treat as verified`);

    for (const asset of assets) {
      if (expired) break;
      assetCount += 1;
      let assetRes;
      try {
        assetRes = await checkedRequest(asset);
      } catch (error) {
        failures.push(`${asset}: request failed (${error.message})`);
        if (expired) break;
        continue;
      }
      const problem = assetProblem(asset, assetRes);
      if (problem) failures.push(`${asset}: ${problem}`);
    }
    console.log(`  ${path}: HTML ok, ${assets.length} referenced assets checked`);
  }

  // A protected route must not start returning an unauthenticated 200 page.
  for (const path of args.protected) {
    if (expired) break;
    let res;
    try {
      res = await checkedRequest(path);
    } catch (error) {
      failures.push(`${path}: protected-route probe failed (${error.message})`);
      if (expired) break;
      continue;
    }
    const guarded = res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400);
    if (!guarded) failures.push(`${path}: expected redirect/401/403 for an unauthenticated request, got ${res.status}`);
    else console.log(`  ${path}: still protected (${res.status})`);
  }

  if (expired) failures.push(`total verifier deadline exceeded after ${args.totalTimeoutMs}ms`);

  if (failures.length > 0) {
    console.error(`Release verification FAILED (${failures.length} problem(s)):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`Release verification passed: ${args.paths.length} page(s), ${assetCount} asset(s).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(`Release verification error: ${error.message}`); process.exit(1); });
}
