import { NextResponse } from "next/server";

import { createAuthenticatedUserClient } from "@/lib/server/authenticatedUserClient";
import { resolveAuthenticatedRequest } from "@/lib/server/authenticationBoundary";

// Prepares (or idempotently recovers) the opaque Passport refund-request
// identity /api/admin/passport/refunds needs to execute a refund. The
// browser supplies only the Event id -- never an amount, receipt, Stripe
// identifier, or role claim -- and Platform Administrator authority is
// asserted entirely inside the governed RPC
// (prepare_self_service_event_passport_refund_request), never trusted from
// this route or the caller. This route never queries a Passport, receipt,
// refund-request, or refund-audit table directly, and never talks to
// Stripe.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const resolved = await resolveAuthenticatedRequest(request.headers);
  if (resolved.state !== "authenticated") return reply({ error: "unauthenticated" }, 401);
  const user = createAuthenticatedUserClient(resolved.credential);
  if (!user) return reply({ error: "internal_error" }, 500);

  let eventId: unknown;
  try {
    eventId = (await request.json() as { eventId?: unknown }).eventId;
  } catch {
    return reply({ error: "invalid_request" }, 400);
  }
  if (typeof eventId !== "string" || !UUID.test(eventId)) return reply({ error: "invalid_request" }, 400);

  // A non-enumerating failure -- the SAME "not_found" whether the caller
  // lacks Platform Administrator authority or the Event/Passport is simply
  // ineligible, exactly mirroring the execute route's own
  // assert_self_service_event_passport_refund_request_authority discipline.
  const { data, error } = await user.rpc("prepare_self_service_event_passport_refund_request", {
    p_event_id: eventId,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) return reply({ error: "not_found" }, 404);

  const row = Array.isArray(data) ? data[0] : data;
  const requestId = row && typeof row === "object" ? (row as { request_id?: unknown }).request_id : undefined;
  if (typeof requestId !== "string") return reply({ error: "internal_error" }, 500);

  return reply({ requestId });
}
