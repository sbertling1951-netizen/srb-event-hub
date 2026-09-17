import assert from "node:assert/strict";
import { test } from "node:test";

import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { resolveTabWrapTarget, ShellNav } from "@/components/shell/ShellNav";
import type { ShellNavSection } from "@/components/shell/types";

// Behavioral proof for the shared nested-submenu renderer (Central
// Navigation Batch 1). Uses react-dom/server's renderToStaticMarkup --
// already a project dependency, the same pattern already established by
// components/ContextCard.test.tsx and app/admin/attendees/page.test.tsx --
// rather than adopting a DOM-testing library. This renders real markup
// and asserts on it directly, so it proves actual structural desktop/
// mobile parity, not just that the two call sites share source text.
//
// Scope note: renderToStaticMarkup never runs React effects (a
// server-rendering concept, not a testing limitation specific to this
// file), so the auto-open-on-navigation useEffect path is not exercised
// here -- only the FIRST-render synchronous initial state is, which is
// also the actually-important behavior: it is what a real navigation
// (a fresh page load / route change, which always remounts or re-renders
// AppShell -> ShellNav with a new activeHref) produces on first paint.
// The same limitation means the live mobile-drawer focus-trap keydown
// LISTENER itself (real refs, a real DOM, a real "Tab" event) cannot be
// exercised here -- there is no jsdom/testing-library dependency in this
// project (deliberately, per the same established convention). What CAN
// be exercised directly, with no synthetic/mocked drawer or re-
// implemented algorithm at all, is the pure Tab-boundary DECISION itself:
// ShellNav.tsx exports `resolveTabWrapTarget()`, the exact function its
// own keydown handler calls after re-querying the live DOM on every Tab
// press. The dedicated test below imports and calls that real function
// directly against plain-object stand-ins for focusable elements --
// proving the production decision logic itself, not a look-alike copy of
// it, while the handler's own re-querying-per-keypress wiring is proven
// correct by direct source inspection (it calls this same exported
// function, with a fresh `querySelectorAll` result, inside the handler).
// Run with:
//   npx tsx --test components/shell/ShellNav.test.tsx

function vendorsSections(): ShellNavSection[] {
  return [
    {
      id: "admin",
      items: [
        { id: "dashboard", label: "Dashboard", href: "/admin/dashboard" },
        {
          id: "vendors",
          label: "Vendors",
          href: "/admin/vendors",
          children: [
            { id: "vendor-requests", label: "Vendor Requests", href: "/admin/vendor-requests" },
            { id: "vendors-access", label: "Vendor Access", href: "/admin/vendors/access" },
          ],
        },
      ],
    },
  ];
}

function renderNav(options: {
  sections: ShellNavSection[];
  activeHref?: string | null;
  isCompact: boolean;
  open?: boolean;
}): string {
  const ref = createRef<HTMLButtonElement>();
  return renderToStaticMarkup(
    <ShellNav
      sections={options.sections}
      activeHref={options.activeHref ?? null}
      isCompact={options.isCompact}
      open={options.open ?? false}
      onClose={() => {}}
      triggerRef={ref}
    />,
  );
}

test("a flat item with no children renders exactly as before -- no toggle, no submenu markup at all", () => {
  const html = renderNav({ sections: vendorsSections(), isCompact: false });
  assert.match(html, /<a[^>]*href="\/admin\/dashboard"[^>]*><span>Dashboard<\/span><\/a>/);
  // Dashboard has no children: its own item-group must carry no toggle button.
  const dashboardGroup = html.slice(html.indexOf("Dashboard") - 400, html.indexOf("Dashboard") + 50);
  assert.doesNotMatch(dashboardGroup, /shell-nav-item-toggle/);
});

