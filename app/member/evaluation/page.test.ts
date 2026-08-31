import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Member Workspace Continuity -- /member/evaluation is an identity-
// dependent page (consumes useMemberWorkspace().attendeeId) and must sit
// under the same MemberRouteGuard boundary as the rest of the protected
// member workspace, so a recovery_required workspace routes to explicit
// recovery instead of rendering through with a null Event / attendee.
//
// Run with:
//   npx tsx --test app/member/evaluation/page.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("the page is under MemberRouteGuard", () => {
  assert.match(
    PAGE_SOURCE,
    /import MemberRouteGuard from "@\/components\/auth\/MemberRouteGuard";/,
  );
  assert.match(PAGE_SOURCE, /function MemberEvaluationPageInner\(\) \{/);
  assert.match(
    PAGE_SOURCE,
    /export default function MemberEvaluationPage\(\) \{[\s\S]{0,360}?<MemberRouteGuard>\s*\n\s*<MemberEvaluationPageInner \/>\s*\n\s*<\/MemberRouteGuard>/,
  );
});

test("only the Guard wrapper + rename changed -- evaluation logic, question set, and data path are untouched", () => {
  // the identity-scoped read is still keyed on the workspace attendee id
  assert.match(PAGE_SOURCE, /\.eq\("attendee_id", attendeeId\)/);
  assert.match(PAGE_SOURCE, /const \{ event, attendeeId, isReady, isInitializing \} = useMemberWorkspace\(\);/);
  // no new gate / redirect logic was added inside the page body
  assert.equal(/router\.replace|useRouter/.test(PAGE_SOURCE), false);
});
