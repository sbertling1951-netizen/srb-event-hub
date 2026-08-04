import "server-only";

import { createAuthenticatedUserClient } from "@/lib/server/authenticatedUserClient";
import { resolveAuthenticatedRequest } from "@/lib/server/authenticationBoundary";
import { resolveAuthenticatedAccountPerson } from "@/lib/server/personResolutionBridge";
import { resolveTenantFromHeaders } from "@/lib/server/tenantResolver";
import {
  type TenantContext,
  type TenantPresentation,
  type TenantResolutionReason,
  toTenantPresentation,
} from "@/lib/tenantContext";

export type WorkspaceContextResolutionState =
  | "resolved"
  | "unauthenticated"
  | "needs_person_resolution"
  | "ambiguous_person"
  | "needs_event_selection"
  | "invalid_event_selection"
  | "no_participation"
  | "error";

export type WorkspaceContextReasonCode =
  | "tenant_missing_hostname"
  | "tenant_invalid_hostname"
  | "tenant_unknown_hostname"
  | "tenant_inactive_mapping"
  | "tenant_conflicting_mapping"
  | "tenant_inactive"
  | "tenant_internal_error"
  | "unauthenticated_request"
  | "person_link_missing"
  | "person_link_invalid_or_ambiguous"
  | "no_tenant_scoped_participation"
  | "multiple_eligible_events"
  | "single_eligible_event"
  | "validated_event_hint"
  | "invalid_event_hint"
  | "malformed_event_hint"
  | "event_hint_not_eligible"
  | "event_hint_not_tenant_scoped"
  | "participation_resolution_failed"
  | "event_validation_failed";

export type WorkspaceEventCandidate = {
  id: string;
  name: string | null;
  venueName: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
};

export type WorkspaceContext = {
  resolutionState: WorkspaceContextResolutionState;
  tenant: TenantContext | null;
  person: { id: string } | null;
  account: { status: "authenticated" } | { status: "unauthenticated" };
  eligibleEvents: WorkspaceEventCandidate[];
  selectedEvent: WorkspaceEventCandidate | null;
  branding: TenantPresentation | null;
  reasons: WorkspaceContextReasonCode[];
};

/**
 * The route boundary preserves whether a browser made no Event claim, made an
 * explicit no-selection claim, made a string claim, or sent malformed input.
 * Only the string form reaches UUID and eligibility validation.
 */
export type WorkspaceEventHint =
  | { kind: "absent" }
  | { kind: "no_selection" }
  | { kind: "claimed"; value: string }
  | { kind: "malformed" };

type MemberRegistrationRow = {
  event_id?: unknown;
  event_name?: unknown;
  venue_name?: unknown;
  location?: unknown;
  start_date?: unknown;
  end_date?: unknown;
};

type TenantOwnedEventRow = { id: unknown };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function tenantReasonCode(reason: TenantResolutionReason): WorkspaceContextReasonCode {
  const reasons: Record<TenantResolutionReason, WorkspaceContextReasonCode> = {
    missing_hostname: "tenant_missing_hostname",
    invalid_hostname: "tenant_invalid_hostname",
    unknown_hostname: "tenant_unknown_hostname",
    inactive_mapping: "tenant_inactive_mapping",
    conflicting_mapping: "tenant_conflicting_mapping",
    inactive_tenant: "tenant_inactive",
    internal_error: "tenant_internal_error",
  };

  return reasons[reason];
}

function unresolvedContext(params: {
  resolutionState: WorkspaceContextResolutionState;
  tenant?: TenantContext | null;
  account?: WorkspaceContext["account"];
  person?: WorkspaceContext["person"];
  reasons: WorkspaceContextReasonCode[];
}): WorkspaceContext {
  return {
    resolutionState: params.resolutionState,
    tenant: params.tenant ?? null,
    person: params.person ?? null,
    account: params.account ?? { status: "unauthenticated" },
    eligibleEvents: [],
    selectedEvent: null,
    branding: toTenantPresentation(params.tenant ?? null),
    reasons: params.reasons,
  };
}

