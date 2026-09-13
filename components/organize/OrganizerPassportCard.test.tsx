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
    /if \(body\.status === "confirmed"\) \{\s*\n\s*return \{ state: "confirmed", refundEligible: body\.refundEligible === true \};/,
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

test("no subscription, renewal, launch, invoice, payment link, or Stripe Tax control appears in this component", () => {
  assert.doesNotMatch(CODE_ONLY, /subscri|renew|\blaunch\b|invoice|payment.?link|\btax\b/i);
});

// ---- Super-Admin refund control (structural) ----

test("the refund control is gated by the server-derived status.refundEligible flag only -- no client table/RPC read, admin-access helper, or hardcoded role decides this", () => {
  assert.doesNotMatch(SOURCE, /getCurrentAdminAccess|isSuperAdmin|admin_users/);
  const confirmedStart = SOURCE.indexOf('status.state === "confirmed" ? (');
  const confirmedEnd = SOURCE.indexOf(') : status.state === "no_open_attempt"', confirmedStart);
  const block = SOURCE.slice(confirmedStart, confirmedEnd);
  assert.match(block, /\{status\.refundEligible \? \(/);
});

test("the refund control appears only inside the confirmed/reserved branch, never inside no_open_attempt, preparing, open, loading, or error branches", () => {
  const confirmedStart = SOURCE.indexOf('status.state === "confirmed" ? (');
  const confirmedEnd = SOURCE.indexOf(') : status.state === "no_open_attempt"', confirmedStart);
  const beforeConfirmed = SOURCE.slice(0, confirmedStart);
  const afterConfirmed = SOURCE.slice(confirmedEnd);
  assert.doesNotMatch(beforeConfirmed, /\{status\.refundEligible \?/);
  assert.doesNotMatch(afterConfirmed, /\{status\.refundEligible \?/);
});

test("refundEligible is carried ONLY on the confirmed status variant, sourced strictly from the server's own response field -- never inferred or defaulted to true", () => {
  assert.match(SOURCE, /\{ state: "confirmed"; refundEligible: boolean \}/);
  assert.match(SOURCE, /return \{ state: "confirmed", refundEligible: body\.refundEligible === true \};/);
});

test("the Refund control requires BOTH confirmed status AND server-derived eligibility -- confirmed alone is never sufficient", () => {
  const confirmedStart = SOURCE.indexOf('status.state === "confirmed" ? (');
  const confirmedEnd = SOURCE.indexOf(') : status.state === "no_open_attempt"', confirmedStart);
  const block = SOURCE.slice(confirmedStart, confirmedEnd);
  // The success alert (shown for every confirmed Passport, admin or not)
  // must appear BEFORE, and unconditionally on, the refundEligible check --
  // proving eligibility is an ADDITIONAL gate layered on top of confirmed,
  // never a replacement for it.
  const successIdx = block.indexOf("Passport confirmed.");
  const eligibleIdx = block.indexOf("status.refundEligible ?");
  assert.ok(successIdx !== -1 && eligibleIdx !== -1 && successIdx < eligibleIdx);
});

test("the refund action requires an explicit confirmation step before anything is requested", () => {
  const start = SOURCE.indexOf("async function requestPassportRefund");
  assert.notEqual(start, -1);
  assert.match(SOURCE, /onClick=\{\(\) => setRefundStage\("confirming"\)\}/);
  assert.match(SOURCE, /Confirm Passport refund/);
  assert.match(SOURCE, /one-time full \$24 Passport refund/);
  assert.match(SOURCE, /unpaid Delete\/Replace cycle\s+only after the refund is confirmed/);
});

test("requestPassportRefund prepares an opaque request id, then executes with only that id -- never an amount, currency, or Stripe identifier", () => {
  const start = CODE_ONLY.indexOf("async function requestPassportRefund");
  const end = CODE_ONLY.indexOf("\n  return (", start);
  const body = CODE_ONLY.slice(start, end);
  assert.match(body, /authorizedFetch\(\s*\n\s*"\/api\/admin\/passport\/refunds\/prepare"/);
  assert.match(body, /authorizedFetch\(\s*\n\s*"\/api\/admin\/passport\/refunds"/);
  assert.match(body, /body: JSON\.stringify\(\{ eventId \}\)/);
  assert.match(body, /body: JSON\.stringify\(\{ requestId \}\)/);
  assert.doesNotMatch(body, /amount|currency|paymentIntent|priceId/i);
});

test("requestPassportRefund never claims the refund succeeded -- only an accepted-request state is shown", () => {
  const start = SOURCE.indexOf("async function requestPassportRefund");
  const end = SOURCE.indexOf("\n  return (", start);
  const body = SOURCE.slice(start, end);
  assert.match(body, /executeStatus !== "refund_pending"/);
  assert.doesNotMatch(body, /refunded|refund succeeded|refund complete/i);
});

test("a pending refund request guards against duplicate clicks", () => {
  const start = SOURCE.indexOf("async function requestPassportRefund");
  const body = SOURCE.slice(start, start + 200);
  assert.match(body, /if \(refundStage === "working"\) \{\s*\n\s*return;/);
});

test("the accepted-request state is a plain informational message, never claiming refunded or confirmed", () => {
  const idx = SOURCE.indexOf('refundStage === "requested"');
  const block = SOURCE.slice(idx, idx + 200);
  assert.match(block, /Refund requested; awaiting confirmation/);
  assert.doesNotMatch(block, /refunded|confirmed/i);
});
