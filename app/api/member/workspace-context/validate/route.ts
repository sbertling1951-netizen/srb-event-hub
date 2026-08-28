import { NextResponse } from "next/server";

import { resolveEstablishedMemberEventContext } from "@/lib/server/workspaceContextResolver";

type ValidateRequestBody = {
  eventId?: unknown;
};

function requestBody(value: unknown): ValidateRequestBody {
  return value && typeof value === "object" ? (value as ValidateRequestBody) : {};
}

/**
 * Live authority (not shadow/diagnostic) for "is this one persisted Event
 * still a valid established Member workspace." Distinct from this same
 * directory's sibling route, which remains a comparison-only diagnostic for
 * discovery/enumeration and does not answer this question.
 *
 * Requires an Authorization bearer -- an unauthenticated caller (Temporary
 * Event Access, or no session at all) always resolves to "unauthenticated"
 * here rather than being evaluated, since Temporary Access carries no
 * durable Person link and continues to re-derive its own authority through
 * resolve_temporary_or_authenticated_attendee's unauthenticated branch.
 */
export async function POST(request: Request) {
  let body: ValidateRequestBody = {};

  try {
    body = requestBody(await request.json());
  } catch {
    // A missing/malformed body carries no Event id -- treated as no_context
    // below, exactly as an absent field would be.
  }

  const eventId = typeof body.eventId === "string" ? body.eventId : null;
  const result = await resolveEstablishedMemberEventContext(
    request.headers,
    eventId,
  );

  return NextResponse.json(result);
}
