import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Passport additions to the private
// Draft workspace page, consistent with this repository's established
// convention (see app/api/passport/checkout/route.test.ts).
//
// Run with:
//   npx tsx --test "app/organize/[eventId]/page.test.ts"

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("the Passport card is rendered with the draft's own event id and the return-from-checkout marker", () => {
  assert.match(
    SOURCE,
    /<OrganizerPassportCard\s*\n\s*eventId=\{draft\.event_id\}\s*\n\s*justReturnedFromCheckout=\{justReturnedFromCheckout\}\s*\n\s*\/>/,
  );
});

test("the return-from-checkout marker is read once on mount from the browser's own URL, and never asserted as payment truth", () => {
  assert.match(
    SOURCE,
    /new URLSearchParams\(window\.location\.search\)\.get\("passport_return"\) === "1"/,
  );
  assert.doesNotMatch(SOURCE, /setJustReturnedFromCheckout\(true\)[\s\S]{0,200}(reserved|succeeded|paid)/i);
});

test("a checkout_cancellation_required Delete failure surfaces the governed cancellation message clearly, instead of a raw/generic error", () => {
  assert.match(
    SOURCE,
    /message === "checkout_cancellation_required"\s*\n\s*\? "This event has an open Passport checkout\. Use .Expire checkout. in the Passport section above, then try deleting again\."/,
  );
});

test("standalone Delete's own RPC call and idempotency-key flow are unmodified by the Passport addition", () => {
  assert.match(
    SOURCE,
    /await deleteMyUnfinishedEvent\(supabase, \{\s*\n\s*eventId: draft\.event_id,\s*\n\s*idempotencyKey: deleteKey,\s*\n\s*\}\);/,
  );
});

test("the page never imports Stripe, never reads a Passport/attempt/receipt table, and never calls a service-only RPC directly", () => {
  const codeOnly = SOURCE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(codeOnly, /stripe/i);
  assert.doesNotMatch(codeOnly, /self_service_event_passport/);
  assert.doesNotMatch(codeOnly, /bind_self_service_event_passport_checkout_session|confirm_self_service_event_passport_payment|record_self_service_event_passport_checkout_terminal_state/);
});

test("no subscription, renewal, launch, refund, invoice, payment link, or Stripe Tax control was added to this page", () => {
  const passportSectionStart = SOURCE.indexOf("<OrganizerPassportCard");
  const passportSectionEnd = SOURCE.indexOf('<PageSection title="Agenda"');
  const addedBlock = SOURCE.slice(passportSectionStart, passportSectionEnd);
  assert.doesNotMatch(addedBlock, /subscri|renew|\blaunch\b|refund|invoice|payment.?link|\btax\b/i);
});