/**
 * Resolves only the facts needed by the first Workspace Context foundation.
 * It consumes governed Tenant, Account, exact Person-link, and member
 * participation facts. It does not derive Relationship, Assignment,
 * Responsibility, Authority, a Workspace, or an allowed action.
 *
 * `eventHint` is a browser claim, never authority. It is retained only when
 * the server independently confirms it is both Tenant-owned and one of this
 * Person's current eligible participation candidates.
 */
export async function resolveWorkspaceContext(
  requestHeaders: Headers,
  eventHint: WorkspaceEventHint = { kind: "absent" },
): Promise<WorkspaceContext> {
  const tenantResolution = await resolveTenantFromHeaders(requestHeaders);

  if (tenantResolution.state === "unresolved") {
    return unresolvedContext({
      resolutionState: "error",
      reasons: [tenantReasonCode(tenantResolution.reason)],
    });
  }

  const tenant = tenantResolution.tenant;
  const accountResolution = await resolveAuthenticatedRequest(requestHeaders);

  if (accountResolution.state === "unauthenticated") {
    return unresolvedContext({
      resolutionState: "unauthenticated",
      tenant,
      reasons: ["unauthenticated_request"],
    });
  }

  if (accountResolution.state === "internal_error") {
    return unresolvedContext({
      resolutionState: "error",
      tenant,
      reasons: ["participation_resolution_failed"],
    });
  }

  const account: WorkspaceContext["account"] = {
    status: "authenticated",
  };
  const personResolution = await resolveAuthenticatedAccountPerson(
    accountResolution,
  );

  if (personResolution.state === "no_person") {
    return unresolvedContext({
      resolutionState: "needs_person_resolution",
      tenant,
      account,
      reasons: ["person_link_missing"],
    });
  }

  if (personResolution.state === "invalid_or_ambiguous") {
    return unresolvedContext({
      resolutionState: "ambiguous_person",
      tenant,
      account,
      reasons: ["person_link_invalid_or_ambiguous"],
    });
  }

  if (personResolution.state === "internal_error") {
    return unresolvedContext({
      resolutionState: "error",
      tenant,
      account,
      reasons: ["participation_resolution_failed"],
    });
  }

  const person = { id: personResolution.personId };

  if (eventHint.kind === "malformed") {
    return unresolvedContext({
      resolutionState: "invalid_event_selection",
      tenant,
      account,
      person,
      reasons: ["malformed_event_hint"],
    });
  }

  const supabase = createAuthenticatedUserClient(accountResolution.credential);

  if (!supabase) {
    return unresolvedContext({
      resolutionState: "error",
      tenant,
      account,
      person,
      reasons: ["participation_resolution_failed"],
    });
  }

  const { data: registrations, error: registrationsError } = await supabase.rpc(
    "resolve_member_account",
  );

  if (registrationsError || !Array.isArray(registrations)) {
    return unresolvedContext({
      resolutionState: "error",
      tenant,
      account,
      person,
      reasons: ["participation_resolution_failed"],
    });
  }

  const candidatesById = new Map<string, WorkspaceEventCandidate>();

  for (const registration of registrations as MemberRegistrationRow[]) {
    if (!isUuid(registration.event_id) || candidatesById.has(registration.event_id)) {
      continue;
    }

    candidatesById.set(registration.event_id, {
      id: registration.event_id,
      name: nullableString(registration.event_name),
      venueName: nullableString(registration.venue_name),
      location: nullableString(registration.location),
      startDate: nullableString(registration.start_date),
      endDate: nullableString(registration.end_date),
    });
  }

  const participationEventIds = [...candidatesById.keys()];

  if (participationEventIds.length === 0) {
    return unresolvedContext({
      resolutionState: "no_participation",
      tenant,
      account,
      person,
      reasons: ["no_tenant_scoped_participation"],
    });
  }

  // The authenticated RPC establishes participation eligibility. This query
  // only verifies the separately governed Event -> Tenant ownership fact.
  const claimedEventHint = eventHint.kind === "claimed" ? eventHint.value : null;
  const validEventHint = isUuid(claimedEventHint) ? claimedEventHint : null;
  const eventIdsToValidate = validEventHint
    ? [...new Set([...participationEventIds, validEventHint])]
    : participationEventIds;
  const { data: tenantEvents, error: tenantEventsError } = await supabase
    .from("events")
    .select("id")
    .in("id", eventIdsToValidate)
    .eq("tenant_id", tenant.id);

  if (tenantEventsError || !Array.isArray(tenantEvents)) {
    return unresolvedContext({
      resolutionState: "error",
      tenant,
      account,
      person,
      reasons: ["event_validation_failed"],
    });
  }

  const tenantEventIds = new Set(
    (tenantEvents as TenantOwnedEventRow[])
      .map((event) => event.id)
      .filter(isUuid),
  );
  const eligibleEvents = participationEventIds
    .filter((eventId) => tenantEventIds.has(eventId))
    .map((eventId) => candidatesById.get(eventId))
    .filter((event): event is WorkspaceEventCandidate => Boolean(event));

  if (eventHint.kind === "claimed") {
    if (!isUuid(eventHint.value)) {
      return {
        ...unresolvedContext({
          resolutionState: "invalid_event_selection",
          tenant,
          account,
          person,
          reasons: ["invalid_event_hint"],
        }),
        eligibleEvents,
      };
    }

    if (!tenantEventIds.has(eventHint.value)) {
      return {
        ...unresolvedContext({
          resolutionState: "invalid_event_selection",
          tenant,
          account,
          person,
          reasons: ["event_hint_not_tenant_scoped"],
        }),
        eligibleEvents,
      };
    }

    const selectedEvent = candidatesById.get(eventHint.value) || null;

    if (!selectedEvent) {
      return {
        ...unresolvedContext({
          resolutionState: "invalid_event_selection",
          tenant,
          account,
          person,
          reasons: ["event_hint_not_eligible"],
        }),
        eligibleEvents,
      };
    }

    return {
      resolutionState: "resolved",
      tenant,
      person,
      account,
      eligibleEvents,
      selectedEvent,
      branding: toTenantPresentation(tenant),
      reasons: ["validated_event_hint"],
    };
  }

  if (eligibleEvents.length === 0) {
    return unresolvedContext({
      resolutionState: "no_participation",
      tenant,
      account,
      person,
      reasons: ["no_tenant_scoped_participation"],
    });
  }

  if (eligibleEvents.length > 1) {
    return {
      ...unresolvedContext({
        resolutionState: "needs_event_selection",
        tenant,
        account,
        person,
        reasons: ["multiple_eligible_events"],
      }),
      eligibleEvents,
    };
  }

  return {
    resolutionState: "resolved",
    tenant,
    person,
    account,
    eligibleEvents,
    selectedEvent: eligibleEvents[0],
    branding: toTenantPresentation(tenant),
    reasons: ["single_eligible_event"],
  };
}

