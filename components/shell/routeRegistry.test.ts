import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import * as ts from "typescript";

import { resolveShellMode } from "@/components/shell/routeRegistry";

/**
 * JSX-aware, string-safe detection of a real `<TagName ...>` /
 * `<TagName ... />` render. Parses the source into a real TSX AST (via
 * the `typescript` package already a project dependency -- no new
 * dependency added) and walks JSX opening/self-closing elements by tag
 * name, so a comment, string literal, or template literal that merely
 * contains the tag name's text (e.g. `/admin/print`'s own "intentionally
 * renders without AdminShellAdapter" explanatory comment, or a string
 * such as `"<AdminShellAdapter"`) is never mistaken for an actual render
 * -- the parser only recognizes it as JSX where it genuinely is JSX.
 */
function rendersJsxElement(source: string, filePath: string, tagName: string): boolean {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = false;

  function visit(node: ts.Node) {
    if (found) {
      return;
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const { tagName: nodeTagName } = node;
      if (ts.isIdentifier(nodeTagName) && nodeTagName.text === tagName) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

test("the approved Member pilot routes use the canonical Member shell", () => {
  for (const pathname of [
    "/member",
    "/member/agenda",
    "/member/announcements",
    "/member/attendees",
    "/member/checkin",
    "/member/evaluation",
    "/member/events",
    "/member/my-assignments",
    "/member/my-requests",
    "/member/participants",
    "/member/photos",
    "/member/vendor-signup",
  ]) {
    assert.equal(resolveShellMode(pathname), "canonical-member");
  }
});

test("Member Agenda children remain legacy while the exact Agenda route is canonical", () => {
  assert.equal(resolveShellMode("/member/agenda/categories"), "legacy");
  assert.equal(resolveShellMode("/member/agenda/import"), "legacy");
  assert.equal(resolveShellMode("/member/nearby"), "canonical-member");
});

test("Member authentication exceptions remain shell exceptions", () => {
  assert.equal(resolveShellMode("/member/login"), "exception");
  assert.equal(resolveShellMode("/member/activate"), "exception");
  assert.equal(resolveShellMode("/member/account"), "exception");
  assert.equal(resolveShellMode("/member/account/reset-password"), "exception");
});

test("the self-service organizer route family uses the canonical organizer shell", () => {
  for (const pathname of [
    "/organize",
    "/organize/account",
    "/organize/some-event-id",
  ]) {
    assert.equal(resolveShellMode(pathname), "canonical-organizer");
  }

  // prefix match must not sweep in unrelated adjacent paths
  assert.equal(resolveShellMode("/organizex"), "legacy");
});

test("Admin and Vendor shell classifications remain correct", () => {
  assert.equal(resolveShellMode("/admin/announcements"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/dashboard"), "canonical-admin");
  assert.equal(resolveShellMode("/vendor/workspace"), "canonical-vendor");
});

test("Admin Reports uses the canonical shell without moving print exceptions", () => {
  assert.equal(resolveShellMode("/admin/reports"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/reports/coach-plates/print"), "exception");
  assert.equal(resolveShellMode("/admin/reports/name-tags/print"), "exception");
  assert.equal(resolveShellMode("/admin/imports"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/validation-rules"), "canonical-admin");
});

test("Admin shell Cohort A routes use the canonical Admin shell", () => {
  for (const pathname of [
    "/admin/checklist",
    "/admin/export",
    "/admin/vendors/access",
  ]) {
    assert.equal(resolveShellMode(pathname), "canonical-admin");
  }

  assert.equal(resolveShellMode("/admin/login"), "exception");
  assert.equal(resolveShellMode("/admin/print"), "exception");
  assert.equal(resolveShellMode("/admin/reports/coach-plates/print"), "exception");
  assert.equal(resolveShellMode("/admin/events"), "canonical-admin");
  // /admin/vendors itself was migrated by a later cohort (still legacy
  // when this Cohort A test was written); /admin/vendors/access/history
  // remains legacy since only the exact /admin/vendors/access path is
  // registered, not its /history child.
  assert.equal(resolveShellMode("/admin/vendors"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/vendors/access/history"), "legacy");
});

test("Admin shell Cohort B1 routes use the canonical Admin shell", () => {
  for (const pathname of ["/admin/events/new", "/admin/vendor-requests"]) {
    assert.equal(resolveShellMode(pathname), "canonical-admin");
  }

  assert.equal(resolveShellMode("/admin/events"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/vendor-requests/history"), "legacy");
  assert.equal(resolveShellMode("/admin/login"), "exception");
  assert.equal(resolveShellMode("/admin/print"), "exception");
});

test("Admin Check-In uses the canonical Admin shell", () => {
  assert.equal(resolveShellMode("/admin/checkin"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/attendees"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/parking"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/login"), "exception");
  assert.equal(resolveShellMode("/admin/print"), "exception");
});

test("Admin Attendees uses the exact canonical Admin route without moving adjacent legacy routes", () => {
  assert.equal(resolveShellMode("/admin/attendees"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/attendees/history"), "legacy");
  assert.equal(resolveShellMode("/admin/engagement"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/imports"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/validation-rules"), "canonical-admin");
});

test("Admin shell Cohort 2 routes use the canonical Admin shell", () => {
  for (const pathname of [
    "/admin/data-review",
    "/admin/engagement",
    "/admin/imports",
    "/admin/validation-rules",
  ]) {
    assert.equal(resolveShellMode(pathname), "canonical-admin");
  }
});

test("Admin shell Cohort 3 routes use the canonical Admin shell", () => {
  for (const pathname of [
    "/admin/events",
    "/admin/agenda",
    "/admin/agenda/categories",
    "/admin/locations",
  ]) {
    assert.equal(resolveShellMode(pathname), "canonical-admin");
  }
});

test("Admin shell final safe cohort keeps Map Admin canonical", () => {
  assert.equal(resolveShellMode("/admin/map-admin"), "canonical-admin");
});

test("Admin Shell Migration Remaining Cluster slice moves the last legacy Admin map/nearby workspaces to the canonical Admin shell", () => {
  for (const pathname of [
    "/admin/map-test",
    "/admin/master-maps",
    "/admin/master-maps/new",
    "/admin/master-maps/example",
    "/admin/nearby",
    "/admin/nearby-google",
    "/admin/nearby-settings",
    "/admin/parking",
  ]) {
    assert.equal(resolveShellMode(pathname), "canonical-admin");
  }

  // /admin/master-maps is a prefix match; unrelated adjacent paths must
  // not be swept in by accident.
  assert.equal(resolveShellMode("/admin/master-mapsx"), "legacy");
});

test("Admin Print Settings uses the canonical Admin shell", () => {
  assert.equal(resolveShellMode("/admin/print-settings"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/print"), "exception");
  assert.equal(
    resolveShellMode("/admin/reports/coach-plates/print"),
    "exception",
  );
  assert.equal(
    resolveShellMode("/admin/reports/name-tags/print"),
    "exception",
  );
  assert.equal(resolveShellMode("/admin/events"), "canonical-admin");
});

test("Admin shell Cohort B2 routes use the canonical Admin shell", () => {
  for (const pathname of ["/admin/vendors", "/admin/evaluations"]) {
    assert.equal(resolveShellMode(pathname), "canonical-admin");
  }

  assert.equal(resolveShellMode("/admin/vendors/access"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/vendors/access/history"), "legacy");
  assert.equal(resolveShellMode("/admin/events"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/login"), "exception");
  assert.equal(resolveShellMode("/admin/print"), "exception");
  assert.equal(
    resolveShellMode("/admin/reports/coach-plates/print"),
    "exception",
  );
  assert.equal(
    resolveShellMode("/admin/reports/name-tags/print"),
    "exception",
  );
});

test("Admin shell Cohort 1 authority routes use the canonical Admin shell", () => {
  for (const pathname of [
    "/admin/admin-users",
    "/admin/event-staff",
    "/admin/permissions",
    "/admin/tenant-admins",
    "/admin/tenants",
  ]) {
    assert.equal(resolveShellMode(pathname), "canonical-admin");
  }
});

test("Admin Dashboard uses the canonical Admin shell", () => {
  assert.equal(resolveShellMode("/admin/dashboard"), "canonical-admin");

  for (const pathname of [
    "/admin/checklist",
    "/admin/checkin",
    "/admin/evaluations",
    "/admin/events/new",
    "/admin/export",
    "/admin/print-settings",
    "/admin/vendor-requests",
    "/admin/vendors",
    "/admin/vendors/access",
  ]) {
    assert.equal(resolveShellMode(pathname), "canonical-admin");
  }

  assert.equal(resolveShellMode("/admin/events"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/login"), "exception");
  assert.equal(resolveShellMode("/admin/print"), "exception");
  assert.equal(
    resolveShellMode("/admin/reports/coach-plates/print"),
    "exception",
  );
  assert.equal(
    resolveShellMode("/admin/reports/name-tags/print"),
    "exception",
  );
});

test("Passport Refunds uses the canonical Admin shell exactly once", () => {
  assert.equal(resolveShellMode("/admin/passport-refunds"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/passport-refunds/history"), "legacy");
});

test("Admin UI Reference (design workbench) uses the canonical Admin shell", () => {
  assert.equal(resolveShellMode("/admin/ui-reference"), "canonical-admin");
});

test("Admin Photos, Photo Library, and Slideshow use the canonical Admin shell while the audience viewer stays an exception", () => {
  assert.equal(resolveShellMode("/admin/photos"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/photo-library"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/slideshow"), "canonical-admin");
  assert.equal(resolveShellMode("/slideshow/view"), "exception");

  for (const pathname of [
    "/admin/checklist",
    "/admin/checkin",
    "/admin/dashboard",
    "/admin/evaluations",
    "/admin/events/new",
    "/admin/export",
    "/admin/print-settings",
    "/admin/vendor-requests",
    "/admin/vendors",
    "/admin/vendors/access",
  ]) {
    assert.equal(resolveShellMode(pathname), "canonical-admin");
  }
});

test("rendersJsxElement recognizes a real JSX render but never a string, template literal, or comment mentioning the same tag name", () => {
  const realOpeningTag = `export default function P() {\n  return <AdminShellAdapter pageTitle="X"><Inner /></AdminShellAdapter>;\n}\n`;
  const realSelfClosingTag = `export default function P() {\n  return <AdminShellAdapter pageTitle="X" />;\n}\n`;
  const stringLiteralMention = `export default function P() {\n  const note = "<AdminShellAdapter is not used on this page";\n  return <div>{note}</div>;\n}\n`;
  const templateLiteralMention = `export default function P() {\n  const note = \`renders without <AdminShellAdapter> by design\`;\n  return <div>{note}</div>;\n}\n`;
  const blockCommentMention = `export default function P() {\n  /* intentionally renders without AdminShellAdapter -- see print exception rationale */\n  return <div />;\n}\n`;
  const lineCommentMention = `export default function P() {\n  // <AdminShellAdapter would break window.print() here\n  return <div />;\n}\n`;
  const similarlyNamedTag = `export default function P() {\n  return <AdminShellAdapterHistory />;\n}\n`;

  assert.equal(rendersJsxElement(realOpeningTag, "real.tsx", "AdminShellAdapter"), true);
  assert.equal(rendersJsxElement(realSelfClosingTag, "real2.tsx", "AdminShellAdapter"), true);
  assert.equal(rendersJsxElement(stringLiteralMention, "string.tsx", "AdminShellAdapter"), false);
  assert.equal(rendersJsxElement(templateLiteralMention, "template.tsx", "AdminShellAdapter"), false);
  assert.equal(rendersJsxElement(blockCommentMention, "blockcomment.tsx", "AdminShellAdapter"), false);
  assert.equal(rendersJsxElement(lineCommentMention, "linecomment.tsx", "AdminShellAdapter"), false);
  assert.equal(rendersJsxElement(similarlyNamedTag, "similar.tsx", "AdminShellAdapter"), false);
});

test("Registry Provider Catalog uses the canonical Admin shell -- double-shell repair", () => {
  // Before this repair, /admin/registry-providers was absent from
  // EXACT_CANONICAL_ADMIN_ROUTES entirely, so resolveShellMode() fell
  // through to "legacy": ShellTransition then wrapped the page's own
  // (already-correct) AdminShellAdapter in LegacyChromeCompat's Sidebar,
  // nesting the canonical white shell inside the legacy dark one.
  assert.equal(resolveShellMode("/admin/registry-providers"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/registry-providers/history"), "legacy");
});

test("the new Admin workspace overview (/admin/admin) uses the canonical Admin shell exactly once -- no double shell", () => {
  assert.equal(resolveShellMode("/admin/admin"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/admin/history"), "legacy");
});

/**
 * Defect-class regression proof (Admin only, per this repair's scope).
 *
 * The registry omission that caused /admin/registry-providers' double
 * shell was possible because no test tied "a page renders its own
 * AdminShellAdapter" to "the registry classifies that route
 * canonical-admin" -- every other test above checks a fixed, hand-picked
 * path list, so a new Admin page could be built already using the
 * canonical shell and still never be added to the registry without any
 * test failing. This enumerates every real app/admin/**\/page.tsx file
 * (not a static list, so it cannot itself drift out of date the same
 * way), keeps only the ones that actually render <AdminShellAdapter>
 * (comments/strings stripped first, so a mention like /admin/print's own
 * "intentionally renders without AdminShellAdapter" explanation is not
 * mistaken for a real render), and asserts each one's derived route
 * resolves "canonical-admin". A future Admin page that renders
 * AdminShellAdapter but is never registered now fails this test
 * immediately, the same way /admin/registry-providers should have.
 */
test("every Admin page.tsx that actually renders AdminShellAdapter is classified canonical-admin by the registry", () => {
  const adminDir = fileURLToPath(new URL("../../app/admin", import.meta.url));

  function findPageFiles(dir: string, out: string[]): string[] {
    for (const entry of readdirSync(dir)) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) {
        findPageFiles(full, out);
      } else if (entry === "page.tsx") {
        out.push(full);
      }
    }
    return out;
  }

  const pageFiles = findPageFiles(adminDir, []);
  // Sanity floor: fails loudly if the walk itself breaks (wrong root,
  // empty tree) instead of silently asserting zero routes.
  assert.ok(pageFiles.length > 30, `expected many Admin page.tsx files, found ${pageFiles.length}`);

  const adapterRoutes: string[] = [];
  for (const filePath of pageFiles) {
    const source = readFileSync(filePath, "utf8");

    // Only an actual JSX render counts -- a bare mention in a comment or
    // string (e.g. /admin/print's own explanatory comment) must not.
    if (!rendersJsxElement(source, filePath, "AdminShellAdapter")) {
      continue;
    }

    const routePath = filePath
      .slice(adminDir.length - "/admin".length)
      .replace(/\/page\.tsx$/, "")
      // A dynamic segment never appears literally in a real pathname;
      // substitute a representative id the same way a real navigation
      // would supply one.
      .replace(/\[[^\]]+\]/g, "sample-id");

    adapterRoutes.push(routePath || "/admin");
  }

  // Ground truth as of Central Navigation Batch 1 (which added
  // /admin/admin, the new Admin workspace overview): 40 Admin routes
  // render their own AdminShellAdapter directly (verified by direct
  // enumeration, not assumed) -- this pins the count so a route silently
  // gaining or losing its adapter render is visible here too, not just a
  // resolve() check on routes this file already knows to ask about.
  assert.equal(adapterRoutes.length, 40, `expected 40 Admin routes rendering AdminShellAdapter, found ${adapterRoutes.length}: ${adapterRoutes.join(", ")}`);

  for (const routePath of adapterRoutes) {
    assert.equal(
      resolveShellMode(routePath),
      "canonical-admin",
      `${routePath} renders AdminShellAdapter but the registry does not classify it canonical-admin -- this is the exact double-shell defect class /admin/registry-providers had`,
    );
  }
});
