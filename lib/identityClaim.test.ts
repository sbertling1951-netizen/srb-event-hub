import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getIdentityClaimPublicMessage,
  type IdentityClaimPublicResult,
} from "@/lib/identityClaim";

test("ALREADY_ACTIVATED is a recognized public result with a sign-in-directing message", () => {
  const result: IdentityClaimPublicResult = "ALREADY_ACTIVATED";
  const message = getIdentityClaimPublicMessage(result);
  assert.match(message, /already activated/i);
  assert.match(message, /sign in/i);
  // it must not imply another activation step is coming
  assert.doesNotMatch(message, /continue securely/i);
  // and it must reassure that nothing changed
  assert.match(message, /no account changes/i);
});

test("the other public-result messages are unchanged", () => {
  assert.match(
    getIdentityClaimPublicMessage("CONTINUE_VERIFICATION"),
    /continue securely/i,
  );
  assert.match(
    getIdentityClaimPublicMessage("CREATE_NEW_ACCOUNT_AVAILABLE"),
    /could not confirm an existing account/i,
  );
  assert.match(
    getIdentityClaimPublicMessage("REVIEW_REQUIRED"),
    /additional verification step/i,
  );
  assert.match(
    getIdentityClaimPublicMessage("UNABLE_TO_VERIFY"),
    /could not verify/i,
  );
});
