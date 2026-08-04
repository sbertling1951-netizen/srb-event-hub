import { NextResponse } from "next/server";

import {
  compareWorkspaceContextShadow,
  resolveWorkspaceContext,
  type WorkspaceEventHint,
} from "@/lib/server/workspaceContextResolver";

type ShadowRequestBody = {
  eventHint?: unknown;
  legacyEligibleEventIds?: unknown;
};

function requestBody(value: unknown): ShadowRequestBody {
  return value && typeof value === "object" ? (value as ShadowRequestBody) : {};
}

function eventHintFromBody(body: ShadowRequestBody): WorkspaceEventHint {
  if (!Object.prototype.hasOwnProperty.call(body, "eventHint")) {
    return { kind: "absent" };
  }

  if (body.eventHint === null) {
    return { kind: "no_selection" };
  }

  if (typeof body.eventHint === "string") {
    return { kind: "claimed", value: body.eventHint };
  }

  return { kind: "malformed" };
}

/**
 * A transport-only shadow endpoint for the existing Member Account page.
 * The resolver independently validates every governed fact; browser values
 * here are limited to a claimed Event hint and comparison-only legacy IDs.
 */
export async function POST(request: Request) {
  let body: ShadowRequestBody = {};

  try {
    body = requestBody(await request.json());
  } catch {
    // A missing body is equivalent to no Event hint and no comparison input.
  }

  const eventHint = eventHintFromBody(body);
  const legacyEligibleEventIds = Array.isArray(body.legacyEligibleEventIds)
    ? body.legacyEligibleEventIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const context = await resolveWorkspaceContext(request.headers, eventHint);

  return NextResponse.json({
    context,
    shadowComparison: compareWorkspaceContextShadow(
      legacyEligibleEventIds,
      context,
    ),
  });
}
