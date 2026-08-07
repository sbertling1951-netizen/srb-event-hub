import type { CurrentMemberEvent } from "@/lib/getCurrentMemberEvent";

// See docs/architecture/EPICENTRAX_SHARED_EXPERIENCE_CONTEXT_ARCHITECTURE.md.
// This is a normalized, read-only view over already-governed facts. It owns
// no authoritative state of its own.

export type NormalizedAgendaItem = {
  readonly id: string;
  readonly title: string | null;
  readonly agendaDate: string | null;
  readonly startTime: string | null;
  readonly endTime: string | null;
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

// All fields (including nested slice fields) are readonly: per
// EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md's Shared Context Pool
// definition, the Pool is "immutable once composed... nothing writes back
// into it." This is a type-level guard only, matching that stated
// discipline -- not runtime freezing, which the architecture does not
// call for and which was deliberately not added here.
export type SharedExperienceContext = {
  readonly generatedAt: string;
  readonly event: {
    readonly id: string;
    readonly name: string | null;
    readonly location: string | null;
    readonly startDate: string | null;
    readonly endDate: string | null;
    readonly dayNumber: number | null;
    // No authoritative event-phase source exists yet; always null in
    // Stage 1. See the architecture document's "Optional slices
    // unavailable in Stage 1" section.
    readonly phase: string | null;
  };
  readonly member: {
    readonly attendeeId: string | null;
    readonly participantCapacity: number | null;
    readonly participantCount: number;
    readonly checkedIn: boolean | null;
  };
  readonly agenda: {
    readonly currentItem: NormalizedAgendaItem | null;
    readonly nextItem: NormalizedAgendaItem | null;
    readonly evidenceQuality: SliceEvidenceQuality;
    // See docs/architecture/EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md
    // ("Freshness"): "every slice the Collector places in the Pool
    // carries its own observed-at timestamp." null means nothing was
    // actually observed this pass (Provider unavailable or not yet run)
    // -- never a fabricated observation time. This is deliberately a
    // separate fact from evidenceQuality: no staleness threshold is
    // computed from it here, or anywhere in this Provider -- judging
    // whether an age is acceptable is explicitly left to the Resolver
    // or consumer, per the same architecture section.
    readonly observedAt: string | null;
  };
  readonly announcements: {
    // null means "unavailable" (source not queried or the optional fetch
    // failed) -- never conflate with a governed-confirmed zero.
    readonly activeCount: number | null;
    readonly evidenceQuality: SliceEvidenceQuality;
    // See docs/architecture/EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md
    // ("Freshness"). null means nothing was actually observed this pass
    // -- never a fabricated observation time. Deliberately independent
    // of evidenceQuality; no staleness threshold is computed from it.
    readonly observedAt: string | null;
  };
  readonly assignments: {
    // null means unavailable -- either a genuine collection failure, or
    // the governed API's own explicit "identity_unavailable" outcome
    // (see EPICENTRAX_MEMBER_ASSIGNMENT_READ_BOUNDARY_ARCHITECTURE.md).
    // Never conflated with a governed-confirmed zero.
    readonly activeCount: number | null;
    readonly evidenceQuality: SliceEvidenceQuality;
    // See docs/architecture/EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md
    // ("Freshness"). null means nothing was actually observed this pass
    // -- never a fabricated observation time. Deliberately independent
    // of evidenceQuality; no staleness threshold is computed from it.
    readonly observedAt: string | null;
  };
  readonly vendorRequests: {
    // null means unavailable -- a genuine collection failure. Never
    // conflated with a governed-confirmed zero (see
    // vendorRequestsProvider.ts for why this boundary cannot separately
    // distinguish an unresolved identity from a real zero, unlike
    // assignments).
    readonly openCount: number | null;
    readonly evidenceQuality: SliceEvidenceQuality;
    // See docs/architecture/EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md
    // ("Freshness"). null means nothing was actually observed this pass
    // -- never a fabricated observation time. Deliberately independent
    // of evidenceQuality; no staleness threshold is computed from it.
    readonly observedAt: string | null;
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
