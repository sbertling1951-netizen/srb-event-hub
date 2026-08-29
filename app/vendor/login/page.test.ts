import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);
const CALLBACK_SOURCE = readFileSync(
  fileURLToPath(new URL("../callback/page.tsx", import.meta.url)),
  "utf8",
);
const SESSION_ROUTE_SOURCE = readFileSync(
  fileURLToPath(new URL("../../api/vendor/session/route.ts", import.meta.url)),
  "utf8",
);

test("Vendor login keeps password recovery and access actions in a responsive in-card row", () => {
  const signInAction = SOURCE.indexOf('variant="primary"');
  const secondaryActions = SOURCE.indexOf('aria-label="Other sign-in options"');
  const status = SOURCE.indexOf("{status ? <div");
  assert.ok(signInAction >= 0);
  assert.ok(secondaryActions > signInAction);
  assert.ok(status > secondaryActions);

  // 540px leaves the card's existing padding plus three 150px action
  // targets and their gaps room to stay on one row at desktop/tablet widths.
  assert.match(SOURCE, /maxWidth: 540/);

  const row = SOURCE.slice(secondaryActions, status);
  assert.match(row, /gridTemplateColumns: "repeat\(auto-fit, minmax\(150px, 1fr\)\)"/);
  assert.match(row, /Recovery Link/);
  assert.match(row, /Request Vendor Access/);
  assert.match(row, /Choose Login Type/);
  assert.match(row, /onClick=\{\(\) => void sendPasswordReset\(\)\}/);
  assert.match(row, /href="\/vendor\/register"/);
  assert.match(row, /href="\/login"/);
  assert.doesNotMatch(SOURCE, />\s*Back to Login\s*</);
  assert.doesNotMatch(SOURCE, /fontSize: 12, color: "#888"/);
});

test("Vendor Login has no standalone passwordless sign-in link flow", () => {
  assert.doesNotMatch(SOURCE, /sendMagicLink|signInWithOtp|Email Me a Sign-in Link/);
});

test("Vendor recovery stays on its reset-password path with the shared yellow recovery treatment", () => {
  assert.match(SOURCE, /supabase\.auth\.resetPasswordForEmail/);
  assert.match(SOURCE, /redirectTo = `\$\{window\.location\.origin\}\/vendor\/reset-password`/);
  assert.match(SOURCE, /variant="recovery"[\s\S]*?Recovery Link/);
});

test("Vendor invitation callback and access-session infrastructure remain available", () => {
  assert.match(CALLBACK_SOURCE, /exchangeCodeForSession|setSession/);
  assert.match(CALLBACK_SOURCE, /fetch\("\/api\/vendor\/session"/);
  assert.match(SESSION_ROUTE_SOURCE, /activate_vendor_invitation/);
  assert.match(SESSION_ROUTE_SOURCE, /vendor_org_access/);
});
