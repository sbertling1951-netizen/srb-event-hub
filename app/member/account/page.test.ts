import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ResolvedRegistration } from "@/lib/memberAccountSession";

import {
  AccountIdentityHeader,
  applyAccountProfileName,
  EventCard,
  fetchAccountProfileName,
} from "./page";

// Member Event Context Stage 2: the account page is the existing,
// reused recovery surface for an invalid established Event context --
// no new Member application shell was built for this.
//
// The account-name correction is covered behaviorally: the identity header
// and event card are rendered with react-dom/server (this repository's
// established component technique), and the name loader is driven directly
// so request shape, failure handling and staleness are asserted from what the
// code actually does rather than from its source text. Source assertions
// cover only wiring a render cannot reach.
//
// Run with:
//   npx tsx --test app/member/account/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);
const CODE_ONLY = SOURCE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

// Two different synthetic people. The account belongs to the co-pilot; the
// household registration is entered under the pilot.
const OWNER = "Dana Okonkwo";
const PILOT_FIRST = "Marcus";
const PILOT_LAST = "Vasquez";
const PILOT = `${PILOT_FIRST} ${PILOT_LAST}`;
const OWNER_EMAIL = "marcus.vasquez@example.invalid";

function householdRegistration(
  overrides: Partial<ResolvedRegistration> = {},
): ResolvedRegistration {
  return {
    attendee_id: "attendee-1",
    entry_id: "ENTRY-42",
    event_id: "event-1",
    email: OWNER_EMAIL,
    pilot_first: PILOT_FIRST,
    pilot_last: PILOT_LAST,
    copilot_first: "Dana",
    copilot_last: "Okonkwo",
    has_arrived: false,
    event_name: "Spring Rally",
    venue_name: "Riverside Park",
    location: null,
    start_date: "2026-05-01",
    end_date: "2026-05-03",
    lat: null,
    lng: null,
    ...overrides,
  };
}

function headingOf(html: string): string {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  assert.ok(match, "the identity block must render exactly one heading");
  return match![1]!.replace(/<[^>]+>/g, "").trim();
}

// ---------------------------------------------------------------------------
// Retained event/identity guards

test("reads the contextInvalid flag from the URL, not from any client-trusted identity/authorization value", () => {
  assert.match(SOURCE, /searchParams\.get\("contextInvalid"\) === "1"/);
});

test("account/session data is always re-loaded fresh via resolve_member_account regardless of the flag", () => {
  assert.match(SOURCE, /"resolve_member_account"/);
  const loadFn = SOURCE.slice(
    SOURCE.indexOf("const load = useCallback"),
    SOURCE.indexOf("[invalidateAccountLoad, router],"),
  );
  assert.equal(/contextInvalid/.test(loadFn), false);
});

test("Open Event refreshes the shared workspace after canonical session completion and before navigation", () => {
  assert.match(
    SOURCE,
    /import \{ useMemberWorkspace \} from "@\/lib\/memberWorkspace\/useMemberWorkspace"/,
  );
  assert.match(SOURCE, /const workspace = useMemberWorkspace\(\);/);

  const openRegistration = SOURCE.slice(
    SOURCE.indexOf("async function openRegistration"),
    SOURCE.indexOf("async function handleSignOut"),
  );
  const complete = openRegistration.indexOf(
    "await enterResolvedRegistration(row, authUserId)",
  );
  const refresh = openRegistration.indexOf("workspace.refresh();");
  const navigate = openRegistration.indexOf("router.push(destination);");

  assert.ok(complete >= 0, "shared session completion must run");
  assert.ok(refresh > complete, "workspace refresh follows session completion");
  assert.ok(navigate > refresh, "navigation follows workspace refresh");
  assert.equal(/contextInvalid/.test(openRegistration), false);
});

