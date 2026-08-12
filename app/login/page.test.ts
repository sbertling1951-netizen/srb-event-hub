import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveShellMode } from "@/components/shell/routeRegistry";

const ROOT_SOURCE = readFileSync(
  fileURLToPath(new URL("../page.tsx", import.meta.url)),
  "utf8",
);
const SELECTOR_PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);
const SELECTOR_SOURCE = readFileSync(
  fileURLToPath(new URL("../../components/auth/LoginSelector.tsx", import.meta.url)),
  "utf8",
);
const MEMBER_LOGIN_SOURCE = readFileSync(
  fileURLToPath(new URL("../member/login/page.tsx", import.meta.url)),
  "utf8",
);
const ADMIN_LOGIN_SOURCE = readFileSync(
  fileURLToPath(new URL("../admin/login/page.tsx", import.meta.url)),
  "utf8",
);
const VENDOR_LOGIN_SOURCE = readFileSync(
  fileURLToPath(new URL("../vendor/login/page.tsx", import.meta.url)),
  "utf8",
);

test("root preserves smart-entry routing while reusing the selector presentation", () => {
  assert.match(ROOT_SOURCE, /supabase\.auth\.getUser/);
  assert.match(ROOT_SOURCE, /router\.replace\("\/admin\/dashboard"\)/);
  assert.match(ROOT_SOURCE, /router\.replace\("\/member"\)/);
  assert.match(ROOT_SOURCE, /router\.replace\("\/member\/checkin"\)/);
  assert.match(ROOT_SOURCE, /router\.replace\("\/member\/account"\)/);
  assert.match(ROOT_SOURCE, /<LoginSelector\s*\/>/);
});

test("dedicated login route renders the selector without root routing", () => {
  assert.match(SELECTOR_PAGE_SOURCE, /<LoginSelector\s*\/>/);
  assert.doesNotMatch(SELECTOR_PAGE_SOURCE, /useEffect|router\.|supabase\./);
  assert.equal(resolveShellMode("/login"), "exception");
});

test("one selector presentation provides all role login links", () => {
  for (const href of ["/member/login", "/admin/login", "/vendor/login"]) {
    assert.match(SELECTOR_SOURCE, new RegExp(href));
  }
});

test("all login Back to Login actions target the dedicated selector", () => {
  for (const source of [MEMBER_LOGIN_SOURCE, ADMIN_LOGIN_SOURCE, VENDOR_LOGIN_SOURCE]) {
    assert.match(source, /variant="back" href="\/login"/);
    assert.doesNotMatch(source, /variant="back" href="\/"/);
  }
});
