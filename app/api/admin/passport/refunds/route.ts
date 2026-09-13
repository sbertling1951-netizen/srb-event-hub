import { NextResponse } from "next/server";

import { createAuthenticatedUserClient } from "@/lib/server/authenticatedUserClient";
import { resolveAuthenticatedRequest } from "@/lib/server/authenticationBoundary";
import {
  createPassportRefund,
  createStripePassportClient,
  getStripePassportConfig,
  isStripeTestMode,
  retrievePassportCheckoutSession,
  verifyPassportCheckoutSessionFacts,
} from "@/lib/server/stripePassport";
import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const resolved = await resolveAuthenticatedRequest(request.headers);
  if (resolved.state !== "authenticated") return reply({ error: "unauthenticated" }, 401);
  const user = createAuthenticatedUserClient(resolved.credential);
  if (!user) return reply({ error: "internal_error" }, 500);
  let requestId: unknown;
  try { requestId = (await request.json() as { requestId?: unknown }).requestId; } catch { return reply({ error: "invalid_request" }, 400); }
  if (typeof requestId !== "string" || !UUID.test(requestId)) return reply({ error: "invalid_request" }, 400);
  const { error: authorityError } = await user.rpc("assert_self_service_event_passport_refund_request_authority", { p_request_id: requestId });
  if (authorityError) return reply({ error: "not_found" }, 404);
  const config = getStripePassportConfig();
  const admin = getSupabaseAdminClient();
  if (!config || !admin || !isStripeTestMode(config)) return reply({ error: "refund_unavailable" }, 503);
  const { data } = await admin.rpc("get_self_service_event_passport_refund_context_for_server", { p_request_id: requestId });
  const context = Array.isArray(data) ? data[0] : data;
  if (!context || context.state !== "requested") return reply({ error: "not_found" }, 404);
  try {
    const stripe = createStripePassportClient(config);
    const session = await retrievePassportCheckoutSession(stripe, context.provider_session_id);
    if (!verifyPassportCheckoutSessionFacts(session, { priceId: config.priceId, attemptId: context.attempt_id, eventId: context.event_id }).ok) return reply({ error: "refund_unavailable" }, 409);
    const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!paymentIntent) return reply({ error: "refund_unavailable" }, 409);
    await createPassportRefund(stripe, { paymentIntentId: paymentIntent, requestId });
    return reply({ status: "refund_pending" });
  } catch (error) {
    console.error("Passport refund creation failed.", error);
    return reply({ error: "refund_unavailable" }, 502);
  }
}