test("exposes a platform-level 'Create an Event' pathway linking to /organize, above the member-event list", () => {
  // the action + its supporting copy are present
  assert.match(SOURCE, /Create an Event/);
  assert.match(SOURCE, /Planning an event\? Start a private event draft\./);
  // it links exactly to /organize (typed-route convention, same as LoginSelector)
  assert.match(SOURCE, /href=\{"\/organize" as Route\}/);
  assert.match(SOURCE, /import type \{ Route \} from "next"/);

  // it sits immediately below the EpicentraX Account card and before the
  // Upcoming Events section -- visually separate from the member-event cards
  const accountCard = SOURCE.indexOf("<AccountIdentityHeader");
  const cta = SOURCE.indexOf('Planning an event? Start a private event draft.');
  const upcoming = SOURCE.indexOf('title="Upcoming Events"');
  const eventGroupComponent = SOURCE.indexOf("function EventGroup");
  assert.ok(accountCard >= 0 && cta > accountCard, "the CTA follows the EpicentraX Account card");
  assert.ok(upcoming > cta, "the CTA precedes the Upcoming Events section");
  assert.ok(cta < eventGroupComponent, "the CTA is not part of the member-event card list");

  // it is a plain navigation link -- it does not touch registrations, session,
  // sign-out, or event access
  const ctaBlock = SOURCE.slice(cta - 400, cta + 400);
  assert.equal(/handleSignOut|resolve_member_account|enterResolvedRegistration|openRegistration/.test(ctaBlock), false);
});

test("shows an explicit, non-alarming message and does not expose internal authorization detail", () => {
  assert.match(
    SOURCE,
    /This Event is no longer available to this account\. Choose another\s*\n\s*Event below\./,
  );
  assert.equal(/invalid_authorization|event_missing|ambiguous_person/.test(SOURCE), false);
});

// ---------------------------------------------------------------------------
// The account heading names the account holder, not a registration

test("the heading shows the canonical account holder's name, with no registration or email inference anywhere in the block", () => {
  const html = renderToStaticMarkup(
    createElement(AccountIdentityHeader, {
      displayName: OWNER,
      email: OWNER_EMAIL,
    }),
  );

  assert.equal(headingOf(html), OWNER);
  assert.ok(!html.includes(PILOT), "a household pilot name never appears in the identity block");
  assert.match(html, /EpicentraX Account/);
  // The account's own verified email is still shown, unchanged -- but it is
  // never the source of the heading.
  assert.ok(html.includes(OWNER_EMAIL));
});

test("with no name available the heading is neutral -- never the email local part, never 'Member', never a registration name", () => {
  const html = renderToStaticMarkup(
    createElement(AccountIdentityHeader, {
      displayName: null,
      email: OWNER_EMAIL,
    }),
  );

  assert.equal(headingOf(html), "Account");
  const heading = headingOf(html);
  for (const inference of ["marcus", "vasquez", "marcus.vasquez", "Member", PILOT]) {
    assert.ok(
      !heading.toLowerCase().includes(inference.toLowerCase()),
      `the neutral heading must not contain "${inference}"`,
    );
  }

  // An account with no verified email on the session renders the same neutral
  // heading and simply omits the email line.
  const withoutEmail = renderToStaticMarkup(
    createElement(AccountIdentityHeader, { displayName: null, email: null }),
  );
  assert.equal(headingOf(withoutEmail), "Account");
  assert.ok(!withoutEmail.includes("@"));
});

