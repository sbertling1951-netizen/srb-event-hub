import { NextResponse } from "next/server";

import { createAuthenticatedUserClient } from "@/lib/server/authenticatedUserClient";
import { resolveAuthenticatedRequest } from "@/lib/server/authenticationBoundary";
import {
  createPassportCheckoutSession,
  createStripePassportClient,
  expirePassportCheckoutSession,
  getStripePassportConfig,
  isPassportSessionBoundToAttempt,
  retrievePassportCheckoutSession,
} from "@/lib/server/stripePassport";
import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";

// Stripe Passport Checkout -- server boundary only. The browser never talks
// to Stripe, never reads a Passport/attempt/receipt table directly, and
// never supplies an amount, currency, Person id, tenant id, or Passport
// state. Every mutation this route can cause goes through the existing
// governed RPCs from 20261012000000/20261013000000 -- this route adds no
// database write of its own.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function jsonNoStore(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * The sole trusted origin for Stripe Checkout return URLs: one explicit
 * server-only configuration value, read at call time (never cached at
 * module load, never derived from the request's Host header,
 * X-Forwarded-Host, the request URL, or any other caller-supplied value --
 * syntax-validating a client-controlled header is not an authorization
 * decision). Returns null on anything but a strictly valid value, so the
 * caller can fail closed to the neutral "unavailable" response rather than
 * build an unsafe redirect.
 *
 * Validation: an absolute URL with no userinfo, query, or fragment, and no
 * path other than none or "/". HTTPS is required unless the host is
 * localhost/127.0.0.1, in which case HTTP is accepted for local development
 * only.
 */
function trustedAppOrigin(): string | null {
  const raw = process.env.EPICENTRAX_APP_ORIGIN;

  if (!raw) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.username || url.password || url.search || url.hash) {
    return null;
  }

  if (url.pathname !== "" && url.pathname !== "/") {
    return null;
  }

  const isLocalHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";

  if (url.protocol !== "https:" && !(isLocalHost && url.protocol === "http:")) {
    return null;
  }

  return url.origin;
}

async function requireAuthenticatedEventRequest(request: Request) {
  const authResolution = await resolveAuthenticatedRequest(request.headers);

  if (authResolution.state === "internal_error") {
    return { ok: false as const, response: jsonNoStore({ error: "internal_error" }, 500) };
  }

  if (authResolution.state !== "authenticated") {
    return { ok: false as const, response: jsonNoStore({ error: "unauthenticated" }, 401) };
  }

  const supabase = createAuthenticatedUserClient(authResolution.credential);

  if (!supabase) {
    return { ok: false as const, response: jsonNoStore({ error: "internal_error" }, 500) };
  }

  return { ok: true as const, supabase };
}

function eventIdFromUrl(request: Request): string | null {
  const url = new URL(request.url);
  const eventId = url.searchParams.get("eventId");
  return isUuid(eventId) ? eventId : null;
}

/**
 * Best-effort governed cleanup after a provider-side failure leaves an
 * attempt behind with no usable session: records it 'expired' through the
 * service-only terminal-state RPC so a later attempt remains possible. A
 * failure here is logged only -- the caller still reports the original
 * failure to the browser, and never claims success.
 */
