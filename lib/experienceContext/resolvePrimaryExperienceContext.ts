import type {
  NormalizedAgendaItem,
  PrimaryExperienceSignal,
  SharedExperienceContext,
} from "@/lib/experienceContext/types";

// Deterministic, explainable, Stage 1 priority rules only. This resolver
// fetches nothing -- it consumes an already-collected SharedExperienceContext
// and never itself constitutes Authority, Assignment, Participation,
// Relationship, or Identity. See
// docs/architecture/EPICENTRAX_SHARED_EXPERIENCE_CONTEXT_ARCHITECTURE.md.
//
// Priority order (unchanged from Stage 1; verified against
// EPICENTRAX_EXPERIENCE_INTELLIGENCE_ARCHITECTURE.md's Current-Rule
// Migration Map, which documents this exact sequence -- over-capacity,
// vacant slot, active Assignments, open vendor requests, current agenda
// item, next agenda item, fallback -- as the architecture-approved order,
// derived directly from this file. Nothing here reorders it.
//
// Evidence Quality gate: a Provider-owned slice's primary field (a count,
// an item) is trusted only when that slice's own evidenceQuality is
// "governed" -- the only value any current Provider produces on a
// successful collection. This is a defense-in-depth guard, not a
// behavior change: every non-"governed" value a Provider can currently
// produce (assignments' "partial" for identity_unavailable, and the
// canonical "unavailable" base default for any Provider failure) is
// always paired with a null primary field already, so the pre-existing
// `typeof x === "number"` / truthy checks below already failed closed on
// every case that reaches this resolver today. Making the check explicit
// closes that coincidence structurally, per
// EPICENTRAX_EXPERIENCE_INTELLIGENCE_ARCHITECTURE.md's Null/Unknown/
// Failure Semantics table ("partial must not be silently treated as
// equivalent to governed"), without altering any currently observable
// outcome. `member` carries no evidenceQuality -- it is caller-supplied
// base context, not a Provider slice (see the Intelligence Collector
// audit's own finding on this), so the capacity rules below have nothing
// to gate on beyond the existing null check already present in their
// condition.
//
// observedAt is deliberately NOT consulted for a staleness rule: no
// per-slice staleness threshold is defined anywhere in governing
// architecture ("Exact per-slice freshness thresholds are each
// Provider's own domain concern and are not fixed by this document").
// Inventing one here would fabricate a threshold no accepted document
// supplies.

