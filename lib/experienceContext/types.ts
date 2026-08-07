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
  };
  announcements: {
    // null means "unavailable" (source not queried or the optional fetch
    // failed) -- never conflate with a governed-confirmed zero.
    activeCount: number | null;
  };
  assignments: {
    // Always null in Stage 1: no governed member-facing read path exists
    // for public.assignments.
    activeCount: number | null;
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
