import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Member Event Context Stage 2: the account page is the existing,
// reused recovery surface for an invalid established Event context --
// no new Member application shell was built for this.
//
// Run with:
//   npx tsx --test app/member/account/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("reads the contextInvalid flag from the URL, not from any client-trusted identity/authorization value", () => {
  assert.match(SOURCE, /searchParams\.get\("contextInvalid"\) === "1"/);
});

test("account/session data is always re-loaded fresh via resolve_member_account regardless of the flag", () => {
  assert.match(SOURCE, /"resolve_member_account"/);
  const loadFn = SOURCE.slice(
    SOURCE.indexOf("const load = useCallback"),
    SOURCE.indexOf("}, [router]);"),
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
  const accountCard = SOURCE.indexOf("EpicentraX Account");
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
