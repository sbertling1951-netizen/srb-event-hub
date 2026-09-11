import "server-only";

import Stripe from "stripe";

/**
 * The narrow Passport contract's fixed first-release price:
 * docs/architecture/EPICENTRAX_STRIPE_PASSPORT_CHECKOUT_IMPLEMENTATION_SPECIFICATION.md
 * -- USD $24.00, one time, quantity 1. Never a caller-supplied value.
 */
export const PASSPORT_AMOUNT_MINOR_UNITS = 2400;
export const PASSPORT_CURRENCY = "usd";

export type StripePassportConfig = {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
};

/**
 * Reads the three server-only Stripe Passport variables at call time (never
 * cached at module load) so each request/test observes the current
 * environment. Missing configuration is a neutral "unavailable" result --
 * never a thrown error, and the caller never sees which specific variable is
 * missing.
 */
export function getStripePassportConfig(): StripePassportConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const priceId = process.env.STRIPE_PASSPORT_PRICE_ID;

  if (!secretKey || !webhookSecret || !priceId) {
    return null;
  }

  return { secretKey, webhookSecret, priceId };
}

/**
 * The exact surface this adapter and its callers use from the Stripe SDK --
 * deliberately narrower than the full `Stripe` type so tests can pass a
 * plain fake object with no real network client and no real Stripe types.
 * The real `new Stripe(secretKey)` client already satisfies this shape
 * structurally.
 */
export type PassportStripeClient = {
  checkout: {
    sessions: {
      create: (
        params: Stripe.Checkout.SessionCreateParams,
      ) => Promise<Stripe.Checkout.Session>;
      retrieve: (
        id: string,
        params?: Stripe.Checkout.SessionRetrieveParams,
      ) => Promise<Stripe.Checkout.Session>;
      expire: (id: string) => Promise<Stripe.Checkout.Session>;
    };
  };
  webhooks: {
    constructEvent: (
      payload: string | Buffer,
      header: string,
      secret: string,
    ) => Stripe.Event;
  };
};

export function createStripePassportClient(
  config: StripePassportConfig,
): PassportStripeClient {
  return new Stripe(config.secretKey);
}

/**
 * Creates exactly one Stripe Checkout Session for one Passport payment
 * attempt: the configured Price, quantity 1, mode payment. The attempt id is
 * carried in BOTH client_reference_id and metadata so the webhook can verify
 * it either way. Never accepts an amount or currency argument -- those come
 * only from the configured Price on Stripe's side.
 */
export async function createPassportCheckoutSession(
  client: PassportStripeClient,
  params: {
    priceId: string;
    attemptId: string;
    eventId: string;
    successUrl: string;
    cancelUrl: string;
  },
): Promise<Stripe.Checkout.Session> {
  return client.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: params.priceId, quantity: 1 }],
    client_reference_id: params.attemptId,
    metadata: {
      attempt_id: params.attemptId,
      event_id: params.eventId,
    },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
}

/** Retrieves a Checkout Session with its line items expanded -- required to
 * verify the exact Price and quantity, which are not present on the bare
 * session object. */
export async function retrievePassportCheckoutSession(
  client: PassportStripeClient,
  sessionId: string,
): Promise<Stripe.Checkout.Session> {
  return client.checkout.sessions.retrieve(sessionId, {
    expand: ["line_items"],
  });
}

export async function expirePassportCheckoutSession(
  client: PassportStripeClient,
  sessionId: string,
): Promise<Stripe.Checkout.Session> {
  return client.checkout.sessions.expire(sessionId);
}

/**
 * Verifies the raw webhook body's signature and returns the parsed event.
 * Must be called with the UNPARSED raw request body -- Stripe signs the
 * exact bytes, not a re-serialized JSON representation. Throws on an invalid
 * signature; the caller must not act on the body before this succeeds.
 */
export function verifyPassportWebhookSignature(
  client: PassportStripeClient,
  rawBody: string | Buffer,
  signatureHeader: string,
  webhookSecret: string,
): Stripe.Event {
  return client.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
}

export type PassportSessionFactCheck =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * The exact, non-substitutable Session <-> attempt binding: ALL THREE facts
 * must hold, every time, everywhere a Session is used --
 * client_reference_id, metadata.attempt_id, AND metadata.event_id. Neither
 * attempt-reference field is ever accepted as a stand-in for the other, and
 * the Event binding is checked against the server's OWN record of the
 * attempt (never anything read from the session/webhook payload itself).
 */
export function isPassportSessionBoundToAttempt(
  session: Stripe.Checkout.Session,
  params: { attemptId: string; eventId: string },
): boolean {
  return (
    session.client_reference_id === params.attemptId &&
    session.metadata?.attempt_id === params.attemptId &&
    session.metadata?.event_id === params.eventId
  );
}

/**
 * Independently re-verifies every fact the specification requires before any
 * confirmation may proceed: the exact Session <-> attempt/Event binding (see
 * isPassportSessionBoundToAttempt), the exact configured Price, quantity 1,
 * payment mode, payment_status paid, USD, and the exact $24.00 total. A
 * session retrieved without expanded line_items always fails closed here
 * rather than silently skipping the Price/quantity check.
 */
export function verifyPassportCheckoutSessionFacts(
  session: Stripe.Checkout.Session,
  params: { priceId: string; attemptId: string; eventId: string },
): PassportSessionFactCheck {
  if (session.mode !== "payment") {
    return { ok: false, reason: "mode" };
  }

  if (!isPassportSessionBoundToAttempt(session, params)) {
    return { ok: false, reason: "attempt_reference" };
  }

  if (session.payment_status !== "paid") {
    return { ok: false, reason: "payment_status" };
  }

  if ((session.currency ?? "").toLowerCase() !== PASSPORT_CURRENCY) {
    return { ok: false, reason: "currency" };
  }

  if (session.amount_total !== PASSPORT_AMOUNT_MINOR_UNITS) {
    return { ok: false, reason: "amount" };
  }

  const lineItems = session.line_items?.data ?? [];

  if (lineItems.length !== 1) {
    return { ok: false, reason: "line_item_count" };
  }

  const [lineItem] = lineItems;

  if (lineItem.quantity !== 1) {
    return { ok: false, reason: "quantity" };
  }

  const linePriceId =
    typeof lineItem.price === "string" ? lineItem.price : lineItem.price?.id;

  if (linePriceId !== params.priceId) {
    return { ok: false, reason: "price" };
  }

  return { ok: true };
}

/**
 * A PRELIMINARY lookup key only -- used solely to know which attempt to ask
 * the service-only reader about before the server's own event_id is even
 * known. Requires client_reference_id AND metadata.attempt_id to both be
 * present AND agree with each other; returns null otherwise (never accepts
 * either field alone). This is never the authorization decision itself --
 * isPassportSessionBoundToAttempt (checked against the server-resolved
 * attempt's own event_id) is what every caller must pass before acting.
 */
export function passportSessionLookupAttemptId(
  session: Stripe.Checkout.Session,
): string | null {
  const clientReferenceId = session.client_reference_id;
  const metadataAttemptId = session.metadata?.attempt_id;

  if (!clientReferenceId || !metadataAttemptId) {
    return null;
  }

  if (clientReferenceId !== metadataAttemptId) {
    return null;
  }

  return clientReferenceId;
}
