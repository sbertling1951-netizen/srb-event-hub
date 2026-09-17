import assert from "node:assert/strict";
import { test } from "node:test";

import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ShellHeader } from "@/components/shell/ShellHeader";
import type { ShellConfig } from "@/components/shell/types";

// Behavioral proof for the header's `homeAction` slot (Central Navigation
// Batch 2A). Uses react-dom/server's renderToStaticMarkup -- already a
// project dependency, the same pattern this session's shell tests already
// use -- since ShellHeader is a plain function of props (no hooks, no
// refs it reads itself beyond forwarding navTriggerRef), so it renders
// real, complete markup with no jsdom/testing-library dependency needed.
// Run with:
//   npx tsx --test components/shell/ShellHeader.test.tsx

function baseConfig(overrides: Partial<ShellConfig> = {}): ShellConfig {
  return {
    role: "admin",
    brand: { title: "Test Tenant" },
    pageTitle: "Test Page",
    navSections: [],
    ...overrides,
  };
}

function renderHeader(config: ShellConfig, isCompact: boolean): string {
  return renderToStaticMarkup(
    <ShellHeader
      config={config}
      isCompact={isCompact}
      navOpen={false}
      onToggleNav={() => {}}
      navTriggerRef={createRef<HTMLButtonElement>()}
    />,
  );
}

test("homeAction renders as a real link when present", () => {
  const config = baseConfig({ homeAction: { href: "/admin/dashboard", label: "Dashboard" } });
  const html = renderHeader(config, false);
  assert.match(html, /<a href="\/admin\/dashboard" class="shell-back-action shell-home-action">Dashboard<\/a>/);
});

test("homeAction renders nothing when null or absent -- no dead/empty markup", () => {
  const withNull = renderHeader(baseConfig({ homeAction: null }), false);
  const withAbsent = renderHeader(baseConfig(), false);
  assert.doesNotMatch(withNull, /shell-home-action/);
  assert.doesNotMatch(withAbsent, /shell-home-action/);
});

test("an explicit page backTarget and the role's homeAction render TOGETHER -- Dashboard is additional, never a replacement for the page's own parent-return link", () => {
  const config = baseConfig({
    backTarget: { href: "/admin/vendors", label: "Vendor Management" },
    homeAction: { href: "/admin/dashboard", label: "Dashboard" },
  });
  const html = renderHeader(config, false);
  assert.match(html, /<a href="\/admin\/vendors" class="shell-back-action">← Vendor Management<\/a>/);
  assert.match(html, /<a href="\/admin\/dashboard" class="shell-back-action shell-home-action">Dashboard<\/a>/);
  // The back link must still appear before the home action, preserving
  // existing slot order rather than reordering around the new field.
  assert.ok(html.indexOf("Vendor Management") < html.indexOf(">Dashboard<"));
});

test("homeAction is present and identical in both desktop and compact/mobile presentation -- no viewport gating on this slot", () => {
  const config = baseConfig({ homeAction: { href: "/admin/dashboard", label: "Dashboard" } });
  const desktop = renderHeader(config, false);
  const compact = renderHeader(config, true);
  const homeLinkPattern = /<a href="\/admin\/dashboard" class="shell-back-action shell-home-action">Dashboard<\/a>/;
  assert.match(desktop, homeLinkPattern);
  assert.match(compact, homeLinkPattern);
});

test("backTarget and homeAction together are present in both desktop and compact/mobile presentation", () => {
  const config = baseConfig({
    backTarget: { href: "/admin/vendors", label: "Vendor Management" },
    homeAction: { href: "/admin/dashboard", label: "Dashboard" },
  });
  for (const isCompact of [false, true]) {
    const html = renderHeader(config, isCompact);
    assert.match(html, /Vendor Management/);
    assert.match(html, /shell-home-action/);
  }
});

test("a role that never sets homeAction (Member/Vendor/Organizer shape) renders byte-identical to before this field existed -- no stray markup from an absent slot", () => {
  const memberLikeConfig = baseConfig({ role: "member", homeAction: undefined });
  const html = renderHeader(memberLikeConfig, false);
  assert.doesNotMatch(html, /shell-home-action/);
});
