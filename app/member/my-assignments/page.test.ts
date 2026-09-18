import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("the page is guarded by MemberRouteGuard and uses the canonical Member shell with no back target", () => {
  assert.match(SOURCE, /<MemberRouteGuard>/);
  assert.match(
    SOURCE,
    /<MemberShellAdapter\s*\n\s*pageTitle="My Assignments"\s*\n\s*pageSubtitle="Event duties that have been assigned to you\."\s*\n\s*>/,
  );
  assert.equal((SOURCE.match(/backTarget=/g) || []).length, 0);
});

test("loading uses the shared LoadingState, preserving the exact gate and message", () => {
  assert.match(SOURCE, /import \{ LoadingState \} from "@\/components\/ui\/LoadingState";/);
  assert.match(
    SOURCE,
    /\{!isReady \|\| state\.kind === "loading" \? \(\s*\n\s*<LoadingState message="Loading your assignments\.\.\." \/>/,
  );
});

test("no_event and resolved-empty use the shared EmptyState, preserving their exact gates and copy", () => {
  assert.match(SOURCE, /import \{ EmptyState \} from "@\/components\/ui\/EmptyState";/);
  assert.match(
    SOURCE,
    /state\.kind === "no_event" \? \(\s*\n\s*<EmptyState message="No event selected\." \/>/,
  );
  assert.match(
    SOURCE,
    /state\.assignments\.length === 0 \? \(\s*\n\s*<EmptyState message="You don't have any active event duties\." \/>/,
  );
});

test("resolved assignment rows use PageSection, preserving key, map order, labels, and dates", () => {
  assert.match(SOURCE, /import \{ PageSection \} from "@\/components\/ui\/PageSection";/);
  assert.match(
    SOURCE,
    /state\.assignments\.map\(\(assignment\) => \(\s*\n\s*<PageSection key=\{assignment\.id\} variant="card">\s*\n\s*<div style=\{\{ fontWeight: 800, fontSize: 16, overflowWrap: "anywhere" \}\}>\s*\n\s*\{assignment\.responsibilityLabel\}\s*\n\s*<\/div>\s*\n\s*<div style=\{\{ fontSize: 13, color: "#666", marginTop: 4 \}\}>\s*\n\s*Assigned \{formatAttributedAt\(assignment\.attributedAt\)\}\s*\n\s*<\/div>\s*\n\s*<\/PageSection>\s*\n\s*\)\)/,
  );
});

test("identity_unavailable uses Alert tone=neutral, preserving its exact gate and copy", () => {
  assert.match(SOURCE, /import \{ Alert \} from "@\/components\/ui\/Alert";/);
  assert.match(
    SOURCE,
    /state\.kind === "identity_unavailable" \? \(\s*\n\s*<Alert tone="neutral">\s*\n\s*Assignment information is not currently available for this\s*\n\s*participant\.\s*\n\s*<\/Alert>/,
  );
});

test("transient_error uses Alert tone=danger, preserving its exact copy and role=\"alert\" behavior", () => {
  assert.match(
    SOURCE,
    /\) : \(\s*\n\s*<Alert tone="danger">\s*\n\s*Something went wrong loading your assignments\. Please try again\s*\n\s*later\.\s*\n\s*<\/Alert>\s*\n\s*\)\}/,
  );
});

test("invalid_session is left exactly as-is: raw div, role=\"alert\", its own styling, text, and the Home Link", () => {
  assert.match(
    SOURCE,
    /state\.kind === "invalid_session" \? \(\s*\n\s*<div role="alert" style=\{invalidSessionCardStyle\}>\s*\n\s*We couldn&apos;t verify your session for this event\. Try returning\s*\n\s*to\{" "\}\s*\n\s*<Link href="\/member" style=\{\{ color: "inherit" \}\}>\s*\n\s*Home\s*\n\s*<\/Link>\{" "\}\s*\n\s*or signing in again\.\s*\n\s*<\/div>/,
  );
  assert.match(
    SOURCE,
    /const invalidSessionCardStyle: React\.CSSProperties = \{\s*\n\s*padding: 14,\s*\n\s*border: "1px solid #fde68a",\s*\n\s*borderRadius: 12,\s*\n\s*background: "#fffbeb",\s*\n\s*color: "#78350f",\s*\n\s*fontWeight: 600,\s*\n\s*\};/,
  );
});

test("the now-unused cardStyle/unavailableCardStyle/errorCardStyle constants were removed", () => {
  assert.doesNotMatch(SOURCE, /const cardStyle/);
  assert.doesNotMatch(SOURCE, /const unavailableCardStyle/);
  assert.doesNotMatch(SOURCE, /const errorCardStyle/);
});

test("loadAssignments, the governed API call, its query params, and formatAttributedAt remain unchanged", () => {
  assert.match(
    SOURCE,
    /fetch\(\s*\n\s*`\/api\/member\/assignments\?\$\{params\.toString\(\)\}`,/,
  );
  assert.match(SOURCE, /params\.set\("eventCode", session\.event_code\)/);
  assert.match(SOURCE, /params\.set\("registrationIdentifier", registrationIdentifier\);/);
  assert.match(SOURCE, /if \(payload\.status === "resolved"\) \{/);
  assert.match(SOURCE, /if \(payload\.status === "identity_unavailable"\) \{/);
  assert.match(
    SOURCE,
    /kind: payload\.status === "invalid_session"\s*\n\s*\? "invalid_session"\s*\n\s*: "transient_error",/,
  );
  assert.match(SOURCE, /function formatAttributedAt\(value: string\) \{/);
});