async function bestEffortExpireAttempt(attemptId: string, sessionId: string | null) {
  const admin = getSupabaseAdminClient();

  if (!admin) {
    return;
  }

  try {
    await admin.rpc("record_self_service_event_passport_checkout_terminal_state", {
      p_attempt_id: attemptId,
      p_provider_session_id: sessionId,
      p_terminal_state: "expired",
    });
  } catch (cleanupError) {
    console.error("Best-effort Passport attempt cleanup failed.", cleanupError);
  }
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedEventRequest(request);

  if (!auth.ok) {
    return auth.response;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "invalid_request" }, 400);
  }

  const eventId =
    body && typeof body === "object" && "eventId" in body
      ? (body as { eventId?: unknown }).eventId
      : undefined;

  if (!isUuid(eventId)) {
    return jsonNoStore({ error: "invalid_request" }, 400);
  }

  const config = getStripePassportConfig();
  const origin = trustedAppOrigin();

  // Both are neutral "unavailable" -- never identifying which one is
  // missing or invalid.
  if (!config || !origin) {
    return jsonNoStore({ error: "checkout_unavailable" }, 503);
  }

  const { data: prepared, error: prepareError } = await auth.supabase.rpc(
    "prepare_self_service_event_passport_checkout_attempt",
    {
      p_event_id: eventId,
      p_idempotency_key: crypto.randomUUID(),
    },
  );

  if (prepareError) {
    if (prepareError.message === "Event not found.") {
      return jsonNoStore({ error: "event_not_found" }, 404);
    }
    return jsonNoStore({ error: "checkout_failed" }, 400);
  }

  const row = Array.isArray(prepared) ? prepared[0] : prepared;

  if (!row || typeof row !== "object") {
    return jsonNoStore({ error: "checkout_failed" }, 500);
  }

  const { attempt_id: attemptId, state } = row as {
    outcome: string;
    attempt_id: string;
    event_id: string;
    state: string;
  };

  const admin = getSupabaseAdminClient();

  if (!admin) {
    return jsonNoStore({ error: "internal_error" }, 500);
  }

  const stripe = createStripePassportClient(config);
  const returnUrl = `${origin}/organize/${encodeURIComponent(eventId)}?passport_return=1`;

  if (state === "open") {
    // An open attempt already exists -- resume it. The provider session id
    // is read only through the service-only reader, never queried directly.
    const { data: serverRow, error: serverReadError } = await admin.rpc(
      "get_self_service_event_passport_checkout_attempt_for_server",
      { p_attempt_id: attemptId },
    );
    const serverAttempt = Array.isArray(serverRow) ? serverRow[0] : serverRow;

    if (serverReadError || !serverAttempt?.provider_session_id) {
      return jsonNoStore({ error: "checkout_failed" }, 500);
    }

    try {
      const session = await retrievePassportCheckoutSession(
        stripe,
        serverAttempt.provider_session_id,
      );

      if (!isPassportSessionBoundToAttempt(session, { attemptId, eventId })) {
        return jsonNoStore({ error: "checkout_failed" }, 500);
      }

      if (!session.url) {
        return jsonNoStore({ error: "checkout_failed" }, 500);
      }

      return jsonNoStore({ url: session.url });
    } catch (stripeError) {
      console.error("Passport checkout session retrieval failed.", stripeError);
      return jsonNoStore({ error: "checkout_failed" }, 502);
    }
  }

  // state === "preparing": either a fresh attempt or an existing one that
  // never got a provider session bound. Create exactly one Checkout Session
  // and bind it through the service-only bind RPC.
  let session;

  try {
    session = await createPassportCheckoutSession(stripe, {
      priceId: config.priceId,
      attemptId,
      eventId,
      successUrl: returnUrl,
      cancelUrl: returnUrl,
    });
  } catch (stripeError) {
    console.error("Passport Checkout Session creation failed.", stripeError);
    await bestEffortExpireAttempt(attemptId, null);
    return jsonNoStore({ error: "checkout_failed" }, 502);
  }

  if (!isPassportSessionBoundToAttempt(session, { attemptId, eventId }) || !session.url) {
    await bestEffortExpireAttempt(attemptId, session.id);
    return jsonNoStore({ error: "checkout_failed" }, 500);
  }

  const { error: bindError } = await admin.rpc(
    "bind_self_service_event_passport_checkout_session",
    {
      p_attempt_id: attemptId,
      p_provider_session_id: session.id,
    },
  );

  if (bindError) {
    await bestEffortExpireAttempt(attemptId, session.id);
    return jsonNoStore({ error: "checkout_failed" }, 500);
  }

  return jsonNoStore({ url: session.url });
}

