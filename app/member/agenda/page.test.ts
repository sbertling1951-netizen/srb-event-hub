import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

test("the page is guarded by MemberRouteGuard and uses the canonical Member shell with no back target", () => {
  assert.match(source, /<MemberRouteGuard>/);
  assert.match(source, /<MemberShellAdapter pageTitle="Agenda">/);
  assert.equal((source.match(/backTarget=/g) || []).length, 0);
});

test("agenda items are read only through the exact governed table query, filters, and ordering", () => {
  assert.match(
    source,
    /supabase\s*\n\s*\.from\("agenda_items"\)\s*\n\s*\.select\(\s*\n\s*"id,event_id,title,description,location,agenda_date,start_time,end_time,category,color,is_published,sort_order",\s*\n\s*\)\s*\n\s*\.eq\("event_id", workspaceEvent\.id\)\s*\n\s*\.eq\("is_published", true\)\s*\n\s*\.order\("agenda_date", \{ ascending: true, nullsFirst: false \}\);/,
  );
});

test("the presentation-evaluation RPC contract is unchanged", () => {
  assert.match(
    source,
    /supabase\s*\n\s*\.rpc\("list_member_agenda_evaluations", \{\s*\n\s*p_event_id: workspaceEvent\.id,\s*\n\s*\.\.\.memberIdentityRpcArgs\(session\),\s*\n\s*\}\)/,
  );
});

test("shared Alert/AppButton/AppLinkButton/EmptyState/PageSection primitives are used, and the failure surface is singular (no duplicate status+error)", () => {
  assert.match(source, /import \{ Alert \} from "@\/components\/ui\/Alert";/);
  assert.match(source, /import \{ AppButton, AppLinkButton \} from "@\/components\/ui\/AppButton";/);
  assert.match(source, /import \{ EmptyState \} from "@\/components\/ui\/EmptyState";/);
  assert.match(source, /import \{ PageSection \} from "@\/components\/ui\/PageSection";/);
  assert.match(source, /\{status && !error \? <Alert tone="info">\{status\}<\/Alert> : null\}/);
  assert.match(source, /\{error \? <Alert tone="danger">\{error\}<\/Alert> : null\}/);
  assert.match(source, /<EmptyState message="No agenda items available\." \/>/);
});

test("the filter container and chips use PageSection/AppButton, preserving the exact category list, order, aria-pressed, and click handler", () => {
  assert.match(source, /<PageSection variant="card">\s*\n\s*<div style=\{\{ fontWeight: 700, marginBottom: 8 \}\}>\s*\n\s*Filter by category/);
  assert.match(
    source,
    /<AppButton\s*\n\s*key=\{category\}\s*\n\s*variant=\{active \? "primary" : "secondary"\}\s*\n\s*aria-pressed=\{active\}\s*\n\s*onClick=\{\(\) => setSelectedCategory\(category\)\}\s*\n\s*>/,
  );
  assert.doesNotMatch(source, /<button\s*\n\s*key=\{category\}/);
});

test("Evaluate this presentation uses AppLinkButton, preserving the exact href (including the query string), label, and evalItemIds gate", () => {
  assert.match(
    source,
    /\{evalItemIds\.has\(selectedAgendaItem\.id\) \? \(\s*\n\s*<AppLinkButton\s*\n\s*variant="primary"\s*\n\s*href=\{`\/member\/evaluation\?target=agenda_item&id=\$\{selectedAgendaItem\.id\}`\}\s*\n\s*>\s*\n\s*Evaluate this presentation\s*\n\s*<\/AppLinkButton>\s*\n\s*\) : null\}/,
  );
  assert.doesNotMatch(source, /className="app-button app-button-primary"/);
});

test("grouping, sorting, status derivation, and time formatting are unchanged", () => {
  assert.match(source, /function groupAgenda\(items: AgendaItem\[\]\): GroupedAgenda\[\] \{/);
  assert.match(source, /function itemSortValue\(item: AgendaItem\) \{/);
  assert.match(source, /function getItemStatus\(item: AgendaItem, now: Date\) \{/);
  assert.match(source, /function formatItemTime\(item: AgendaItem\) \{/);
  assert.match(source, /function formatGroupLabel\(dateValue: string\) \{/);
  assert.match(source, /label: key === "unscheduled" \? "Schedule TBD" : formatGroupLabel\(key\)/);
});

test("engagement logging on view is unchanged", () => {
  assert.match(source, /activityType: "agenda_view"/);
});

test("Slice 1 leaves the dynamic category-tag system and its reserved-green exclusion list untouched", () => {
  assert.match(source, /function categoryStyle\(resolvedColor: string \| null \| undefined\) \{/);
  assert.match(source, /function sanitizeAgendaCardColor\(color: string \| null \| undefined\) \{/);
  assert.match(source, /const reservedGreens = new Set\(\[/);
  assert.match(source, /getAgendaColor\(/);
});

test("Slice 1 leaves the now/past/upcoming agenda-card color system untouched", () => {
  assert.match(source, /function agendaCardStyle\(/);
  assert.match(source, /border: "2px solid #16a34a",\s*\n\s*background: "#dcfce7",/);
  assert.match(source, /border: "1px solid #d1d5db",\s*\n\s*background: "#f3f4f6",/);
  assert.match(source, /borderLeft: "5px solid #93c5fd",/);
});

test("Slice 1 leaves the Happening Now / Up Next banners untouched", () => {
  assert.match(source, /HAPPENING NOW/);
  assert.match(source, /UP NEXT/);
  assert.match(source, /border: "1px solid #86efac",\s*\n\s*background: "#f0fdf4",/);
  assert.match(source, /border: "1px solid #dbe4ef",\s*\n\s*background: "#f8fbff",/);
});

test("Slice 1 leaves both copies of the Happening now / Upcoming status pills untouched and byte-identical to each other", () => {
  const pillPattern =
    /background: "#dcfce7",\s*\n\s*color: "#166534",\s*\n\s*\}\}\s*\n\s*>\s*\n\s*Happening now/g;
  const nowPills = source.match(pillPattern) || [];
  assert.equal(nowPills.length, 2, "expected exactly two identical 'Happening now' pill renderings");

  const upcomingPillPattern =
    /background: "#eef2f7",\s*\n\s*color: "#475569",\s*\n\s*border: "1px solid #cbd5e1",\s*\n\s*\}\}\s*\n\s*>\s*\n\s*Upcoming/g;
  const upcomingPills = source.match(upcomingPillPattern) || [];
  assert.equal(upcomingPills.length, 2, "expected exactly two identical 'Upcoming' pill renderings");
});

test("Slice 1 leaves the Morton/Pioneer two-column layout and sticky slot headers untouched", () => {
  assert.match(source, /Morton Building/);
  assert.match(source, /Pioneer Building/);
  assert.match(source, /position: "sticky",\s*\n\s*top: 0,\s*\n\s*zIndex: 5,/);
  assert.match(source, /No scheduled items\./);
});
