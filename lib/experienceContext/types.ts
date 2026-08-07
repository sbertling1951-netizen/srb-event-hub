import type { CurrentMemberEvent } from "@/lib/getCurrentMemberEvent";

// See docs/architecture/EPICENTRAX_SHARED_EXPERIENCE_CONTEXT_ARCHITECTURE.md.
// This is a normalized, read-only view over already-governed facts. It owns
// no authoritative state of its own.

export type NormalizedAgendaItem = {
  id: string;
  title: string | null;
  agendaDate: string | null;
  startTime: string | null;
  endTime: string | null;
};

// See docs/architecture/EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md
// ("Evidence Quality Classification"). A deterministic, rule-based
// classification of one slice's own collection -- never a probabilistic
// or learned score, and never identity confidence (a different, governed
// concept owned elsewhere). Reported by a Provider on its own slice.
export type SliceEvidenceQuality =
  | "governed"
  | "external"
  | "partial"
  | "stale"
  | "unavailable";

export type SharedExperienceContext = {
  generatedAt: string;
  event: {
    id: string;
    name: string | null;
    location: string | null;
    startDate: string | null;
    endDate: string | null;
    dayNumber: number | null;
    // No authoritative event-phase source exists yet; always null in
    // Stage 1. See the architecture document's "Optional slices
    // unavailable in Stage 1" section.
    phase: string | null;
  };
  member: {
    attendeeId: string | null;
    participantCapacity: number | null;
    participantCount: number;
    checkedIn: boolean | null;
  };
  agenda: {
    currentItem: NormalizedAgendaItem | null;
    nextItem: NormalizedAgendaItem | null;
    evidenceQuality: SliceEvidenceQuality;
    // See docs/architecture/EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md
    // ("Freshness"): "every slice the Collector places in the Pool
    // carries its own observed-at timestamp." null means nothing was
    // actually observed this pass (Provider unavailable or not yet run)
    // -- never a fabricated observation time. This is deliberately a
    // separate fact from evidenceQuality: no staleness threshold is
    // computed from it here, or anywhere in this Provider -- judging
    // whether an age is acceptable is explicitly left to the Resolver
    // or consumer, per the same architecture section.
    observedAt: string | null;
  };
  announcements: {
    // null means "unavailable" (source not queried or the optional fetch
    // failed) -- never conflate with a governed-confirmed zero.
    activeCount: number | null;
    evidenceQuality: SliceEvidenceQuality;
    // See docs/architecture/EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md
    // ("Freshness"). null means nothing was actually observed this pass
    // -- never a fabricated observation time. Deliberately independent
    // of evidenceQuality; no staleness threshold is computed from it.
    observedAt: string | null;
  };
  assignments: {
    // null means unavailable -- either a genuine collection failure, or
    // the governed API's own explicit "identity_unavailable" outcome
    // (see EPICENTRAX_MEMBER_ASSIGNMENT_READ_BOUNDARY_ARCHITECTURE.md).
    // Never conflated with a governed-confirmed zero.
    activeCount: number | null;
    evidenceQuality: SliceEvidenceQuality;
    // See docs/architecture/EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md
    // ("Freshness"). null means nothing was actually observed this pass
    // -- never a fabricated observation time. Deliberately independent
    // of evidenceQuality; no staleness threshold is computed from it.
    observedAt: string | null;
  };
  vendorRequests: {
    openCount: number | null;
  };
};

export type CollectSharedExperienceContextInput = {
  // Already-resolved by the caller. The collector performs no Person,
  // Workspace, or event resolution of its own and must not be called
  // before this is available.
  event: CurrentMemberEvent;
  now: Date;
  attendeeId: string | null;
  participantCapacity: number | null;
  participantCount: number;
  checkedIn: boolean | null;
  eventCode: string | null;
  registrationIdentifier: string | null;
};

export type PrimaryExperienceContextKind =
  | "information"
  | "action"
  | "reminder"
  | "attention";

export type PrimaryExperienceContext = {
  kind: PrimaryExperienceContextKind;
  title: string;
  summary: string;
  destination: string | null;
};
