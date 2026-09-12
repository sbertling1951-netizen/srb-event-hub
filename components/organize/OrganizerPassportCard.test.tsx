import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import { OrganizerPassportCard } from "@/components/organize/OrganizerPassportCard";

// Run with: npx tsx --test components/organize/OrganizerPassportCard.test.tsx
//
// The card's real interactive states depend entirely on fetch calls to
// /api/passport/checkout (structurally tested on its own -- see
// app/api/passport/checkout/route.test.ts); useEffect does not run under
// renderToStaticMarkup, so only the synchronous initial render is proven
// behaviorally here. The redirect/expire/never-claim-success logic is
// proven from source, consistent with the rest of this Passport slice.

const SOURCE = readFileSync(
  fileURLToPath(new URL("./OrganizerPassportCard.tsx", import.meta.url)),
  "utf8",
);
const CODE_ONLY = SOURCE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

// ---- Initial render (behavioral) ----

test("the initial render shows the loading state and the fixed $24 explanation, with no return banner by default", () => {
  const html = renderToStaticMarkup(
    <OrganizerPassportCard eventId="11111111-1111-4111-8111-111111111111" justReturnedFromCheckout={false} />,
  );
  assert.match(html, /One-time \$24 Passport for this private Event/);
  assert.match(html, /Checking Passport status/);
  assert.doesNotMatch(html, /Payment received/);
});

test("justReturnedFromCheckout shows the informational confirming banner, which never claims success", () => {
  const html = renderToStaticMarkup(
    <OrganizerPassportCard eventId="11111111-1111-4111-8111-111111111111" justReturnedFromCheckout={true} />,
  );
  assert.match(html, /Payment received; confirming your Passport/);
  assert.doesNotMatch(html, /payment (succeeded|successful|complete)/i);
  assert.doesNotMatch(html, /Passport (active|reserved|purchased)/i);
});

// ---- Confirmed state (structural -- confirmed is reached only after the
// async fetchStatus resolves, which renderToStaticMarkup does not run) ----

test("the confirmed status maps to a distinct success state, never the no_open_attempt purchase branch", () => {
  const bodyStart = SOURCE.indexOf("async function fetchStatus");
  const bodyEnd = SOURCE.indexOf("\n}", bodyStart);
  const body = SOURCE.slice(bodyStart, bodyEnd);
  assert.match(
    body,
    /if \(body\.status === "confirmed"\) \{\s*\n\s*return \{ state: "confirmed" \};/,
  );
});

test("the confirmed render shows a plain success message and never the purchase button", () => {
  const renderStart = SOURCE.indexOf("status.state === \"confirmed\" ? (");
  assert.notEqual(renderStart, -1, "expected a distinct confirmed render branch");
  const renderEnd = SOURCE.indexOf(") : status.state === \"no_open_attempt\"", renderStart);
  const block = SOURCE.slice(renderStart, renderEnd);
  assert.match(block, /Passport confirmed/);
  assert.match(block, /preserved/i);
  assert.doesNotMatch(block, /Purchase Passport/);
});

test("the confirmed render appears before the no_open_attempt purchase-button branch, so a confirmed Passport can never fall through to it", () => {
  const confirmedIdx = SOURCE.indexOf('status.state === "confirmed"');
  const noOpenAttemptIdx = SOURCE.indexOf('status.state === "no_open_attempt"');
  assert.ok(confirmedIdx !== -1 && noOpenAttemptIdx !== -1);
  assert.ok(confirmedIdx < noOpenAttemptIdx);
});

test("the return-from-Checkout confirming banner is suppressed once the status read reports confirmed -- it never lingers alongside the success state", () => {
  assert.match(
    CODE_ONLY,
    /\{justReturnedFromCheckout && status\.state !== "confirmed" \? \(/,
  );
});

// ---- Authority / redirect discipline (structural) ----

test("every request carries the Supabase session's own bearer token -- never a client-constructed credential", () => {
  assert.match(SOURCE, /const \{ data \} = await supabase\.auth\.getSession\(\);/);
  assert.match(SOURCE, /Authorization:\s*`Bearer \$\{accessToken\}`/);
});

test("a missing session fails closed before any fetch -- never sends an unauthenticated request", () => {
  assert.match(
    SOURCE,
    /if \(!accessToken\) \{\s*\n\s*throw new Error\("Your session has expired\. Please sign in again\."\);/,
  );
});

test("the browser redirects only to the exact URL the server returned -- never a client-constructed or client-supplied URL", () => {
  assert.match(SOURCE, /window\.location\.assign\(body\.url\)/);
  // the only other window.location use, if any, must not exist -- no
  // second, competing redirect target anywhere in this component
  const assigns = [...CODE_ONLY.matchAll(/window\.location\.assign\(/g)];
  assert.equal(assigns.length, 1);
});

test("POST always sends only the eventId -- never an amount, currency, or Passport state", () => {
  const postIdx = SOURCE.indexOf('method: "POST"');
  const block = SOURCE.slice(postIdx, postIdx + 300);
  assert.match(block, /body:\s*JSON\.stringify\(\{ eventId \}\)/);
});

test("a payment_completing response from DELETE is treated as a safe refresh, never as a successful cancellation", () => {
  assert.match(
    SOURCE,
    /if \(body\?\.status === "payment_completing"\) \{\s*\n\s*setActionError\(null\);\s*\n\s*await refresh\(\);/,
  );
});

test("the card never renders a provider session id, receipt, secret, or Price id", () => {
  assert.doesNotMatch(CODE_ONLY, /provider_session_id|secretKey|webhookSecret|priceId|receipt/i);
});

test("no subscription, renewal, launch, refund, invoice, payment link, or Stripe Tax control appears in this component", () => {
  assert.doesNotMatch(CODE_ONLY, /subscri|renew|\blaunch\b|refund|invoice|payment.?link|\btax\b/i);
});
