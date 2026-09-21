import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { test } from "node:test";

// Behavioral coverage of the own-account profile endpoint.
//
// The route runs for real, and so do the governed identity helpers it reuses
// (resolveAuthenticatedRequest and resolveAuthenticatedAccountPerson): only
// the Supabase HTTP boundary is mocked, the same technique
// app/api/member/identity-claim/verification/initiate-magic-link/route.test.ts
// and app/api/google/place-details/route.test.ts use. The assertions
// therefore read what the route actually transmitted -- which account the
// token check asked about, which bearer each call carried, and the exact
// single row read it issued -- rather than its source text.
//
// `server-only` is a bare specifier the Next build aliases to its own compiled
// stub; tsx does not apply that alias, so the same alias is applied here --
// for the duration of the route import only, and always removed afterwards.
// Nothing is stubbed away: the real server modules run.
//
// Nothing here proves production identity linkage or live database contents.
//
// Run with:
//   npx tsx --test app/api/member/account-profile/route.test.ts

const moduleInternals = Module as unknown as {
  _resolveFilename: (request: string, ...rest: unknown[]) => string;
};
/** Node's own resolver, captured before anything in this file runs. */
const NODE_RESOLVE_FILENAME = moduleInternals._resolveFilename;

let routeImport: Promise<typeof import("./route")> | null = null;

/**
 * Imports the real route with the `server-only` alias installed for exactly
 * that import, then restores Node's resolver -- including when the import
 * fails. Concurrent callers share the single import and the single alias
 * window, so the resolver is never patched twice or left patched.
 */
function loadRoute(): Promise<typeof import("./route")> {
  if (!routeImport) {
    const outerResolveFilename = moduleInternals._resolveFilename;
    moduleInternals._resolveFilename = function (
      request: string,
      ...rest: unknown[]
    ) {
      if (request === "server-only") {
        return outerResolveFilename.call(
          this,
          "next/dist/compiled/server-only/empty.js",
          ...rest,
        );
      }
      return outerResolveFilename.call(this, request, ...rest);
    };

    routeImport = import("./route").finally(() => {
      moduleInternals._resolveFilename = outerResolveFilename;
    });
  }

  return routeImport;
}

const SUPABASE_URL = "https://project.supabase.invalid";
const SERVICE_ROLE_KEY = "service-role-key-fixture";
const ANON_KEY = "anon-key-fixture";

const VALID_TOKEN = "valid-access-token-fixture";
const ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";
// The canonical Person this account is linked to: the account holder.
const PERSON_ID = "11111111-1111-4111-8111-111111111111";
// A different, unrelated Person a hostile caller might try to name.
const OTHER_PERSON_ID = "22222222-2222-4222-8222-222222222222";

const OWNER = { first: "Dana", last: "Okonkwo", full: "Dana Okonkwo" };
// The household pilot on the account holder's registrations. Never the
// account name, and never reachable through this endpoint.
const PILOT = { first: "Marcus", last: "Vasquez", full: "Marcus Vasquez" };

type Recorded = {
  method: string;
  url: string;
  authorization: string | null;
  apikey: string | null;
};

type PeopleOutcome =
  | { kind: "rows"; rows: Record<string, unknown>[] }
  | { kind: "error" };

type LinkOutcome =
  | { kind: "rows"; rows: Record<string, unknown>[] }
  | { kind: "error" };

type World = {
  /** null => the credential is rejected by Supabase Auth. */
  account: { id: string } | null;
  link: LinkOutcome;
  people: PeopleOutcome;
};

const resolvedLink: LinkOutcome = {
  kind: "rows",
  rows: [{ status: "resolved", person_id: PERSON_ID }],
};
const activeOwnerRow = {
  display_first_name: OWNER.first,
  display_last_name: OWNER.last,
  status: "active",
};

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function configureEnvironment() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
}

function restore() {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
}

