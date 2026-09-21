import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { NextRequest } from "next/server";

import { POST } from "./route";

// Behavioral coverage of the activation callback destination.
//
// The Supabase boundary is mocked at the HTTP layer (globalThis.fetch), the
// same technique app/api/google/place-details/route.test.ts uses, so the real
// supabase-js client runs and the assertions read the value actually
// transmitted to Supabase rather than the route's source text. auth-js sends
// `emailRedirectTo` as the `redirect_to` query parameter of POST /auth/v1/otp
// (node_modules/@supabase/auth-js/dist/main/lib/fetch.js), which is what these
// tests capture.
//
// Nothing here proves real email delivery or real identity finalization.
//
// Run with:
//   npx tsx --test app/api/member/identity-claim/verification/initiate-magic-link/route.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);
const CODE_ONLY = SOURCE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const SUPABASE_URL = "https://project.supabase.invalid";
const ATTEMPT_TOKEN = "attempt-token-7f3c9e51";
const EMAIL = "member@example.invalid";

type Captured = { rpc: string[]; otp: string[] };

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function restore() {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
}

/** Mocks the Supabase HTTP boundary and records what the route sent. */
function mockSupabase(canSendLink: boolean): Captured {
  const captured: Captured = { rpc: [], otp: [] };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes("/rest/v1/rpc/begin_member_identity_claim_magic_link")) {
      captured.rpc.push(url);
      return new Response(
        JSON.stringify([{ can_send_link: canSendLink, expires_at: "2026-09-21T00:00:00Z" }]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.includes("/auth/v1/otp")) {
      captured.otp.push(url);
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`unexpected outbound request: ${url} ${String(init?.method ?? "")}`);
  }) as typeof fetch;

  return captured;
}

function configure(appOrigin: string | undefined, nodeEnv = "test") {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-fixture";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-fixture";
  if (appOrigin === undefined) {
    delete process.env.EPICENTRAX_APP_ORIGIN;
  } else {
    process.env.EPICENTRAX_APP_ORIGIN = appOrigin;
  }
  (process.env as Record<string, string>).NODE_ENV = nodeEnv;
}

/** A request whose own origin and headers are all hostile to the destination. */
function hostileRequest(attemptToken = ATTEMPT_TOKEN) {
  return new NextRequest("https://internal-pod.invalid/api/member/identity-claim/verification/initiate-magic-link", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "attacker.example",
      "x-forwarded-host": "attacker.example",
      "x-forwarded-proto": "http",
      origin: "https://attacker.example",
      referer: "https://attacker.example/activate",
      "user-agent": "fixture-agent",
      "x-forwarded-for": "203.0.113.9",
    },
    body: JSON.stringify({ attemptToken, email: EMAIL }),
  });
}

function redirectFrom(captured: Captured) {
  assert.equal(captured.otp.length, 1, "exactly one activation email should be requested");
  const sent = new URL(captured.otp[0]!);
  const redirect = sent.searchParams.get("redirect_to");
  assert.ok(redirect, "the OTP request must carry a redirect_to");
  return new URL(redirect!);
}

// ---------------------------------------------------------------------------

test("the activation callback origin comes ONLY from EPICENTRAX_APP_ORIGIN -- the internal request origin and hostile Host headers cannot change it", async () => {
  configure("https://epicentrax.com");
  const captured = mockSupabase(true);
  try {
    const req = hostileRequest();
    assert.equal(req.nextUrl.origin, "https://internal-pod.invalid", "fixture precondition");
    const res = await POST(req);
    assert.equal(res.status, 200);

    const redirect = redirectFrom(captured);
    assert.equal(redirect.origin, "https://epicentrax.com");
    assert.equal(
      redirect.toString(),
      `https://epicentrax.com/auth/callback?purpose=activation&attempt_token=${ATTEMPT_TOKEN}`,
    );
    assert.doesNotMatch(redirect.toString(), /internal-pod|attacker\.example/);
  } finally {
    restore();
  }
});

test("the callback destination is /auth/callback carrying the activation purpose and the exact attempt token", async () => {
  configure("https://epicentrax.com");
  const captured = mockSupabase(true);
  try {
    await POST(hostileRequest());
    const redirect = redirectFrom(captured);
    assert.equal(redirect.pathname, "/auth/callback");
    assert.equal(redirect.searchParams.get("purpose"), "activation");
    assert.equal(redirect.searchParams.get("attempt_token"), ATTEMPT_TOKEN);
  } finally {
    restore();
  }
});

