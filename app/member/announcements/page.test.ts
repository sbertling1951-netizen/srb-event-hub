import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

test("the page is guarded by MemberRouteGuard and uses the canonical Member shell with no back target", () => {
  assert.match(source, /<MemberRouteGuard>/);
  assert.match(source, /<MemberShellAdapter pageTitle="Announcements">/);
  assert.equal((source.match(/backTarget=/g) || []).length, 0);
});

test("announcements are read only through the exact governed table query, filters, and ordering", () => {
  assert.match(
    source,
    /supabase\s*\n\s*\.from\("announcements"\)\s*\n\s*\.select\(\s*\n\s*"id, event_id, title, body, priority, is_pinned, is_published, created_at, expire_at",\s*\n\s*\)\s*\n\s*\.eq\("event_id", currentEvent\.id\)\s*\n\s*\.eq\("is_published", true\)\s*\n\s*\.or\(`expire_at\.is\.null,expire_at\.gt\.\$\{now\}`\)\s*\n\s*\.order\("is_pinned", \{ ascending: false \}\)\s*\n\s*\.order\("created_at", \{ ascending: false \}\);/,
  );
});

test("sort/priority derivation is unchanged: pinned first, then priority rank, then most recent", () => {
  assert.match(source, /function priorityRank\(priority\?: string \| null\) \{/);
  assert.match(source, /case "urgent":\s*\n\s*return 0;/);
  assert.match(source, /case "high":\s*\n\s*return 1;/);
  assert.match(source, /case "normal":\s*\n\s*return 2;/);
  assert.match(source, /case "low":\s*\n\s*return 3;/);
  assert.match(
    source,
    /if \(a\.is_pinned !== b\.is_pinned\) \{\s*\n\s*return a\.is_pinned \? -1 : 1;\s*\n\s*\}/,
  );
  assert.match(
    source,
    /const priorityDiff = priorityRank\(a\.priority\) - priorityRank\(b\.priority\);/,
  );
});

test("the priority/pinned badge system, badgeStyle, and its exact colors are untouched", () => {
  assert.match(source, /function badgeStyle\(priority\?: string \| null\) \{/);
  assert.match(source, /background: "#fff1f2",\s*\n\s*color: "#991b1b",\s*\n\s*border: "1px solid #fecdd3",/);
  assert.match(source, /background: "#fff7ed",\s*\n\s*color: "#9a3412",\s*\n\s*border: "1px solid #fed7aa",/);
  assert.match(source, /background: "#f8fafc",\s*\n\s*color: "#334155",\s*\n\s*border: "1px solid #cbd5e1",/);
  assert.match(source, /background: "#eff6ff",\s*\n\s*color: "#1d4ed8",\s*\n\s*border: "1px solid #bfdbfe",/);
  assert.match(source, /\.\.\.badgeStyle\(announcement\.priority\)/);
  assert.match(
    source,
    /background: "#fff8db",\s*\n\s*color: "#7c5e10",\s*\n\s*border: "1px solid #f2d675",/,
  );
});

test("shared Alert/EmptyState/PageSection primitives are used, and the failure surface is singular (no duplicate status+error)", () => {
  assert.match(source, /import \{ Alert \} from "@\/components\/ui\/Alert";/);
  assert.match(source, /import \{ EmptyState \} from "@\/components\/ui\/EmptyState";/);
  assert.match(source, /import \{ PageSection \} from "@\/components\/ui\/PageSection";/);
  assert.match(source, /\{status && !error \? <Alert tone="info">\{status\}<\/Alert> : null\}/);
  assert.match(source, /\{error \? <Alert tone="danger">\{error\}<\/Alert> : null\}/);
  assert.match(
    source,
    /<EmptyState message="No announcements have been posted for this event yet\." \/>/,
  );
  assert.equal((source.match(/<PageSection\b/g) || []).length, 1);
});

test("status text content (loading and no-active-event) is unchanged", () => {
  assert.match(source, /setStatus\("Loading announcements\.\.\."\)/);
  assert.match(source, /setStatus\("No active event selected\."\)/);
  assert.match(source, /setStatus\("Could not load announcements\."\)/);
});

test("engagement logging on view is unchanged", () => {
  assert.match(source, /activityType: "announcement_view"/);
});
