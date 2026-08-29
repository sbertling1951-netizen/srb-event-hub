import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("Vendor login keeps all secondary actions in a responsive in-card row", () => {
  const signInAction = SOURCE.indexOf('variant="primary"');
  const secondaryActions = SOURCE.indexOf('aria-label="Other sign-in options"');
  const status = SOURCE.indexOf("{status ? <div");
  assert.ok(signInAction >= 0);
  assert.ok(secondaryActions > signInAction);
  assert.ok(status > secondaryActions);

  const row = SOURCE.slice(secondaryActions, status);
  assert.match(row, /gridTemplateColumns: "repeat\(auto-fit, minmax\(150px, 1fr\)\)"/);
  assert.match(row, /Forgot Password/);
  assert.match(row, /Email Me a Sign-in Link/);
  assert.match(row, /Request Vendor Access/);
  assert.match(row, /Choose Login Type/);
  assert.match(row, /onClick=\{\(\) => void sendPasswordReset\(\)\}/);
  assert.match(row, /onClick=\{\(\) => void sendMagicLink\(\)\}/);
  assert.match(row, /href="\/vendor\/register"/);
  assert.match(row, /href="\/login"/);
  assert.doesNotMatch(SOURCE, />\s*Back to Login\s*</);
  assert.doesNotMatch(SOURCE, /fontSize: 12, color: "#888"/);
});
