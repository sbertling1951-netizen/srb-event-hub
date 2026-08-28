import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Member Event Context Stage 2: this route is live authority for
// established-context validation, not a shadow/diagnostic endpoint --
// distinct from its sibling route.ts in the parent directory.
//
// Run with:
//   npx tsx --test app/api/member/workspace-context/validate/route.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);

test("delegates entirely to the governed resolver -- no inline identity/context logic in the route itself", () => {
  assert.match(SOURCE, /resolveEstablishedMemberEventContext\(\s*\n\s*request\.headers,\s*\n\s*eventId,\s*\n\s*\)/);
});

test("does not read or forward a client-supplied Person, attendee, or authorization value -- only the persisted Event id", () => {
  assert.equal(/personId|person_id|attendeeId|attendee_id/.test(SOURCE), false);
});

test("is not framed as a shadow/comparison endpoint", () => {
  assert.equal(/shadowComparison|must never alter the live workflow/.test(SOURCE), false);
});