export type WorkspaceContextShadowComparison = {
  legacy: { eligibleEventIds: string[] };
  resolver: {
    resolutionState: WorkspaceContextResolutionState;
    eligibleEventIds: string[];
    selectedEventId: string | null;
  };
  comparison: {
    result: "match" | "mismatch";
    reasonCode: "candidate_sets_match" | "candidate_set_mismatch";
  };
};

/**
 * Comparison-only support for the first shadow consumer. Browser-provided
 * legacy IDs are never used by resolveWorkspaceContext and cannot affect any
 * resolution decision.
 */
export function compareWorkspaceContextShadow(
  legacyEventIds: readonly string[],
  context: WorkspaceContext,
): WorkspaceContextShadowComparison {
  const legacyIds = [...new Set(legacyEventIds.filter(isUuid))].sort();
  const resolverIds = context.eligibleEvents.map((event) => event.id).sort();
  const matches =
    legacyIds.length === resolverIds.length &&
    legacyIds.every((eventId, index) => eventId === resolverIds[index]);

  return {
    legacy: { eligibleEventIds: legacyIds },
    resolver: {
      resolutionState: context.resolutionState,
      eligibleEventIds: resolverIds,
      selectedEventId: context.selectedEvent?.id ?? null,
    },
    comparison: {
      result: matches ? "match" : "mismatch",
      reasonCode: matches ? "candidate_sets_match" : "candidate_set_mismatch",
    },
  };
}