/** Mocks the Supabase HTTP boundary and records every outbound request. */
function mockSupabase(world: World): Recorded[] {
  const recorded: Recorded[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);

    recorded.push({
      method,
      url,
      authorization: headers.get("authorization"),
      apikey: headers.get("apikey"),
    });

    const json = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });

    // Credential validation performed by the Server Authentication Boundary.
    if (url.startsWith(`${SUPABASE_URL}/auth/v1/user`)) {
      if (!world.account) {
        return json(401, { message: "invalid claim: missing sub claim" });
      }
      return json(200, {
        id: world.account.id,
        aud: "authenticated",
        role: "authenticated",
        email: "account@example.invalid",
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      });
    }

    // The governed Auth-to-Person link resolver used by the person bridge.
    if (url.includes("/rest/v1/rpc/resolve_current_auth_person_link")) {
      if (world.link.kind === "error") {
        return json(500, { message: "link lookup failed" });
      }
      return json(200, world.link.rows);
    }

    // The single exact canonical Person read this route performs.
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/people`)) {
      if (world.people.kind === "error") {
        return json(500, { message: "people read failed" });
      }
      return json(200, world.people.rows);
    }

    throw new Error(`unexpected outbound request: ${method} ${url}`);
  }) as typeof fetch;

  return recorded;
}

function request(url = "https://internal.invalid/api/member/account-profile", token: string | null = VALID_TOKEN) {
  const headers = new Headers();
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return new Request(url, { method: "GET", headers });
}

async function callRoute(world: World, req = request()) {
  configureEnvironment();
  const recorded = mockSupabase(world);
  const { GET } = await loadRoute();
  const response = await GET(req);
  const bodyText = await response.text();
  return {
    response,
    recorded,
    bodyText,
    body: JSON.parse(bodyText) as Record<string, unknown>,
  };
}

function peopleReads(recorded: Recorded[]) {
  return recorded.filter((entry) =>
    entry.url.startsWith(`${SUPABASE_URL}/rest/v1/people`),
  );
}

function linkCalls(recorded: Recorded[]) {
  return recorded.filter((entry) =>
    entry.url.includes("/rest/v1/rpc/resolve_current_auth_person_link"),
  );
}

/** Every response this endpoint can produce must be uncacheable and bare. */
function assertNeutralEnvelope(
  response: Response,
  body: Record<string, unknown>,
  bodyText: string,
) {
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(
    Object.keys(body),
    ["displayName"],
    "the response carries the display name and nothing else",
  );
  for (const secret of [PERSON_ID, OTHER_PERSON_ID, ACCOUNT_ID, VALID_TOKEN, SERVICE_ROLE_KEY]) {
    assert.ok(
      !bodyText.includes(secret),
      `no identifier or credential may appear in the response body (${secret.slice(0, 8)}...)`,
    );
  }
}

// ---------------------------------------------------------------------------

test("an authenticated account with a resolved, active Person is named from that Person -- one exact read, three columns, no other query", async () => {
  try {
    const { response, recorded, body, bodyText } = await callRoute({
      account: { id: ACCOUNT_ID },
      link: resolvedLink,
      people: { kind: "rows", rows: [activeOwnerRow] },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(body, { displayName: OWNER.full });
    assertNeutralEnvelope(response, body, bodyText);

    const reads = peopleReads(recorded);
    assert.equal(reads.length, 1, "exactly one canonical Person read");
    const readUrl = new URL(reads[0]!.url);
    assert.equal(readUrl.pathname, "/rest/v1/people");
    assert.equal(
      readUrl.searchParams.get("select"),
      "display_first_name,display_last_name,status",
      "only the display/status columns are selected",
    );
    assert.equal(
      readUrl.searchParams.get("id"),
      `eq.${PERSON_ID}`,
      "the read is pinned to the resolved canonical Person",
    );
    assert.deepEqual(
      [...readUrl.searchParams.keys()].sort(),
      ["id", "select"],
      "no other filter or selector participates in the read",
    );
    assert.equal(reads[0]!.method, "GET");
    assert.equal(
      reads[0]!.authorization,
      `Bearer ${SERVICE_ROLE_KEY}`,
      "the RLS-denied people table is read with the existing server-only service client",
    );

    // The link resolver runs under the caller's OWN credential, never the
    // service key, so it can only ever resolve that caller's link.
    const links = linkCalls(recorded);
    assert.equal(links.length, 1);
    assert.equal(links[0]!.authorization, `Bearer ${VALID_TOKEN}`);
  } finally {
    restore();
  }
});

test("a missing or invalid bearer is refused before any identity or profile lookup happens", async () => {
  for (const [label, req] of [
    ["no Authorization header", request(undefined, null)],
    ["rejected credential", request(undefined, "forged-token")],
  ] as const) {
    try {
      const { response, recorded, body, bodyText } = await callRoute(
        {
          // A rejected credential: Supabase Auth refuses the token.
          account: label === "no Authorization header" ? { id: ACCOUNT_ID } : null,
          link: resolvedLink,
          people: { kind: "rows", rows: [activeOwnerRow] },
        },
        req,
      );

      assert.equal(response.status, 401, label);
      assert.deepEqual(body, { displayName: null }, label);
      assertNeutralEnvelope(response, body, bodyText);
      assert.equal(linkCalls(recorded).length, 0, `${label}: no link resolution`);
      assert.equal(peopleReads(recorded).length, 0, `${label}: no Person read`);
    } finally {
      restore();
    }
  }
});

test("no link, an ambiguous link, and a failed link lookup are indistinguishable and never reach a Person read", async () => {
  const cases: [string, LinkOutcome][] = [
    ["no_link", { kind: "rows", rows: [{ status: "no_link", person_id: null }] }],
    [
      "invalid_or_ambiguous",
      { kind: "rows", rows: [{ status: "invalid_or_ambiguous", person_id: null }] },
    ],
    ["ambiguous multi-row", { kind: "rows", rows: [
      { status: "resolved", person_id: PERSON_ID },
      { status: "resolved", person_id: OTHER_PERSON_ID },
    ] }],
    ["lookup error", { kind: "error" }],
  ];

  for (const [label, link] of cases) {
    try {
      const { response, recorded, body, bodyText } = await callRoute({
        account: { id: ACCOUNT_ID },
        link,
        people: { kind: "rows", rows: [activeOwnerRow] },
      });

      assert.equal(response.status, 200, label);
      assert.deepEqual(body, { displayName: null }, `${label}: no name disclosed`);
      assertNeutralEnvelope(response, body, bodyText);
      assert.equal(
        peopleReads(recorded).length,
        0,
        `${label}: an unresolved link must never read a Person`,
      );
    } finally {
      restore();
    }
  }
});

test("a missing, merged, inactive, duplicated or unnamed Person discloses no name even when name columns are present", async () => {
  const cases: [string, PeopleOutcome][] = [
    ["missing person", { kind: "rows", rows: [] }],
    [
      "merged person",
      { kind: "rows", rows: [{ ...activeOwnerRow, status: "merged" }] },
    ],
    [
      "inactive person",
      { kind: "rows", rows: [{ ...activeOwnerRow, status: "inactive" }] },
    ],
    [
      "duplicate rows",
      {
        kind: "rows",
        rows: [activeOwnerRow, { ...activeOwnerRow, display_first_name: PILOT.first }],
      },
    ],
    [
      "active but unnamed",
      {
        kind: "rows",
        rows: [{ display_first_name: null, display_last_name: "   ", status: "active" }],
      },
    ],
    ["lookup error", { kind: "error" }],
  ];

  for (const [label, people] of cases) {
    try {
      const { response, body, bodyText } = await callRoute({
        account: { id: ACCOUNT_ID },
        link: resolvedLink,
        people,
      });

      assert.equal(response.status, 200, label);
      assert.deepEqual(body, { displayName: null }, `${label}: no name disclosed`);
      assertNeutralEnvelope(response, body, bodyText);
      assert.ok(
        !bodyText.includes(OWNER.first) && !bodyText.includes(PILOT.first),
        `${label}: no name material leaks`,
      );
    } finally {
      restore();
    }
  }
});

test("hostile client selectors in the URL cannot redirect the lookup to another Person", async () => {
  try {
    const hostileUrl = new URL("https://internal.invalid/api/member/account-profile");
    hostileUrl.searchParams.set("personId", OTHER_PERSON_ID);
    hostileUrl.searchParams.set("person_id", OTHER_PERSON_ID);
    hostileUrl.searchParams.set("id", OTHER_PERSON_ID);
    hostileUrl.searchParams.set("authUserId", "44444444-4444-4444-8444-444444444444");
    hostileUrl.searchParams.set("email", "someone.else@example.invalid");
    hostileUrl.searchParams.set("attendeeId", "55555555-5555-4555-8555-555555555555");
    hostileUrl.searchParams.set("displayName", PILOT.full);

    const req = new Request(hostileUrl, {
      method: "GET",
      headers: new Headers({
        authorization: `Bearer ${VALID_TOKEN}`,
        "x-person-id": OTHER_PERSON_ID,
        "x-forwarded-user": "someone.else@example.invalid",
        cookie: `person_id=${OTHER_PERSON_ID}; member_name=${PILOT.full}`,
      }),
    });

    const { response, recorded, body, bodyText } = await callRoute(
      {
        account: { id: ACCOUNT_ID },
        link: resolvedLink,
        people: { kind: "rows", rows: [activeOwnerRow] },
      },
      req,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(
      body,
      { displayName: OWNER.full },
      "the account's own Person is named, not the requested one",
    );
    assertNeutralEnvelope(response, body, bodyText);

    const reads = peopleReads(recorded);
    assert.equal(reads.length, 1);
    const readUrl = new URL(reads[0]!.url);
    assert.equal(readUrl.searchParams.get("id"), `eq.${PERSON_ID}`);
    assert.ok(
      !reads[0]!.url.includes(OTHER_PERSON_ID),
      "no client-supplied identifier reaches the read",
    );
    assert.ok(
      !recorded.some((entry) => entry.url.includes(OTHER_PERSON_ID)),
      "no client-supplied identifier reaches any outbound request",
    );
  } finally {
    restore();
  }
});

test("a resolved account with a different pilot on its registrations is still named from its own Person", async () => {
  try {
    // The registration/household pilot exists in the data set but is a
    // different Person; nothing in this route can reach that row.
    const { response, recorded, body } = await callRoute({
      account: { id: ACCOUNT_ID },
      link: resolvedLink,
      people: { kind: "rows", rows: [activeOwnerRow] },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(body, { displayName: OWNER.full });
    assert.equal(
      recorded.filter((entry) => entry.url.includes("attendees") || entry.url.includes("resolve_member_account")).length,
      0,
      "registration data is never consulted for the account name",
    );
  } finally {
    restore();
  }
});

test("a server misconfiguration fails closed instead of erroring or naming anyone", async () => {
  try {
    configureEnvironment();
    const recorded = mockSupabase({
      account: { id: ACCOUNT_ID },
      link: resolvedLink,
      people: { kind: "rows", rows: [activeOwnerRow] },
    });
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { GET } = await loadRoute();
    const response = await GET(request());
    const bodyText = await response.text();
    const body = JSON.parse(bodyText) as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.deepEqual(body, { displayName: null });
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(peopleReads(recorded).length, 0);
  } finally {
    restore();
  }
});

test("the route performs no write, identity creation, linking or finalization", async () => {
  try {
    const { recorded } = await callRoute({
      account: { id: ACCOUNT_ID },
      link: resolvedLink,
      people: { kind: "rows", rows: [activeOwnerRow] },
    });

    const writes = recorded.filter((entry) =>
      ["POST", "PUT", "PATCH", "DELETE"].includes(entry.method),
    );
    // The only non-GET call is the governed read-only link resolver RPC.
    assert.deepEqual(
      writes.map((entry) => new URL(entry.url).pathname),
      ["/rest/v1/rpc/resolve_current_auth_person_link"],
    );
    assert.ok(
      !recorded.some((entry) =>
        /finalize_|create_|link_|activate_|\/auth\/v1\/admin/.test(entry.url),
      ),
      "no identity creation, linking, finalization or admin auth call is made",
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Test hygiene

test("the server-only alias exists only for the route import: Node's resolver is restored, and concurrent loads share one window", async () => {
  // Every earlier test already imported the route; the resolver must be back.
  assert.equal(
    moduleInternals._resolveFilename,
    NODE_RESOLVE_FILENAME,
    "Node's resolver must not stay patched after the route import",
  );

  // Concurrent callers share the single import and never re-patch.
  const [a, b, c] = await Promise.all([loadRoute(), loadRoute(), loadRoute()]);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(typeof a.GET, "function", "the real route module is returned");
  assert.equal(moduleInternals._resolveFilename, NODE_RESOLVE_FILENAME);

  // The alias is genuinely gone: `server-only` is unresolvable again, exactly
  // as it is for any other module in this process.
  assert.throws(
    () => createRequire(__filename).resolve("server-only"),
    /Cannot find module 'server-only'/,
    "the alias must not leak into later resolution",
  );
});

test("a failing route import also restores the resolver", async () => {
  const before = moduleInternals._resolveFilename;
  let patchedDuringImport: unknown = null;

  // The same install/restore shape as loadRoute, against a module that does
  // not exist, proving the restoration is not tied to a successful import.
  const outer = moduleInternals._resolveFilename;
  moduleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
    if (request === "server-only") {
      return outer.call(this, "next/dist/compiled/server-only/empty.js", ...rest);
    }
    return outer.call(this, request, ...rest);
  };
  patchedDuringImport = moduleInternals._resolveFilename;

  // A computed specifier: the module genuinely does not exist, and this is
  // not a static import TypeScript would have to resolve.
  const missingModule = ["./this", "module", "does", "not", "exist"].join("-");
  await assert.rejects(
    import(missingModule).finally(() => {
      moduleInternals._resolveFilename = outer;
    }),
  );

  assert.notEqual(patchedDuringImport, before, "the alias was installed");
  assert.equal(moduleInternals._resolveFilename, before, "and restored after the failure");
  assert.equal(moduleInternals._resolveFilename, NODE_RESOLVE_FILENAME);
});

test("fixtures, global fetch and environment are left exactly as they were found", () => {
  assert.equal(globalThis.fetch, originalFetch, "global fetch is restored");
  assert.deepEqual(
    Object.keys(process.env).sort(),
    Object.keys(originalEnv).sort(),
    "no environment variable is added or removed",
  );
  for (const [key, value] of Object.entries(originalEnv)) {
    assert.equal(process.env[key], value, `process.env.${key} is unchanged`);
  }
  assert.equal(moduleInternals._resolveFilename, NODE_RESOLVE_FILENAME);
});
