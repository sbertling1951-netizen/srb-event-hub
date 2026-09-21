import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

// Source regression guards; browser behavior is checked separately with
// synthetic Auth responses, never a real member's credentials.
test("activation and recovery lead to password setup; organizer keeps its destination", () => {
  assert.match(source, /activation: "\/member\/account\/reset-password"/);
  assert.match(source, /recovery: "\/member\/account\/reset-password"/);
  assert.match(source, /organizer: "\/organize"/);
});

test("PKCE passes the authorization code, not the whole callback URL", () => {
  assert.match(source, /exchangeCodeForSession\(code\)/);
  assert.doesNotMatch(source, /exchangeCodeForSession\(window\.location\.href\)/);
});

test("a fresh activation still must finalize successfully before navigation", () => {
  const finalize = source.indexOf('if (purpose === "activation" && isFreshExchange)');
  const rejected = source.indexOf('throw new Error("activation_not_finalized")');
  const navigate = source.indexOf("router.replace(DESTINATIONS[purpose])");
  assert.ok(finalize >= 0 && rejected > finalize && navigate > rejected);
  assert.match(source.slice(finalize, navigate), /if \(!attemptToken\)/);
  assert.match(source.slice(finalize, navigate), /if \(finalizeError\)/);
});
