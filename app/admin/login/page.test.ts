import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("Admin login keeps secondary actions compactly inside the login card", () => {
  const loginAction = SOURCE.indexOf('variant="primary"');
  const secondaryActions = SOURCE.indexOf('aria-label="Other sign-in options"');
  const status = SOURCE.indexOf('<div style={{ fontSize: 13, color: "#666" }}>{status}</div>');
  assert.ok(loginAction >= 0);
  assert.ok(secondaryActions > loginAction);
  assert.ok(status > secondaryActions);

  const row = SOURCE.slice(secondaryActions, status);
  assert.match(row, /gridTemplateColumns: "repeat\(auto-fit, minmax\(150px, 1fr\)\)"/);
  assert.match(row, /Forget Password/);
  assert.match(row, /onClick=\{handleForgotPassword\}/);
  assert.match(row, /Choose Login Type/);
  assert.match(row, /href="\/login"/);
  assert.doesNotMatch(SOURCE, />\s*Back to Login\s*</);
});