function formatAgendaItemTime(item: NormalizedAgendaItem): string | null {
  if (!item.agendaDate || !item.startTime) {
    return null;
  }

  const start = new Date(`${item.agendaDate}T${item.startTime}`);
  if (Number.isNaN(start.getTime())) {
    return null;
  }

  return start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function describeCurrentAgendaItem(item: NormalizedAgendaItem): PrimaryExperienceSignal {
  const title = item.title || "Agenda item";
  const time = formatAgendaItemTime(item);

  return {
    kind: "information",
    title: `Now: ${title}`,
    summary: time
      ? `Happening now, started ${time}.`
      : "Happening now.",
    destination: "/member/agenda",
    sourceSlice: "agenda",
    reason: "agenda.currentItem is present under governed evidence quality",
  };
}

function describeNextAgendaItem(item: NormalizedAgendaItem): PrimaryExperienceSignal {
  const title = item.title || "Agenda item";
  const time = formatAgendaItemTime(item);

  return {
    kind: "reminder",
    title: `Next: ${title}`,
    summary: time ? `Starts at ${time}.` : "Coming up next.",
    destination: "/member/agenda",
    sourceSlice: "agenda",
    reason:
      "agenda.nextItem is present under governed evidence quality (no current item)",
  };
}

// Not an interpretation of any Pool fact -- the Member Experience
// Resolver's own policy for "nothing else applied" (see
// EPICENTRAX_EXPERIENCE_INTELLIGENCE_ARCHITECTURE.md, "Fallback is not
// migrated into an interpreter"). sourceSlice is null accordingly.
const FALLBACK_SIGNAL: PrimaryExperienceSignal = {
  kind: "information",
  title: "Open today's agenda",
  summary: "See the next scheduled activity and everything coming up today.",
  destination: "/member/agenda",
  sourceSlice: null,
  reason: "no eligible signal from any higher-priority rule; resolver-owned default",
};

// assignments.activeCount is a governed fact -- a Responsibility has been
// assigned to this Person for this Event -- never Authority. This card
// only informs; it does not itself grant, imply, or route into any
// privileged workflow. destination points to app/member/my-assignments,
// the governed, read-only page where a Person may review their own
// Assignments; it unlocks nothing beyond what this reminder already
// states. See
// docs/architecture/EPICENTRAX_MEMBER_ASSIGNMENT_READ_BOUNDARY_ARCHITECTURE.md
// ("Avoiding Assignment-as-Authority").
function describeActiveAssignments(activeCount: number): PrimaryExperienceSignal {
  return {
    kind: "reminder",
    title:
      activeCount === 1
        ? "You have an active event duty"
        : `You have ${activeCount} active event duties`,
    summary:
      activeCount === 1
        ? "A Responsibility has been assigned to you for this event."
        : "Responsibilities have been assigned to you for this event.",
    destination: "/member/my-assignments",
    sourceSlice: "assignments",
    reason: "assignments.activeCount > 0 under governed evidence quality",
  };
}

// vendorRequests.openCount is a governed fact -- one or more vendor
// requests this Person submitted are still open (not completed or
// cancelled) -- never proof that the member, or the vendor, owes the next
// action. This card only informs. destination is the existing governed
// "My Requests" page (app/member/my-requests/page.tsx), since a member can
// already review their own requests there.
function describeOpenVendorRequests(openCount: number): PrimaryExperienceSignal {
  return {
    kind: "reminder",
    title:
      openCount === 1
        ? "You have an open vendor request"
        : `You have ${openCount} open vendor requests`,
    summary:
      openCount === 1
        ? "A vendor request you submitted is still open."
        : "Vendor requests you submitted are still open.",
    destination: "/member/my-requests",
    sourceSlice: "vendorRequests",
    reason: "vendorRequests.openCount > 0 under governed evidence quality",
  };
}

export function resolvePrimaryExperienceContext(
  context: SharedExperienceContext,
): PrimaryExperienceSignal {
  const { member, agenda, assignments, vendorRequests } = context;

  const hasKnownCapacity = typeof member.participantCapacity === "number";
  const isOverCapacity =
    hasKnownCapacity &&
    member.participantCount > (member.participantCapacity as number);
  const hasVacantSlot =
    hasKnownCapacity &&
    member.participantCount < (member.participantCapacity as number);

  if (isOverCapacity) {
    return {
      kind: "attention",
      title: "Participant roster exceeds capacity",
      summary:
        "Your participant roster exceeds your authorized capacity. Administrator review required.",
      destination: "/member/participants",
      sourceSlice: "member",
      reason: "member.participantCount > member.participantCapacity",
    };
  }

  if (hasVacantSlot) {
    return {
      kind: "action",
      title: "Add a participant",
      summary: "You have an available participant slot on your registration.",
      destination: "/member/participants",
      sourceSlice: "member",
      reason: "member.participantCount < member.participantCapacity",
    };
  }

  if (
    assignments.evidenceQuality === "governed" &&
    typeof assignments.activeCount === "number" &&
    assignments.activeCount > 0
  ) {
    return describeActiveAssignments(assignments.activeCount);
  }

  // Whether an open vendor request currently requires the member's own
  // action remains undeterminable from the governed read model (only a
  // status count is available, not a per-request "who owes the next
  // step" signal). This tier states only that open requests exist.
  if (
    vendorRequests.evidenceQuality === "governed" &&
    typeof vendorRequests.openCount === "number" &&
    vendorRequests.openCount > 0
  ) {
    return describeOpenVendorRequests(vendorRequests.openCount);
  }

  if (agenda.evidenceQuality === "governed" && agenda.currentItem) {
    return describeCurrentAgendaItem(agenda.currentItem);
  }

  if (agenda.evidenceQuality === "governed" && agenda.nextItem) {
    return describeNextAgendaItem(agenda.nextItem);
  }

  return FALLBACK_SIGNAL;
}
