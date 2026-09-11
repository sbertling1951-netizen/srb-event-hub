import { NextResponse } from "next/server";

import {
  createStripePassportClient,
  getStripePassportConfig,
  isPassportSessionBoundToAttempt,
  passportSessionLookupAttemptId,
  retrievePassportCheckoutSession,
  verifyPassportCheckoutSessionFacts,
  verifyPassportWebhookSignature,
} from "@/lib/server/stripePassport";
import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";

// Stripe Passport webhook. Deliberately separate from organizer
// authentication -- it receives no bearer session and grants none. It is the
// ONLY path that may ever confirm a Passport payment: the raw body is read
// and its signature verified BEFORE anything is parsed or acted on, and the
// retrieved Checkout Session is independently re-verified against the exact
// configured Price/quantity/mode/payment_status/currency/amount and the
// specific attempt it claims before confirm_self_service_event_passport_payment
// is ever called. An invalid signature or invalid payment fact never mutates
// the database.

function noStore(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  const config = getStripePassportConfig();

  if (!config) {
    // No secret configured means we cannot verify anything -- reject rather
    // than trust an unverifiable body.
    return noStore({ error: "webhook_unavailable" }, 503);
  }

  if (!signature) {
    return noStore({ error: "invalid_signature" }, 400);
  }

  const stripe = createStripePassportClient(config);

  let event;

  try {
    event = verifyPassportWebhookSignature(stripe, rawBody, signature, config.webhookSecret);
  } catch (signatureError) {
    console.error("Passport webhook signature verification failed.", signatureError);
    return noStore({ error: "invalid_signature" }, 400);
  }

  // Only the two Checkout event types this release needs. Every other valid,
  // signature-verified event type is acknowledged without any database call.
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.expired") {
    return noStore({ received: true });
  }

  const admin = getSupabaseAdminClient();

  if (!admin) {
    return noStore({ error: "internal_error" }, 500);
  }

  const eventSessionId = event.data.object.id;

  // Independently retrieve the Checkout Session -- the webhook payload's
  // embedded object is never trusted for the fact-check; line_items must be
  // expanded to verify the exact Price and quantity, which the payload does
  // not carry.
  let session;

  try {
    session = await retrievePassportCheckoutSession(stripe, eventSessionId);
  } catch (retrieveError) {
    console.error("Passport webhook session retrieval failed.", retrieveError);
    return noStore({ error: "session_retrieval_failed" }, 502);
  }

  // A preliminary lookup key only -- client_reference_id and
  // metadata.attempt_id must already agree with each other, but this is NOT
  // yet the authorization decision.
  const lookupAttemptId = passportSessionLookupAttemptId(session);

  if (!lookupAttemptId) {
    // No usable attempt reference -- nothing this release can act on.
    // Acknowledge without mutation rather than error (avoids endless Stripe
    // retries for a session this Passport slice never created).
    return noStore({ received: true });
  }

  // Obtain the attempt from the service-only reader FIRST -- its own
  // event_id, never anything read from the session/webhook payload, is what
  // the exact binding below is checked against.
  const { data: serverRow } = await admin.rpc(
    "get_self_service_event_passport_checkout_attempt_for_server",
    { p_attempt_id: lookupAttemptId },
  );
  const attempt = Array.isArray(serverRow) ? serverRow[0] : serverRow;

  if (!attempt) {
    return noStore({ received: true });
  }

  const attemptId = attempt.attempt_id;

  // The exact three-part binding, shared by both the expiry and completion
  // paths: an incomplete or mismatched attempt/Event reference acknowledges
  // without any database mutation, exactly like any other invalid payment
  // fact.
  if (!isPassportSessionBoundToAttempt(session, { attemptId, eventId: attempt.event_id })) {
    return noStore({ received: true });
  }

  if (event.type === "checkout.session.expired") {
    if (attempt.state !== "open" || attempt.provider_session_id !== session.id) {
      // Already resolved by another path (DELETE, or a concurrent
      // completion) -- a harmless no-op, never re-raised as an error.
      return noStore({ received: true });
    }

    const { error: terminalError } = await admin.rpc(
      "record_self_service_event_passport_checkout_terminal_state",
      {
        p_attempt_id: attemptId,
        p_provider_session_id: session.id,
        p_terminal_state: "expired",
      },
    );

    if (terminalError) {
      console.error("Passport webhook expiry recording failed.", terminalError);
      return noStore({ error: "expiry_failed" }, 500);
    }

    return noStore({ received: true });
  }

  // checkout.session.completed -- verify every fact before confirming.
  const factCheck = verifyPassportCheckoutSessionFacts(session, {
    priceId: config.priceId,
    attemptId,
    eventId: attempt.event_id,
  });

  if (!factCheck.ok) {
    console.error("Passport webhook session failed fact verification.", factCheck.reason);
    return noStore({ received: true });
  }

  const { error: confirmError } = await admin.rpc("confirm_self_service_event_passport_payment", {
    p_attempt_id: attemptId,
    p_provider_session_id: session.id,
    // Stripe's own event id is the durable provider-event idempotency
    // input -- never the session id, which can legitimately repeat across
    // retries of the SAME event.
    p_provider_event_id: event.id,
  });

  if (confirmError) {
    console.error("Passport webhook confirmation failed.", confirmError);
    return noStore({ error: "confirmation_failed" }, 500);
  }

  return noStore({ received: true });
}