test("an attempt token needing encoding survives the callback query intact (URL APIs, not string concatenation)", async () => {
  const awkward = "tok+en/with=chars&more";
  configure("https://epicentrax.com");
  const captured = mockSupabase(true);
  try {
    await POST(hostileRequest(awkward));
    const redirect = redirectFrom(captured);
    assert.equal(redirect.searchParams.get("attempt_token"), awkward);
    assert.equal(redirect.searchParams.get("purpose"), "activation");
  } finally {
    restore();
  }
});

test("a home-page destination is never produced: the callback path is always present", async () => {
  configure("https://epicentrax.com");
  const captured = mockSupabase(true);
  try {
    await POST(hostileRequest());
    const redirect = redirectFrom(captured);
    assert.notEqual(redirect.pathname, "/");
    assert.equal(redirect.pathname, "/auth/callback");
  } finally {
    restore();
  }
});

test("missing configuration fails closed: no challenge is created and no email is requested", async () => {
  configure(undefined);
  const captured = mockSupabase(true);
  try {
    const res = await POST(hostileRequest());
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.result, "CONTINUE_VERIFICATION");
    assert.equal(body.verificationRequested, undefined, "the generic response must not claim a request was made");
    assert.equal(captured.rpc.length, 0, "no activation challenge may be created");
    assert.equal(captured.otp.length, 0, "no email may be requested");
  } finally {
    restore();
  }
});

for (const [label, value] of [
  ["not a URL", "epicentrax.com"],
  ["embedded credentials", "https://user:secret@epicentrax.com"],
  ["a query string", "https://epicentrax.com/?next=/admin"],
  ["a fragment", "https://epicentrax.com/#/admin"],
  ["a non-root path", "https://epicentrax.com/app"],
  ["a non-HTTPS non-loopback host", "http://epicentrax.com"],
  ["an unsupported scheme", "ftp://epicentrax.com"],
  ["an empty value", ""],
] as const) {
  test(`invalid configuration (${label}) fails closed: no challenge, no email`, async () => {
    configure(value);
    const captured = mockSupabase(true);
    try {
      const res = await POST(hostileRequest());
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body.verificationRequested, undefined);
      assert.equal(captured.rpc.length, 0, `${label}: no challenge may be created`);
      assert.equal(captured.otp.length, 0, `${label}: no email may be requested`);
    } finally {
      restore();
    }
  });
}

test("in production a loopback origin is refused even over HTTPS", async () => {
  for (const value of ["https://localhost:3000", "https://127.0.0.1:3000", "http://localhost:3000"]) {
    configure(value, "production");
    const captured = mockSupabase(true);
    try {
      await POST(hostileRequest());
      assert.equal(captured.rpc.length, 0, `${value}: no challenge in production`);
      assert.equal(captured.otp.length, 0, `${value}: no email in production`);
    } finally {
      restore();
    }
  }
});

test("outside production a loopback HTTP origin is accepted for local development", async () => {
  configure("http://localhost:3000", "development");
  const captured = mockSupabase(true);
  try {
    await POST(hostileRequest());
    const redirect = redirectFrom(captured);
    assert.equal(redirect.origin, "http://localhost:3000");
    assert.equal(redirect.pathname, "/auth/callback");
  } finally {
    restore();
  }
});

test("a valid eligible attempt requests exactly one email, after exactly one challenge", async () => {
  configure("https://epicentrax.com");
  const captured = mockSupabase(true);
  try {
    const res = await POST(hostileRequest());
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.verificationRequested, true);
    assert.equal(body.channel, "email");
    assert.equal(captured.rpc.length, 1);
    assert.equal(captured.otp.length, 1);
  } finally {
    restore();
  }
});

test("a denied eligibility creates the challenge record but requests no email, with an unchanged generic response", async () => {
  configure("https://epicentrax.com");
  const captured = mockSupabase(false);
  try {
    const res = await POST(hostileRequest());
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.result, "CONTINUE_VERIFICATION");
    assert.equal(body.verificationRequested, true, "the response must not reveal that nothing was sent");
    assert.equal(captured.rpc.length, 1);
    assert.equal(captured.otp.length, 0, "an ineligible attempt must not trigger an email");
  } finally {
    restore();
  }
});

// Secondary guard, not the primary evidence: the request must never be a source
// of the redirect origin again.
test("the redirect origin is not derived from the request anywhere in the handler", () => {
  assert.doesNotMatch(CODE_ONLY, /new URL\([^)]*req\.nextUrl\.origin/);
  assert.doesNotMatch(CODE_ONLY, /emailRedirectTo[\s\S]{0,120}nextUrl/);
  assert.match(CODE_ONLY, /process\.env\.EPICENTRAX_APP_ORIGIN/);
});