export async function GET(request: Request) {
  const auth = await requireAuthenticatedEventRequest(request);

  if (!auth.ok) {
    return auth.response;
  }

  const eventId = eventIdFromUrl(request);

  if (!eventId) {
    return jsonNoStore({ error: "invalid_request" }, 400);
  }

  const { data, error } = await auth.supabase.rpc(
    "get_my_self_service_event_passport_checkout_attempt",
    { p_event_id: eventId },
  );

  if (error) {
    if (error.message === "Event not found.") {
      return jsonNoStore({ error: "event_not_found" }, 404);
    }
    return jsonNoStore({ error: "checkout_failed" }, 400);
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row || typeof row !== "object") {
    return jsonNoStore({ error: "checkout_failed" }, 500);
  }

  const { outcome, attempt_id: attemptId, state } = row as {
    outcome: string;
    attempt_id: string | null;
    state: string | null;
  };

  if (outcome === "no_open_attempt") {
    // No open/preparing attempt -- but that alone does not distinguish
    // "never started a checkout" from "already paid; Passport confirmed"
    // (get_my_self_service_event_passport_checkout_attempt deliberately
    // reports the SAME 'no_open_attempt' outcome for both). The narrowly
    // scoped confirmation reader answers exactly that remaining question --
    // invoked ONLY for this exact, well-formed outcome, never as a catch-all
    // for anything else this reader could return.
    const { data: confirmationData, error: confirmationError } = await auth.supabase.rpc(
      "get_my_self_service_event_passport_confirmation",
      { p_event_id: eventId },
    );

    if (confirmationError) {
      if (confirmationError.message === "Event not found.") {
        return jsonNoStore({ error: "event_not_found" }, 404);
      }
      return jsonNoStore({ error: "checkout_failed" }, 400);
    }

    const confirmationRow = Array.isArray(confirmationData) ? confirmationData[0] : confirmationData;

    if ((confirmationRow as { outcome?: string } | null)?.outcome === "confirmed") {
      return jsonNoStore({ status: "confirmed" });
    }

    return jsonNoStore({ status: "no_open_attempt" });
  }

  if (outcome !== "open_attempt" || !attemptId) {
    // Any other outcome -- including a malformed 'open_attempt' with no
    // attempt id -- fails closed to the same safe status this route always
    // returned for it, WITHOUT ever invoking the confirmation reader.
    return jsonNoStore({ status: "no_open_attempt" });
  }

  if (state !== "open") {
    return jsonNoStore({ status: "open_attempt", state: "preparing" });
  }

  const admin = getSupabaseAdminClient();
  const config = getStripePassportConfig();

  if (!admin || !config) {
    // The attempt exists, but we cannot safely fetch its hosted URL right
    // now -- report the safe minimal status without a URL rather than fail.
    return jsonNoStore({ status: "open_attempt", state: "open" });
  }

  const { data: serverRow } = await admin.rpc(
    "get_self_service_event_passport_checkout_attempt_for_server",
    { p_attempt_id: attemptId },
  );
  const serverAttempt = Array.isArray(serverRow) ? serverRow[0] : serverRow;

  if (!serverAttempt?.provider_session_id) {
    return jsonNoStore({ status: "open_attempt", state: "open" });
  }

  try {
    const stripe = createStripePassportClient(config);
    const session = await retrievePassportCheckoutSession(
      stripe,
      serverAttempt.provider_session_id,
    );

    if (!isPassportSessionBoundToAttempt(session, { attemptId, eventId }) || !session.url) {
      return jsonNoStore({ status: "open_attempt", state: "open" });
    }

    return jsonNoStore({ status: "open_attempt", state: "open", url: session.url });
  } catch (stripeError) {
    console.error("Passport checkout session status retrieval failed.", stripeError);
    return jsonNoStore({ status: "open_attempt", state: "open" });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAuthenticatedEventRequest(request);

  if (!auth.ok) {
    return auth.response;
  }

  const eventId = eventIdFromUrl(request);

  if (!eventId) {
    return jsonNoStore({ error: "invalid_request" }, 400);
  }

  // Owner access is proved through the authenticated reader FIRST -- before
  // any service-only or provider action.
  const { data, error } = await auth.supabase.rpc(
    "get_my_self_service_event_passport_checkout_attempt",
    { p_event_id: eventId },
  );

  if (error) {
    if (error.message === "Event not found.") {
      return jsonNoStore({ error: "event_not_found" }, 404);
    }
    return jsonNoStore({ error: "checkout_failed" }, 400);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const { outcome, attempt_id: attemptId, state } = (row ?? {}) as {
    outcome?: string;
    attempt_id?: string | null;
    state?: string | null;
  };

  if (outcome !== "open_attempt" || !attemptId) {
    return jsonNoStore({ status: "no_open_attempt" });
  }

  const admin = getSupabaseAdminClient();
  const config = getStripePassportConfig();

  if (!admin || !config) {
    return jsonNoStore({ error: "checkout_unavailable" }, 503);
  }

  if (state !== "open") {
    // Never bound to a provider session -- nothing to expire at Stripe.
    const { error: terminalError } = await admin.rpc(
      "record_self_service_event_passport_checkout_terminal_state",
      {
        p_attempt_id: attemptId,
        p_provider_session_id: null,
        p_terminal_state: "expired",
      },
    );

    if (terminalError) {
      return jsonNoStore({ error: "checkout_failed" }, 500);
    }

    return jsonNoStore({ status: "expired" });
  }

  const { data: serverRow, error: serverReadError } = await admin.rpc(
    "get_self_service_event_passport_checkout_attempt_for_server",
    { p_attempt_id: attemptId },
  );
  const serverAttempt = Array.isArray(serverRow) ? serverRow[0] : serverRow;

  if (serverReadError || !serverAttempt?.provider_session_id) {
    return jsonNoStore({ error: "checkout_failed" }, 500);
  }

  const stripe = createStripePassportClient(config);

  try {
    const session = await retrievePassportCheckoutSession(
      stripe,
      serverAttempt.provider_session_id,
    );

    if (!isPassportSessionBoundToAttempt(session, { attemptId, eventId })) {
      return jsonNoStore({ error: "checkout_failed" }, 500);
    }

    // Completion/expiry race: if Stripe already shows the session complete
    // or paid, the browser's expire request must never win -- the payment
    // stands, the Event is preserved, and the webhook (in flight or about
    // to arrive) is the only path that may confirm it.
    if (session.status === "complete" || session.payment_status === "paid") {
      return jsonNoStore({ status: "payment_completing" });
    }

    await expirePassportCheckoutSession(stripe, serverAttempt.provider_session_id);
  } catch (stripeError) {
    console.error("Passport checkout session expiry failed.", stripeError);
    return jsonNoStore({ error: "checkout_failed" }, 502);
  }

  const { error: terminalError } = await admin.rpc(
    "record_self_service_event_passport_checkout_terminal_state",
    {
      p_attempt_id: attemptId,
      p_provider_session_id: serverAttempt.provider_session_id,
      p_terminal_state: "expired",
    },
  );

  if (terminalError) {
    return jsonNoStore({ error: "checkout_failed" }, 500);
  }

  return jsonNoStore({ status: "expired" });
}