test("the heading is identical whether or not registrations exist -- registrations are not an input to it", () => {
  // The account holder's name is produced without any registration data at
  // all, which is exactly the zero-registration case.
  const html = renderToStaticMarkup(
    createElement(AccountIdentityHeader, { displayName: OWNER, email: OWNER_EMAIL }),
  );
  assert.equal(headingOf(html), OWNER);

  // The page keeps its existing zero-registration message, unchanged.
  assert.match(
    SOURCE,
    /Your EpicentraX account is active, but no available event\s*\n\s*registrations are currently linked to it\./,
  );

  // The defective derivation is gone, and nothing reachable from the heading
  // consults registrations or the email address.
  assert.doesNotMatch(CODE_ONLY, /deriveDisplayName/);
  assert.doesNotMatch(CODE_ONLY, /email\.split\("@"\)/);
  const header = CODE_ONLY.slice(
    CODE_ONLY.indexOf("export function AccountIdentityHeader"),
    CODE_ONLY.indexOf("export default function MemberAccountPage"),
  );
  assert.doesNotMatch(header, /registration|pilot|split/i);

  // The page passes only the loaded account name into the heading.
  assert.match(
    SOURCE,
    /<AccountIdentityHeader\s*\n\s*displayName=\{accountName\}\s*\n\s*email=\{verifiedEmail\}\s*\n\s*\/>/,
  );
  assert.match(CODE_ONLY, /const \[accountName, setAccountName\] = useState<string \| null>\(null\);/);
  // accountName is only ever set by the profile loader, or cleared.
  const assignments = [...CODE_ONLY.matchAll(/setAccountName\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(assignments, ["null"], "the only direct assignment clears the name");
  assert.match(CODE_ONLY, /onName: setAccountName,/);
});

// ---------------------------------------------------------------------------
// The registration name is labelled, never presented as the account owner

test("an event card labels its registration name so a household pilot is never read as the account holder", () => {
  const html = renderToStaticMarkup(
    createElement(EventCard, {
      row: householdRegistration(),
      onOpen: () => {},
      opening: false,
    }),
  );

  assert.match(html, /Registration: Marcus Vasquez/);
  assert.ok(
    !new RegExp(`(^|>)\\s*${PILOT}\\s*(<|$)`).test(html),
    "the pilot name never appears as a bare, unlabelled identity",
  );
  // Existing card semantics are untouched.
  assert.match(html, /Spring Rally/);
  assert.match(html, /Riverside Park/);
  assert.match(html, /2026-05-01 – 2026-05-03/);
  assert.match(html, /Open Event/);
  assert.ok(!html.includes("Checked in"));

  const arrived = renderToStaticMarkup(
    createElement(EventCard, {
      row: householdRegistration({ has_arrived: true }),
      onOpen: () => {},
      opening: true,
    }),
  );
  assert.match(arrived, /Registration: Marcus Vasquez/);
  assert.match(arrived, /Checked in/);
  assert.match(arrived, /Opening\.\.\./);

  // The shared helper is still the single source of the registration name and
  // is used unchanged -- including its co-pilot and entry-id fallbacks.
  assert.match(CODE_ONLY, /const registrationName = registrationDisplayName\(row\);/);
  const copilotOnly = renderToStaticMarkup(
    createElement(EventCard, {
      row: householdRegistration({ pilot_first: null, pilot_last: null }),
      onOpen: () => {},
      opening: false,
    }),
  );
  assert.match(copilotOnly, /Registration: Dana Okonkwo/);
  const entryOnly = renderToStaticMarkup(
    createElement(EventCard, {
      row: householdRegistration({
        pilot_first: null,
        pilot_last: null,
        copilot_first: null,
        copilot_last: null,
      }),
      onOpen: () => {},
      opening: false,
    }),
  );
  assert.match(entryOnly, /Registration: ENTRY-42/);
});

// ---------------------------------------------------------------------------
// Loading the name: request shape, failure handling, staleness

type Call = { url: string; init: RequestInit | undefined };

function recordingFetch(
  responder: (call: Call) => Promise<Response> | Response,
): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const call = { url, init };
    calls.push(call);
    return responder(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

test("the name is requested from the governed endpoint with this session's bearer only -- no person, email or registration selector", async () => {
  const { fetchImpl, calls } = recordingFetch(() =>
    jsonResponse({ displayName: OWNER }),
  );

  const name = await fetchAccountProfileName("access-token-fixture", fetchImpl);

  assert.equal(name, OWNER);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "/api/member/account-profile");
  assert.equal(calls[0]!.init?.method, "GET");
  assert.deepEqual(calls[0]!.init?.headers, {
    Authorization: "Bearer access-token-fixture",
  });
  assert.equal(calls[0]!.init?.cache, "no-store");
  assert.equal(calls[0]!.init?.body, undefined);
  // Nothing identifying anyone travels in the request.
  const serialized = JSON.stringify(calls[0]);
  for (const selector of ["person", "attendee", "email", "registration", PILOT, OWNER]) {
    assert.ok(
      !serialized.toLowerCase().includes(selector.toLowerCase()),
      `the request must not carry "${selector}"`,
    );
  }
});

test("every unavailable outcome yields no name instead of a guessed one, and never throws", async () => {
  const cases: [string, () => Response | Promise<Response>][] = [
    ["401", () => jsonResponse({ displayName: null }, 401)],
    ["500", () => jsonResponse({ displayName: null }, 500)],
    // A refused or failed response is never trusted for its content, even
    // when something upstream put a name in the body.
    ["401 carrying a name", () => jsonResponse({ displayName: "Stale Person" }, 401)],
    ["403 carrying a name", () => jsonResponse({ displayName: PILOT }, 403)],
    ["500 carrying a name", () => jsonResponse({ displayName: PILOT }, 500)],
    ["502 carrying a name", () => jsonResponse({ displayName: OWNER }, 502)],
    ["explicit null", () => jsonResponse({ displayName: null })],
    ["missing field", () => jsonResponse({})],
    ["non-string", () => jsonResponse({ displayName: 42 })],
    ["blank name", () => jsonResponse({ displayName: "   " })],
    ["unparseable body", () => new Response("<html>gateway</html>", { status: 200 })],
    [
      "network failure",
      () => Promise.reject(new TypeError("Failed to fetch")),
    ],
  ];

  for (const [label, responder] of cases) {
    const { fetchImpl } = recordingFetch(responder);
    const name = await fetchAccountProfileName("access-token-fixture", fetchImpl);
    assert.equal(name, null, `${label} must yield no name`);
  }
});

test("a name that arrives after its load was superseded cannot replace the newer one", async () => {
  const applied: (string | null)[] = [];
  const firstRun = {};
  const secondRun = {};
  let currentRun: object = firstRun;

  let releaseFirst: (() => void) | null = null;
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const { fetchImpl: slowFetch } = recordingFetch(async () => {
    await firstPending;
    return jsonResponse({ displayName: "Stale Person" });
  });

  // The first load is still in flight...
  const first = applyAccountProfileName({
    accessToken: "token-a",
    isCurrent: () => currentRun === firstRun,
    onName: (name) => applied.push(name),
    fetchImpl: slowFetch,
  });

  // ...when a reload supersedes it and completes first.
  currentRun = secondRun;
  const { fetchImpl: fastFetch } = recordingFetch(() =>
    jsonResponse({ displayName: OWNER }),
  );
  await applyAccountProfileName({
    accessToken: "token-b",
    isCurrent: () => currentRun === secondRun,
    onName: (name) => applied.push(name),
    fetchImpl: fastFetch,
  });

  assert.deepEqual(applied, [OWNER]);

  releaseFirst!();
  await first;

  assert.deepEqual(
    applied,
    [OWNER],
    "the superseded load must not overwrite the current account name",
  );
});

test("an unmounted or signed-out load applies nothing at all, even on success", async () => {
  const applied: (string | null)[] = [];
  const { fetchImpl } = recordingFetch(() => jsonResponse({ displayName: OWNER }));

  await applyAccountProfileName({
    accessToken: "token",
    isCurrent: () => false,
    onName: (name) => applied.push(name),
    fetchImpl,
  });

  assert.deepEqual(applied, []);
});

test("a profile failure resolves quietly with no name, so it cannot interrupt the event list load", async () => {
  const applied: (string | null)[] = [];
  const { fetchImpl } = recordingFetch(() =>
    Promise.reject(new TypeError("Failed to fetch")),
  );

  await assert.doesNotReject(
    applyAccountProfileName({
      accessToken: "token",
      isCurrent: () => true,
      onName: (name) => applied.push(name),
      fetchImpl,
    }),
  );

  assert.deepEqual(applied, [null]);
});

test("the load is keyed on the observed Auth identity, clears first, and never gates the registration list", () => {
  const loadFn = CODE_ONLY.slice(
    CODE_ONLY.indexOf("const load = useCallback"),
    CODE_ONLY.indexOf("[invalidateAccountLoad, router],"),
  );

  // Every load starts by clearing the account data already on screen, before
  // anything is checked, so a reload cannot keep showing a previous account.
  const clearIdx = loadFn.indexOf("invalidateAccountLoad();");
  const sessionIdx = loadFn.indexOf("await supabase.auth.getSession()");
  assert.ok(clearIdx >= 0 && clearIdx < sessionIdx, "the previous account's data is cleared first");
  const invalidate = CODE_ONLY.slice(
    CODE_ONLY.indexOf("const invalidateAccountLoad = useCallback"),
    CODE_ONLY.indexOf("}, []);", CODE_ONLY.indexOf("const invalidateAccountLoad = useCallback")),
  );
  for (const cleared of [
    "accountLoadRunRef.current = null;",
    "sessionUnresolvedRef.current = false;",
    'setLoadStatus("checking");',
    "setAccountName(null);",
    "setVerifiedEmail(null);",
    "setAuthUserId(null);",
    "setRegistrations([]);",
    "setWorkspaceContextShadow(null);",
  ]) {
    assert.ok(invalidate.includes(cleared), `invalidating the load must run ${cleared}`);
  }

  // A fresh run token per load, and currentness re-checked at every
  // asynchronous boundary before a result is adopted.
  assert.match(loadFn, /const accountLoadRun = \{\};\s*\n\s*accountLoadRunRef\.current = accountLoadRun;/);
  assert.match(loadFn, /const isCurrent = \(\) => accountLoadRunRef\.current === accountLoadRun;/);
  assert.match(
    loadFn,
    /await supabase\.auth\.getSession\(\);\s*\n\s*if \(!isCurrent\(\)\) \{\s*\n\s*return;/,
    "a session answer is only adopted while its own run is current",
  );
  assert.match(
    loadFn,
    /if \(!session \|\| session\.user\.id !== expectedAccountId\) \{\s*\n\s*sessionUnresolvedRef\.current = true;\s*\n\s*return;/,
    "an obsolete or mismatched session answer neither redirects nor loads, and is recorded as unresolved",
  );
  assert.ok(
    loadFn.indexOf("if (!isCurrent())") < loadFn.indexOf("sessionUnresolvedRef.current = true;"),
    "only a still-current run may mark the account unresolved",
  );
  assert.match(
    loadFn,
    /"resolve_member_account",\s*\n\s*\);\s*\n\s*\n\s*if \(!isCurrent\(\)\) \{\s*\n\s*return;/,
    "a registration answer is only adopted while its own run is current",
  );
  assert.match(
    loadFn,
    /\)\.then\(\(shadow\) => \{\s*\n\s*if \(!isCurrent\(\)\) \{\s*\n\s*return;/,
    "a workspace-shadow answer is only adopted while its own run is current",
  );

  // Only a genuinely absent account redirects, and it does so from the
  // observed identity rather than from a late session answer.
  assert.match(loadFn, /if \(!expectedAccountId\) \{\s*\n\s*setLoadStatus\("denied"\);\s*\n\s*router\.replace\("\/member\/login"\);/);

  // Unmount invalidates any in-flight load.
  assert.match(
    CODE_ONLY,
    /return \(\) => \{\s*\n\s*accountLoadRunRef\.current = null;\s*\n\s*\};/,
    "unmount invalidates any in-flight load",
  );

  // Fire-and-forget: the profile load is never awaited before, and never
  // conditions, the authorized registration read or its error handling.
  const profileIdx = loadFn.indexOf("void applyAccountProfileName(");
  const rpcIdx = loadFn.indexOf('supabase.rpc(\n        "resolve_member_account"');
  assert.ok(profileIdx >= 0 && rpcIdx > profileIdx);
  assert.doesNotMatch(loadFn, /await applyAccountProfileName/);
  const registrationBlock = loadFn.slice(rpcIdx);
  assert.doesNotMatch(registrationBlock, /accountName|applyAccountProfileName/);
  assert.match(registrationBlock, /setRegistrations\(resolvedRegistrations\);/);
  assert.match(registrationBlock, /We could not load your linked registrations\./);
});

test("the load lifetime follows the actual Auth identity: one subscription, synchronous callback, unsubscribed on unmount", () => {
  const subscription = CODE_ONLY.slice(
    CODE_ONLY.indexOf("let active = true;"),
    CODE_ONLY.indexOf("const load = useCallback"),
  );

  // The account this page is bound to is mirrored from the Auth session
  // itself, not from a boolean in a parent provider.
  assert.match(
    CODE_ONLY,
    /const \[authIdentity, setAuthIdentity\] = useState<\{\s*\n\s*accountId: string \| null \| undefined;\s*\n\s*recoveryAttempt: number;\s*\n\s*\}>\(\{ accountId: undefined, recoveryAttempt: 0 \}\);/,
  );
  assert.match(subscription, /const nextAccountId = session\?\.user\?\.id \?\? null;/);
  assert.doesNotMatch(CODE_ONLY, /workspace\.isAccountSession/);

  // A token refresh for a healthy same account is not a state change, so it
  // starts no reload -- and no other reload trigger exists (no timers, no
  // polling).
  assert.match(subscription, /return current;/);
  assert.match(CODE_ONLY, /\}, \[authIdentity, load\]\);/);
  assert.match(CODE_ONLY, /if \(authIdentity\.accountId === undefined\) \{\s*\n\s*return;\s*\n\s*\}\s*\n\s*void load\(authIdentity\.accountId\);/);
  assert.doesNotMatch(CODE_ONLY, /setTimeout|setInterval/);

  // Awaiting a Supabase auth call inside this callback would deadlock the
  // SDK's own lock: the callback must stay synchronous.
  const callback = subscription.slice(
    subscription.indexOf("(_event, session) => {"),
    subscription.indexOf("return () => {"),
  );
  assert.doesNotMatch(callback, /await|async/, "the auth-state callback must not await anything");
  assert.doesNotMatch(callback, /supabase\.auth\./, "and must not call back into the auth SDK");

  // Exactly one subscription, unsubscribed on unmount, guarded against a
  // late callback after teardown.
  assert.equal((CODE_ONLY.match(/onAuthStateChange\(/g) ?? []).length, 1);
  assert.match(subscription, /let active = true;/);
  assert.match(subscription, /if \(!active\) \{\s*\n\s*return;/);
  assert.match(subscription, /active = false;\s*\n\s*authListener\.subscription\.unsubscribe\(\);/);
});

test("both explicit sign-out paths invalidate synchronously before their first await", () => {
  for (const handler of ["handleSignOut", "handleSignOutForEventAccess"]) {
    const body = CODE_ONLY.slice(
      CODE_ONLY.indexOf(`async function ${handler}()`),
      CODE_ONLY.indexOf("}", CODE_ONLY.indexOf("router.replace", CODE_ONLY.indexOf(`async function ${handler}()`))),
    );
    const invalidateIdx = body.indexOf("invalidateAccountLoad();");
    const awaitIdx = body.indexOf("await signOutOfMemberAccount()");
    assert.ok(invalidateIdx > 0, `${handler} must invalidate the load`);
    assert.ok(awaitIdx > invalidateIdx, `${handler} must invalidate before its first await`);
    assert.match(body, /router\.replace\("\/member\/login"\);/);
  }
});

test("a same-account announcement retries only a load that could not obtain its matching session", () => {
  const subscription = CODE_ONLY.slice(
    CODE_ONLY.indexOf("let active = true;"),
    CODE_ONLY.indexOf("const load = useCallback"),
  );

  // The distinction is read before the updater so the updater stays pure.
  assert.match(subscription, /const unresolved = sessionUnresolvedRef\.current;/);
  const updater = subscription.slice(
    subscription.indexOf("setAuthIdentity((current) => {"),
    subscription.indexOf("});", subscription.indexOf("setAuthIdentity((current) => {")),
  );
  // A different account: a fresh identity, attempt counter reset.
  assert.match(updater, /if \(current\.accountId !== nextAccountId\) \{\s*\n\s*return \{ accountId: nextAccountId, recoveryAttempt: 0 \};/);
  // The same account, only while unresolved, and never for "no account".
  assert.match(updater, /if \(nextAccountId !== null && unresolved\) \{\s*\n\s*return \{ \.\.\.current, recoveryAttempt: current\.recoveryAttempt \+ 1 \};/);
  // Otherwise nothing changes, so a healthy account ignores token refreshes.
  assert.match(updater, /\}\s*\n\s*return current;\s*$/);
  // The announcement is only a trigger: the retry is the same governed load,
  // which still requires this tab's own readable session for that account.
  assert.doesNotMatch(subscription, /session\.access_token|session\.user\.email|setVerifiedEmail|setAuthUserId|fetch\(/);
  assert.doesNotMatch(subscription, /await|async/);
  // The distinction is cleared at the start of every load (via invalidation)
  // and only ever set at the unresolved return.
  const setCount = (CODE_ONLY.match(/sessionUnresolvedRef\.current = true;/g) ?? []).length;
  const clearCount = (CODE_ONLY.match(/sessionUnresolvedRef\.current = false;/g) ?? []).length;
  assert.equal(setCount, 1);
  assert.equal(clearCount, 1);
  const invalidate = CODE_ONLY.slice(
    CODE_ONLY.indexOf("const invalidateAccountLoad = useCallback"),
    CODE_ONLY.indexOf("}, []);", CODE_ONLY.indexOf("const invalidateAccountLoad = useCallback")),
  );
  assert.ok(invalidate.includes("sessionUnresolvedRef.current = false;"));
});
