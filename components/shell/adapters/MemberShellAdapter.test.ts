import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertion proving MemberShellAdapter.tsx's
// compact-name read uses the governed authenticated Member continuity RPC
// for its already-resolved Event id, instead of a direct public.events or
// anonymous public-continuity read.
//
// Run with:
//   npx tsx --test components/shell/adapters/MemberShellAdapter.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./MemberShellAdapter.tsx", import.meta.url)),
  "utf8",
);

test("compact-name effect uses participation-bound Member continuity keyed on event.id", () => {
  assert.match(
    SOURCE,
    /\.rpc\("get_my_member_event_continuity_context",\s*\{\s*p_event_id:\s*event\.id\s*\}\)/,
  );
  assert.match(SOURCE, /\.maybeSingle\(\)/);
  assert.doesNotMatch(SOURCE, /\.from\("events"\)/);
});

test("compact name is still read from the RPC row's short_name field, unchanged", () => {
  assert.match(SOURCE, /row\?\.short_name \?\? null/);
});

test("no member-discovery filtering (visible_to_members/status) is introduced", () => {
  assert.doesNotMatch(SOURCE, /visible_to_members/);
  assert.doesNotMatch(SOURCE, /get_public_discoverable_events/);
  assert.doesNotMatch(SOURCE, /get_event_continuity_context/);
});

test("explicit shell sign-out uses the full Member logout path before returning to login", () => {
  assert.match(
    SOURCE,
    /import \{ signOutOfMemberAccount \} from "@\/lib\/memberAccountSession";/,
  );
  assert.match(
    SOURCE,
    /signOutOfMemberAccount\(\)\.finally\(\(\) => \{\s*window\.location\.href = "\/member\/login";/,
  );
  assert.doesNotMatch(SOURCE, /supabase\.auth\.signOut\(\)/);
});