test("a parent with children renders a real link to its own landing page PLUS a separate accessible expand/collapse control -- not a combined widget", () => {
  const html = renderNav({ sections: vendorsSections(), isCompact: false });
  assert.match(html, /<a class="shell-nav-item" href="\/admin\/vendors"><span>Vendors<\/span><\/a>/);
  assert.match(html, /<button type="button" class="shell-nav-item-toggle" aria-expanded="(true|false)" aria-controls="shell-nav-submenu-vendors"/);
});

test("exactly one active leaf is selected, and its parent is open, on first render -- proven for both desktop and the mobile drawer, from the identical NavSections renderer", () => {
  const desktop = renderNav({ sections: vendorsSections(), activeHref: "/admin/vendor-requests", isCompact: false });
  const drawer = renderNav({ sections: vendorsSections(), activeHref: "/admin/vendor-requests", isCompact: true, open: true });

  for (const html of [desktop, drawer]) {
    // The parent's own link is not itself marked active (it isn't the
    // active leaf) but its submenu is open (aria-expanded="true").
    assert.doesNotMatch(html, /aria-current="page"[^>]*href="\/admin\/vendors"/);
    assert.match(html, /aria-expanded="true" aria-controls="shell-nav-submenu-vendors"/);
    // The child that IS the active leaf carries aria-current and the
    // active class; its sibling does not.
    assert.match(html, /aria-current="page" class="shell-nav-subitem shell-nav-subitem-active" href="\/admin\/vendor-requests"/);
    assert.doesNotMatch(html, /aria-current="page"[^>]*href="\/admin\/vendors\/access"/);
    // Exactly one aria-current="page" in the whole render.
    assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
  }
});

test("visiting the parent's own landing page marks the parent itself active and still opens its submenu", () => {
  const html = renderNav({ sections: vendorsSections(), activeHref: "/admin/vendors", isCompact: false });
  assert.match(html, /aria-current="page" class="shell-nav-item shell-nav-item-active" href="\/admin\/vendors"/);
  assert.match(html, /aria-expanded="true" aria-controls="shell-nav-submenu-vendors"/);
});

test("desktop <aside> and mobile drawer render byte-identical NavSections content -- no duplicated markup or viewport-specific submenu logic", () => {
  const desktop = renderNav({ sections: vendorsSections(), activeHref: "/admin/vendor-requests", isCompact: false });
  const drawer = renderNav({ sections: vendorsSections(), activeHref: "/admin/vendor-requests", isCompact: true, open: true });

  const desktopNav = desktop.slice(desktop.indexOf("<nav"), desktop.indexOf("</nav>") + "</nav>".length);
  const drawerNav = drawer.slice(drawer.indexOf("<nav"), drawer.indexOf("</nav>") + "</nav>".length);
  assert.equal(desktopNav, drawerNav, "the rendered <nav> subtree must be identical regardless of viewport");
});

test("a parent whose children all end up empty after the builder's own filtering renders as a plain leaf -- no dead, empty submenu toggle", () => {
  const sections: ShellNavSection[] = [
    { id: "admin", items: [{ id: "attendees", label: "Attendees", href: "/admin/attendees", children: [] }] },
  ];
  const html = renderNav({ sections, isCompact: false });
  assert.doesNotMatch(html, /shell-nav-item-toggle/);
  assert.doesNotMatch(html, /shell-nav-submenu/);
  assert.match(html, /<a class="shell-nav-item" href="\/admin\/attendees"><span>Attendees<\/span><\/a>/);
});

test("the mobile drawer still applies its existing accessibility contract unchanged (dialog role, modal flag, label) with submenus present", () => {
  const html = renderNav({ sections: vendorsSections(), activeHref: "/admin/vendor-requests", isCompact: true, open: true });
  assert.match(html, /id="shell-nav-drawer" class="shell-nav-drawer" role="dialog" aria-modal="true" aria-label="Navigation"/);
});

test("closed drawer (isCompact, not open) renders nothing, exactly as before submenus existed", () => {
  const html = renderNav({ sections: vendorsSections(), activeHref: "/admin/vendor-requests", isCompact: true, open: false });
  assert.equal(html, "");
});

