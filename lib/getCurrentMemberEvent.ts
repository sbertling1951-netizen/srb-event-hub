import { STORAGE_KEYS } from "@/lib/storageKeys";
import { getMemberSession, getCurrentAttendeeId } from "@/lib/memberSession";

export type CurrentMemberEvent = {
  id: string;
  name: string | null;
  eventName: string | null;
  venue_name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  event_code: string | null;
  participant_capacity?: number | null;
  lat: number | null;
  lng: number | null;
};

export function getStoredMemberAttendeeId() {
  if (typeof window === "undefined") {
    return null;
  }
  return localStorage.getItem(STORAGE_KEYS.memberAttendeeId);
}

export function getStoredMemberEntryId() {
  if (typeof window === "undefined") {
    return null;
  }
  return localStorage.getItem(STORAGE_KEYS.memberEntryId);
}

export function getStoredMemberEmail() {
  if (typeof window === "undefined") {
    return null;
  }
  return localStorage.getItem(STORAGE_KEYS.memberEmail);
}

// The authenticated Account login path (finishMemberLogin) writes this;
// Temporary Event Access explicitly clears it. Non-null here means the
// persisted member state originated from an Account session -- used to
// tell a lapsed Account session (needs re-authentication) apart from
// genuine Temporary Event Access (localStorage-sufficient by design).
export function getStoredMemberAuthUserId() {
  if (typeof window === "undefined") {
    return null;
  }
  return localStorage.getItem(STORAGE_KEYS.memberAuthUserId);
}

export function getStoredMemberHasArrived() {
  if (typeof window === "undefined") {
    return null;
  }

  return localStorage.getItem(STORAGE_KEYS.memberHasArrived);
}

export function getStoredUserMode() {
  if (typeof window === "undefined") {
    return null;
  }

  return localStorage.getItem(STORAGE_KEYS.userMode);
}

export type SetCurrentMemberEventInput = {
  id: string;
  name: string | null;
  venue_name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  event_code: string | null;
  participant_capacity?: number | null;
  lat: number | null;
  lng: number | null;
};

export function setCurrentMemberEvent(event: SetCurrentMemberEventInput) {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(
    STORAGE_KEYS.memberEventContext,
    JSON.stringify({
      id: event.id,
      name: event.name || null,
      eventName: event.name || null,
      venue_name: event.venue_name || null,
      location: event.location || null,
      start_date: event.start_date || null,
      end_date: event.end_date || null,
      event_code: event.event_code || null,
      participant_capacity: event.participant_capacity ?? null,
      lat: event.lat || null,
      lng: event.lng || null,
    }),
  );

  localStorage.setItem(STORAGE_KEYS.memberEventChanged, String(Date.now()));
}

export function getCurrentMemberEvent(): CurrentMemberEvent | null {
  if (typeof window === "undefined") {
    return null;
  }

  // Prefer the canonical MemberSession event context when available.
  // Fall back to the legacy event-context storage during the migration.
  const session = getMemberSession();
  if (session?.event_id) {
    return {
      id: session.event_id,
      name: session.event_name ?? null,
      eventName: session.event_name ?? null,
      venue_name: session.venue_name ?? null,
      location: session.location ?? null,
      start_date: session.start_date ?? null,
      end_date: session.end_date ?? null,
      event_code: session.event_code ?? null,
      participant_capacity: session.participant_capacity ?? null,
      lat: session.lat ?? null,
      lng: session.lng ?? null,
    };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEYS.memberEventContext);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CurrentMemberEvent> | null;

    if (!parsed?.id) {
      return null;
    }

    const normalizedName = parsed.name ?? parsed.eventName ?? null;

    return {
      id: parsed.id,
      name: normalizedName,
      eventName: normalizedName,
      venue_name: parsed.venue_name ?? null,
      location: parsed.location ?? null,
      start_date: parsed.start_date ?? null,
      end_date: parsed.end_date ?? null,
      event_code: parsed.event_code ?? null,
      participant_capacity: parsed.participant_capacity ?? null,
      lat: parsed.lat ?? null,
      lng: parsed.lng ?? null,
    };
  } catch (err) {
    console.error("Could not read current member event:", err);
    return null;
  }
}

// Prefer the canonical MemberSession identity. Fall back to the legacy
// storage helper during the member-session migration.
export function getCurrentMemberAttendeeId(): string | null {
  return getCurrentAttendeeId() || getStoredMemberAttendeeId();
}
