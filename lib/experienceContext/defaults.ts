import { computeEventDayNumber } from "@/lib/eventDayNumber";
import type {
  CollectSharedExperienceContextInput,
  SharedExperienceContext,
} from "@/lib/experienceContext/types";

export function buildCanonicalEventSlice(
  input: CollectSharedExperienceContextInput,
): SharedExperienceContext["event"] {
  const { event, now } = input;

  return {
    id: event.id,
    name: event.name,
    location: event.location,
    startDate: event.start_date,
    endDate: event.end_date,
    // Shared with components/MemberDashboardHeader.tsx's own Day-label
    // formatting -- see lib/eventDayNumber.ts. Correctly returns null
    // once the event is over (never a fabricated in-event Day number
    // past end_date), not just before it starts.
    dayNumber: computeEventDayNumber(event.start_date, event.end_date, now),
    // No authoritative event-phase source exists yet. See the
    // architecture document.
    phase: null,
  };
}

export function buildCanonicalMemberSlice(
  input: CollectSharedExperienceContextInput,
): SharedExperienceContext["member"] {
  return {
    attendeeId: input.attendeeId,
    participantCapacity: input.participantCapacity,
    participantCount: input.participantCount,
    checkedIn: input.checkedIn,
  };
}

export function buildCanonicalBaseSharedExperienceContext(
  input: CollectSharedExperienceContextInput,
): SharedExperienceContext {
  return {
    generatedAt: input.now.toISOString(),
    event: buildCanonicalEventSlice(input),
    member: buildCanonicalMemberSlice(input),
    agenda: {
      currentItem: null,
      nextItem: null,
      // The canonical unavailable default. A successful
      // agendaExperienceContextProvider contribution overwrites this
      // whole slice, including evidenceQuality and observedAt, with a
      // real observation.
      evidenceQuality: "unavailable",
      // Nothing was actually observed this pass -- never a fabricated
      // timestamp standing in for a real one.
      observedAt: null,
    },
    announcements: {
      activeCount: null,
      // The canonical unavailable default. A successful
      // announcementsExperienceContextProvider contribution overwrites
      // this whole slice, including evidenceQuality and observedAt, with
      // a real observation.
      evidenceQuality: "unavailable",
      observedAt: null,
    },
    // The canonical unavailable/default value. A successful
    // assignmentsExperienceContextProvider contribution overwrites this
    // with a governed count; null remains the fallback whenever
    // Assignment context is unavailable (provider not yet run, or failed
    // -- see EPICENTRAX_MEMBER_ASSIGNMENT_READ_BOUNDARY_ARCHITECTURE.md).
    assignments: {
      activeCount: null,
      evidenceQuality: "unavailable",
      observedAt: null,
    },
    // The canonical unavailable default. A successful
    // vendorRequestsExperienceContextProvider contribution overwrites this
    // whole slice, including evidenceQuality and observedAt, with a real
    // observation.
    vendorRequests: {
      openCount: null,
      evidenceQuality: "unavailable",
      observedAt: null,
    },
  };
}
