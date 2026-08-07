import type {
  NormalizedAgendaItem,
  PrimaryExperienceContext,
  SharedExperienceContext,
} from "@/lib/experienceContext/types";

// Deterministic, explainable, Stage 1 priority rules only. This resolver
// fetches nothing -- it consumes an already-collected SharedExperienceContext
// and never itself constitutes Authority, Assignment, Participation,
// Relationship, or Identity. See
// docs/architecture/EPICENTRAX_SHARED_EXPERIENCE_CONTEXT_ARCHITECTURE.md.

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

function describeCurrentAgendaItem(item: NormalizedAgendaItem): PrimaryExperienceContext {
  const title = item.title || "Agenda item";
  const time = formatAgendaItemTime(item);

  return {
    kind: "information",
    title: `Now: ${title}`,
    summary: time
      ? `Happening now, started ${time}.`
      : "Happening now.",
    destination: "/member/agenda",
  };
}

function describeNextAgendaItem(item: NormalizedAgendaItem): PrimaryExperienceContext {
  const title = item.title || "Agenda item";
  const time = formatAgendaItemTime(item);

  return {
    kind: "reminder",
    title: `Next: ${title}`,
    summary: time ? `Starts at ${time}.` : "Coming up next.",
    destination: "/member/agenda",
  };
}

const FALLBACK_CONTEXT: PrimaryExperienceContext = {
  kind: "information",
  title: "Open today's agenda",
  summary: "See the next scheduled activity and everything coming up today.",
  destination: "/member/agenda",
};

// assignments.activeCount is a governed fact -- a Responsibility has been
// assigned to this Person for this Event -- never Authority. This card
// only informs; it does not itself grant, imply, or route into any
// privileged workflow. destination is intentionally null: no governed
// destination exists yet for a Person to review their own Assignments, and
// this resolver does not fabricate one. See
// docs/architecture/EPICENTRAX_MEMBER_ASSIGNMENT_READ_BOUNDARY_ARCHITECTURE.md
// ("Avoiding Assignment-as-Authority").
function describeActiveAssignments(activeCount: number): PrimaryExperienceContext {
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
    destination: null,
  };
}

export function resolvePrimaryExperienceContext(
  context: SharedExperienceContext,
): PrimaryExperienceContext {
  const { member, agenda, assignments } = context;

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
    };
  }

  if (hasVacantSlot) {
    return {
      kind: "action",
      title: "Add a participant",
      summary: "You have an available participant slot on your registration.",
      destination: "/member/participants",
    };
  }

  // Open-vendor-request priority tier is intentionally not implemented in
  // Stage 1: the governed read model exposes only an open-request count,
  // with no determinable "requires member action" signal per request. See
  // the architecture document's Experience Context Resolver section.

  if (typeof assignments.activeCount === "number" && assignments.activeCount > 0) {
    return describeActiveAssignments(assignments.activeCount);
  }

  if (agenda.currentItem) {
    return describeCurrentAgendaItem(agenda.currentItem);
  }

  if (agenda.nextItem) {
    return describeNextAgendaItem(agenda.nextItem);
  }

  return FALLBACK_CONTEXT;
}
