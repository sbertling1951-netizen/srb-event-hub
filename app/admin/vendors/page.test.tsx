import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import {
  catalogStatusTone,
  STATUS_LABELS,
  StatusBadge,
  vendorPageStatusTone,
} from "@/app/admin/vendors/page";
import type { VendorEventDisplayStatus } from "@/lib/vendorEventLifecycle";

// Focused tests for the Stage 4 Admin Vendor workflow's status
// presentation. Run with:
//   npx tsx --test app/admin/vendors/page.test.tsx

const ALL_STATUSES: VendorEventDisplayStatus[] = [
  "not_considered",
  "pending",
  "admitted",
  "rejected",
  "withdrawn",
  "revoked",
];

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("StatusBadge renders every display status's own label, with no crossover", () => {
  for (const status of ALL_STATUSES) {
    const markup = renderToStaticMarkup(<StatusBadge status={status} />);
    assert.match(markup, new RegExp(STATUS_LABELS[status]));

    for (const other of ALL_STATUSES) {
      if (other === status) {continue;}
      // Guard against a copy-paste label collision -- every status's
      // label must be exclusive to that status's badge.
      if (STATUS_LABELS[other] !== STATUS_LABELS[status]) {
        assert.doesNotMatch(markup, new RegExp(`^${STATUS_LABELS[other]}$`));
      }
    }
  }
});

test("the revoked label is distinct from the admitted label -- the admitted-vs-revoked invariant is visible, not just internally derived", () => {
  const admittedMarkup = renderToStaticMarkup(<StatusBadge status="admitted" />);
  const revokedMarkup = renderToStaticMarkup(<StatusBadge status="revoked" />);

  assert.notEqual(admittedMarkup, revokedMarkup);
  assert.match(revokedMarkup, /revoked/i);
  assert.match(admittedMarkup, /currently participating/i);
});

test("an Admin Event switch starts a fresh Vendor load and rejects late prior-Event responses", () => {
  assert.match(PAGE_SOURCE, /const scopedEvent = getCurrentAdminEvent\(\);/);
  assert.match(PAGE_SOURCE, /const generation = \+\+loadGenerationRef\.current;/);
  assert.match(
    PAGE_SOURCE,
    /getCurrentAdminEvent\(\)\?\.id === scopedEvent\?\.id/,
  );
  assert.match(PAGE_SOURCE, /\.eq\("event_id", scopedEvent\.id\)/);
  assert.match(PAGE_SOURCE, /listVendorEventApplications\(scopedEvent\.id\)/);
  assert.match(PAGE_SOURCE, /if \(!isCurrentLoad\(\)\) \{return;\}/);
  assert.match(PAGE_SOURCE, /setEventVendors\(\[\]\);/);
  assert.match(PAGE_SOURCE, /setApplications\(\[\]\);/);
});

test("a denied Vendor application read is visible instead of being presented as an empty queue", () => {
  assert.match(PAGE_SOURCE, /Vendor applications could not be loaded for this Event\./);
  assert.match(PAGE_SOURCE, /application review is unavailable\./);
  assert.doesNotMatch(PAGE_SOURCE, /denied by the RPC -- fail closed to an empty/);
});

// -- UI Phase 3: reusable Admin table/list pattern, extended to Vendors --

test("StatusBadge renders through the shared token-driven primitive, not page-local inline hex colors", () => {
  const html = renderToStaticMarkup(<StatusBadge status="admitted" />);

  assert.ok(html.includes("app-status-pill"));
  assert.ok(html.includes("app-status-pill-success"));
  assert.equal(/background:\s*#/.test(html), false, "no inline hex background should remain on the badge");
});

test("pending and revoked share one tone (both were already near-identical amber/orange), but keep fully distinct text", () => {
  const pendingHtml = renderToStaticMarkup(<StatusBadge status="pending" />);
  const revokedHtml = renderToStaticMarkup(<StatusBadge status="revoked" />);

  assert.ok(pendingHtml.includes("app-status-pill-warning"));
  assert.ok(revokedHtml.includes("app-status-pill-warning"));
  assert.notEqual(pendingHtml, revokedHtml);
});

test("rejected renders the danger tone -- distinct from pending/revoked's warning tone", () => {
  const html = renderToStaticMarkup(<StatusBadge status="rejected" />);

  assert.ok(html.includes("app-status-pill-danger"));
});

test("catalogStatusTone: Active is success, Inactive is neutral, and an unset flag defaults to Active (matches the page's own is_active !== false convention)", () => {
  assert.equal(catalogStatusTone(true), "success");
  assert.equal(catalogStatusTone(false), "neutral");
  assert.equal(catalogStatusTone(null), "success");
});

test("vendorPageStatusTone classifies failure/denial text as danger, in-progress verbs as info, and confirmations as success", () => {
  assert.equal(vendorPageStatusTone("Access denied."), "danger");
  assert.equal(vendorPageStatusTone("We couldn't load vendors. Please try again."), "danger");
  assert.equal(vendorPageStatusTone("Loading vendors..."), "info");
  assert.equal(vendorPageStatusTone("Saving vendor..."), "info");
  assert.equal(vendorPageStatusTone("Vendor updated."), "success");
  assert.equal(vendorPageStatusTone("Acme Co. admitted for this Event."), "success");
  assert.equal(
    vendorPageStatusTone("Vendor catalog loaded; application review is unavailable."),
    "warning",
  );
});

test("no raw Supabase/RPC error text (err?.message) is surfaced to the user anywhere on this page", () => {
  assert.equal(/err\?\.message/.test(PAGE_SOURCE), false);
});

test("the desktop table and narrow-viewport list are both driven by the Shell's own canonical isCompact signal, not a page-local resize listener", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{[^}]*useShellInterfaceCapabilities[^}]*\}\s*from\s*["']@\/components\/shell\/useShellViewport["']/,
  );
  assert.match(PAGE_SOURCE, /const \{ isCompact \} = useShellInterfaceCapabilities\(\);/);
  assert.equal(/addEventListener\("resize"/.test(PAGE_SOURCE), false);
  assert.equal(/window\.innerWidth/.test(PAGE_SOURCE), false);
});