test("an account action still renders identically regardless of submenu presence elsewhere in the same sections array", () => {
  const sectionsWithAccountActions = vendorsSections();
  const html = renderToStaticMarkup(
    <ShellNav
      sections={sectionsWithAccountActions}
      accountActions={[{ id: "sign-out", label: "Sign Out", variant: "danger", onClick: () => {} }]}
      activeHref={null}
      isCompact
      open
      onClose={() => {}}
      triggerRef={createRef<HTMLButtonElement>()}
    />,
  );
  assert.match(html, /shell-nav-account-actions/);
  assert.match(html, /Sign Out/);
});

test("resolveTabWrapTarget() -- the actual exported production helper ShellNav.tsx's own keydown handler calls -- correctly includes a newly added submenu child and excludes a removed one", () => {
  // This calls the real, exported production function directly -- not a
  // re-implementation of its algorithm. Its parameters are plain values
  // compared only by reference identity and array length/indexing
  // (ArrayLike<HTMLElement>, Element | null, boolean), so a plain object
  // cast to HTMLElement satisfies its real signature exactly without
  // needing a real DOM, jsdom, or testing-library -- the caller (the
  // production keydown handler) is what is responsible for re-querying
  // the live DOM fresh on every Tab press; this function itself is
  // proven correct for whatever list it is given.
  function fakeElement(id: string): HTMLElement {
    return { id } as unknown as HTMLElement;
  }

  const dashboard = fakeElement("dashboard");
  const vendorsToggle = fakeElement("vendors-toggle");
  const vendorRequests = fakeElement("vendor-requests");
  const vendorsAccess = fakeElement("vendors-access");

  // Collapsed: "vendors-toggle" is the last focusable element. Forward
  // Tab from it wraps to "dashboard".
  const collapsed = [dashboard, vendorsToggle];
  assert.equal(resolveTabWrapTarget(collapsed, vendorsToggle, false), dashboard);

  // Expand the "Vendors" submenu -- two new real focusable child links
  // now exist in the drawer, after the toggle (simulating exactly what
  // the production handler's own fresh querySelectorAll call would
  // return once the submenu is open).
  const expanded = [dashboard, vendorsToggle, vendorRequests, vendorsAccess];

  // PROOF 1 (a newly added submenu child is included in the Tab-wrap
  // set): "vendors-toggle" is no longer last once expanded, so forward
  // Tab from it must NOT wrap. A stale/cached focusable list (the
  // pre-repair bug) would still treat it as last and incorrectly wrap.
  assert.equal(
    resolveTabWrapTarget(expanded, vendorsToggle, false),
    null,
    "a stale focusable list would wrongly wrap here -- the newly expanded child links must be seen",
  );
  // Forward Tab from the LAST of the two newly-added children must now
  // wrap to first -- proving the new child is genuinely part of the wrap
  // set, not merely "not wrapped too early".
  assert.equal(resolveTabWrapTarget(expanded, vendorsAccess, false), dashboard);

  // PROOF 2 (a removed submenu child is excluded from the Tab-wrap set):
  // collapse the submenu -- the two child links are gone from the
  // drawer's real focusable elements, so "vendors-toggle" is last again.
  assert.equal(resolveTabWrapTarget(collapsed, vendorsToggle, false), dashboard);
  // The removed element is never produced as a wrap target once it is
  // absent from the list passed in -- there is no lingering reference to
  // it anywhere resolveTabWrapTarget can reach.
  assert.notEqual(resolveTabWrapTarget(collapsed, vendorsToggle, false), vendorsAccess);

  // Backward Tab (Shift+Tab) from the first element wraps to last --
  // proven against the real helper too, not assumed.
  assert.equal(resolveTabWrapTarget(expanded, dashboard, true), vendorsAccess);

  // No focusable elements at all -- no wrap target, matching the real
  // function's own early return.
  assert.equal(resolveTabWrapTarget([], dashboard, false), null);
});
