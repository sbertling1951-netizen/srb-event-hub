import { setCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import { STORAGE_KEYS } from "@/lib/storageKeys";

export type MemberSession = {
  event_id: string;
  event_name: string | null;
  event_code: string | null;
  participant_capacity?: number | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  lat?: number | null;
  lng?: number | null;

  // Optional attendee/participant identity fields
  attendee_id?: string | null;
  attendee_email?: string | null;
  attendee_phone?: string | null;

  participant_id?: string | null;
  participant_name?: string | null;

  login_at: string;
  expires_at: string | null;
};

const MEMBER_SESSION_KEY = STORAGE_KEYS.memberSession;

export function saveMemberSession(session: MemberSession) {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(MEMBER_SESSION_KEY, JSON.stringify(session));
  setCurrentMemberEvent({
    id: session.event_id,
    name: session.event_name,
    venue_name: session.venue_name || null,
    location: session.location || null,
    start_date: session.start_date || null,
    end_date: session.end_date || null,
    event_code: session.event_code || null,
    participant_capacity: session.participant_capacity ?? null,
    lat: session.lat || null,
    lng: session.lng || null,
  });
  localStorage.setItem(STORAGE_KEYS.memberEventChanged, String(Date.now()));
  localStorage.setItem(STORAGE_KEYS.userMode, "member");
}

export function getMemberSession(): MemberSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(MEMBER_SESSION_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as MemberSession;
  } catch (err) {
    console.error("Could not read member session:", err);
    return null;
  }
}

export function requireMemberSession(): MemberSession {
  const session = getMemberSession();
  if (!session) {
    throw new Error("Member session not found.");
  }
  return session;
}

export function getCurrentParticipantId(): string | null {
  return getMemberSession()?.participant_id ?? null;
}

export function getCurrentAttendeeId(): string | null {
  return getMemberSession()?.attendee_id ?? null;
}

export function isParticipantIdentified(): boolean {
  return !!getMemberSession()?.participant_id;
}

export function isMemberSessionExpired(session: MemberSession | null): boolean {
  if (!session) {
    return true;
  }
  if (!session.expires_at) {
    return false;
  }

  const expiresAt = new Date(session.expires_at).getTime();
  if (Number.isNaN(expiresAt)) {
    return false;
  }

  return Date.now() >= expiresAt;
}

export function clearMemberSession() {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.removeItem(MEMBER_SESSION_KEY);
  localStorage.removeItem(STORAGE_KEYS.memberEventContext);
  localStorage.removeItem(STORAGE_KEYS.memberEventChanged);
  localStorage.removeItem(STORAGE_KEYS.userMode);
}