test("the desktop table uses the shared DataTable primitive with real column headers distinguishing catalog identity from Event relationship", () => {
  assert.match(PAGE_SOURCE, /<DataTable caption="[^"]+">/);
  for (const column of ["Vendor", "Catalog Status", "Event Status", "Contact", "Actions"]) {
    assert.ok(
      PAGE_SOURCE.includes(`<th scope="col">${column}</th>`),
      `expected a <th scope="col"> for "${column}"`,
    );
  }
});

test("the narrow-viewport presentation uses the shared ResponsiveList primitive", () => {
  assert.match(PAGE_SOURCE, /<ResponsiveList>/);
});

test("row actions carry a specific accessible name including the vendor's identity", () => {
  assert.match(PAGE_SOURCE, /aria-label=\{`Edit "\$\{name\}" catalog details`\}/);
  assert.match(PAGE_SOURCE, /aria-label=\{`Admit "\$\{name\}" for this Event`\}/);
  assert.match(PAGE_SOURCE, /aria-label=\{`Reject "\$\{name\}" for this Event`\}/);
});

test("destructive/revocation actions use the danger variant; admission-positive actions use success -- routine actions stay visually equal to neither", () => {
  const rowActionsIdx = PAGE_SOURCE.indexOf("function renderCatalogActions(");
  assert.notEqual(rowActionsIdx, -1);
  const closeIdx = PAGE_SOURCE.indexOf("\n  const subheadingStyle", rowActionsIdx);
  assert.notEqual(closeIdx, -1);
  const rowActionsBody = PAGE_SOURCE.slice(rowActionsIdx, closeIdx);

  assert.equal((rowActionsBody.match(/variant="danger"/g) || []).length, 2, "reject and revoke");
  assert.equal((rowActionsBody.match(/variant="success"/g) || []).length, 2, "admit and reconsider");
});

test("the quick-links section reuses the shared admin-summary-link card style instead of a page-local hardcoded style object", () => {
  assert.equal(/dashboardLinkStyle/.test(PAGE_SOURCE), false);
  assert.match(PAGE_SOURCE, /className="admin-summary-link"/);
});

test("the redundant 'Event: {name}' pill is gone -- the Canonical Shell header already owns Event/workspace identity display", () => {
  assert.equal(/Event: \{adminEvent\?\.name/.test(PAGE_SOURCE), false);
});

test("Vendor Catalog identity form inputs carry real <label htmlFor> associations, not placeholder-only labeling", () => {
  assert.match(PAGE_SOURCE, /htmlFor="vendor-business-name"/);
  assert.match(PAGE_SOURCE, /htmlFor="vendor-email"/);
  assert.match(PAGE_SOURCE, /htmlFor="vendor-contact-method"/);
});

test("the vendor currently loaded into the edit form is visually distinguished from the admitted/pinned accent -- a real capability carried forward, not dropped, from the pre-conversion page", () => {
  assert.match(PAGE_SOURCE, /selectedVendorId === vendor\.id \? "data-table-row-selected" : ""/);
  assert.match(
    PAGE_SOURCE,
    /selectedVendorId === vendor\.id \? " responsive-list-item-selected" : ""/,
  );
});

test("distinct Alert states exist for an empty catalog and for no Event selected, using the shared Alert primitive", () => {
  assert.match(PAGE_SOURCE, /<Alert tone="neutral">No vendors in the catalog yet\. Add one below\.<\/Alert>/);
  assert.match(
    PAGE_SOURCE,
    /No Event is selected -- Event relationship and admission actions are unavailable/,
  );
});

test("optional catalog fields are visually marked Optional; the one required field (business name) is not", () => {
  const businessNameFieldIdx = PAGE_SOURCE.indexOf('htmlFor="vendor-business-name"');
  const businessNameLabelEnd = PAGE_SOURCE.indexOf("</label>", businessNameFieldIdx);
  assert.equal(
    /Optional/.test(PAGE_SOURCE.slice(businessNameFieldIdx, businessNameLabelEnd)),
    false,
  );

  assert.match(PAGE_SOURCE, /Contact person <span style=\{optionalTagStyle\}>Optional<\/span>/);
});
