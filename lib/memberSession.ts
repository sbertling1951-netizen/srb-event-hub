import { setCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "@/lib/storageKeys";
import {
  dualRemoveLocal,
  readMigratingLocal,
  signalCanonicalLocal,
  writeCanonicalLocal,
} from "@/lib/storageMigration";

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
  temporary_capability_hash?: string | null;

  participant_id?: string | null;
  participant_name?: string | null;

  login_at: string;
  expires_at: string | null;
};

export const TEMPORARY_CAPABILITY_MARKER = "__TEA_CAPABILITY__:";

export function memberIdentityRpcArgs(session: MemberSession | null) {
  if (session?.temporary_capability_hash) {
    return {
      p_event_code: null,
      p_registration_identifier: `${TEMPORARY_CAPABILITY_MARKER}${session.temporary_capability_hash}`,
    };
  }

  return {
    p_event_code: session?.event_code || null,
    p_registration_identifier:
      session?.attendee_email || session?.attendee_phone || null,
  };
}

const MEMBER_SESSION_KEY = STORAGE_KEYS.memberSession;
const LEGACY_MEMBER_SESSION_KEY = LEGACY_STORAGE_KEYS.memberSession;

export function saveMemberSession(session: MemberSession) {
  if (typeof window === "undefined") {
    return;
  }

  // Fresh member state is canonical-only. Legacy state remains readable and
  // migrates forward through readMigratingLocal during the compatibility window.
  writeCanonicalLocal(MEMBER_SESSION_KEY, JSON.stringify(session));
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
  signalCanonicalLocal(STORAGE_KEYS.memberEventChanged, String(Date.now()));
  writeCanonicalLocal(STORAGE_KEYS.userMode, "member");
}

export function getMemberSession(): MemberSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = readMigratingLocal(
      MEMBER_SESSION_KEY,
      LEGACY_MEMBER_SESSION_KEY,
    );
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

// Persist a governed, server-resolved attendee id onto the canonical
// MemberSession when the persisted session is missing it or holds a
// different value. Used by the shared member-identity recovery layer and
// by My Check-In after it resolves an attendee record -- MemberSession is
// the single client identity source. No-op when the session is absent
// (nothing coherent to attach it to) or already carries the same id.
export function ensureMemberSessionAttendee(attendeeId: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const session = getMemberSession();
  if (!session?.event_id || session.attendee_id === attendeeId) {
    return false;
  }
  saveMemberSession({ ...session, attendee_id: attendeeId });
  return true;
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

export function isMemberAuthenticated(): boolean {
  const session = getMemberSession();
  return !!session && !isMemberSessionExpired(session);
}

export function clearMemberSession() {
  if (typeof window === "undefined") {
    return;
  }

  dualRemoveLocal(MEMBER_SESSION_KEY, LEGACY_MEMBER_SESSION_KEY);
  dualRemoveLocal(
    STORAGE_KEYS.memberEventContext,
    LEGACY_STORAGE_KEYS.memberEventContext,
  );
  dualRemoveLocal(
    STORAGE_KEYS.memberEventChanged,
    LEGACY_STORAGE_KEYS.memberEventChanged,
  );
  dualRemoveLocal(STORAGE_KEYS.userMode, LEGACY_STORAGE_KEYS.userMode);
}
