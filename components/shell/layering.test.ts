import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const globalsCss = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);
const shellNavSource = readFileSync(
  fileURLToPath(new URL("./ShellNav.tsx", import.meta.url)),
  "utf8",
);
const adminShellAdapterSource = readFileSync(
  fileURLToPath(new URL("./adapters/AdminShellAdapter.tsx", import.meta.url)),
  "utf8",
);
const memberShellAdapterSource = readFileSync(
  fileURLToPath(new URL("./adapters/MemberShellAdapter.tsx", import.meta.url)),
  "utf8",
);
const dialogSource = readFileSync(
  fileURLToPath(new URL("../ui/Dialog.tsx", import.meta.url)),
  "utf8",
);
const objectPanelSource = readFileSync(
  fileURLToPath(new URL("../ObjectPanel.tsx", import.meta.url)),
  "utf8",
);

function cssRule(selector: string) {
  const match = globalsCss.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `expected CSS rule for ${selector}`);
  return match[1];
}

test("ordinary canonical-shell content is bounded below the navigation overlay", () => {
  const shellBody = cssRule("\\.shell-body");
  const drawerBackdrop = cssRule("\\.shell-nav-drawer-backdrop");
  const tableToolbar = cssRule("\\.table-toolbar");

  assert.match(shellBody, /position:\s*relative;/);
  assert.match(shellBody, /z-index:\s*0;/);
  assert.match(drawerBackdrop, /position:\s*fixed;/);
  assert.match(drawerBackdrop, /z-index:\s*60;/);
  assert.match(tableToolbar, /position:\s*sticky;/);
  assert.match(tableToolbar, /z-index:\s*900;/);
});

test("the drawer is contained by its backdrop, so it paints above the backdrop while both remain above content", () => {
  assert.match(
    shellNavSource,
    /<div className="shell-nav-drawer-backdrop"[\s\S]*?<div[\s\S]*?className="shell-nav-drawer"/,
  );
});

test("Admin and Member use the same bounded canonical-shell content layer", () => {
  assert.match(adminShellAdapterSource, /<AppShell\b/);
  assert.match(memberShellAdapterSource, /<AppShell\b/);
});

test("intentional transient overlays remain outside the shell and above navigation", () => {
  assert.match(dialogSource, /createPortal\([\s\S]*?document\.body,/);
  assert.match(objectPanelSource, /createPortal\([\s\S]*?document\.body,/);
  assert.match(cssRule("\\.app-dialog-backdrop"), /z-index:\s*10010;/);
  assert.match(cssRule("\\.object-panel-backdrop"), /z-index:\s*10000;/);
});
