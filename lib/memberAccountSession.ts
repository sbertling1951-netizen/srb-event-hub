// Shared helpers for the person-centric member account flow
// (Account Login / Account Home / magic-link activation) that are used
// by more than one page (app/member/login/page.tsx,
// app/member/account/page.tsx). Extracted so both pages call the same
// trusted, server-authorized event-session logic rather than
// duplicating it.
//
// Canonical identity chain (never bypassed here):
//   auth.uid() -> person_auth_accounts.auth_user_id -> people.id
//   -> attendees.person_id
// attendees.auth_user_id is never read or written by anything in this
// module.

import { logEngagement } from "@/lib/engagement";
import {
  clearMemberSession,
  saveMemberSession,
} from "@/lib/memberSession";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { setSharedDeviceMode, supabase } from "@/lib/supabase";

export type MinimalEventForSession = {
  id: string;
  name: string | null;
  venue_name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  lat: number | null;
  lng: number | null;
};

// Row shape returned by the resolve_member_account() RPC. The server
// derives the caller's identity from the authenticated Supabase Auth
// session (auth.uid()) and returns only that person's own event
// registrations -- the browser never supplies or asserts a person_id.
export type ResolvedRegistration = {
  attendee_id: string;
  entry_id: string | null;
  event_id: string;
  email: string | null;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  has_arrived: boolean | null;
  event_name: string | null;
  venue_name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  lat: number | null;
  lng: number | null;
};

export function registrationDisplayName(row: ResolvedRegistration) {
  const pilot = [row.pilot_first, row.pilot_last].filter(Boolean).join(" ");
  const copilot = [row.copilot_first, row.copilot_last]
    .filter(Boolean)
    .join(" ");
  return pilot || copilot || row.entry_id || "Registration";
}

export function formatDateRange(
  startDate: string | null,
  endDate: string | null,
) {
  if (!startDate && !endDate) {
    return "";
  }
  if (startDate && endDate) {
    return `${startDate} – ${endDate}`;
  }
  return startDate || endDate || "";
}

// Current: today falls between start_date and end_date (inclusive).
// Upcoming: start_date is after today.
// Past: end_date is before today.
// This mirrors the same date comparison style already used for the
// check-in-open calculation below (string comparison of ISO date
// strings), and adds no new eligibility filter -- resolve_member_account()
// has already applied the sole eligibility definition (event
// visible_to_members + active); this only buckets already-eligible rows
// for display.
export type EventTimingBucket = "current" | "upcoming" | "past";

export function categorizeEventTiming(
  startDate: string | null,
  endDate: string | null,
  today: string = new Date().toISOString().slice(0, 10),
): EventTimingBucket {
  if (startDate && today < startDate) {
    return "upcoming";
  }
  if (endDate && today > endDate) {
    return "past";
  }
  if (!endDate && startDate && today < startDate) {
    return "upcoming";
  }
  return "current";
}

// Shared session-completion step for both Account Login/Account Home
// and legacy Event Access. Only ever called after a registration has
// already been validated server-side (verify_member_event_login for
// Event Access, or resolve_member_account for the authenticated
// account path). localStorage is written here as the OUTCOME of that
// validation, never as the proof of it.
export async function finishMemberLogin(params: {
  event: MinimalEventForSession;
  attendeeId: string;
  entryId: string | null;
  email: string | null;
  hasArrived: boolean;
  authUserId?: string | null;
  participantId?: string | null;
  participantName?: string | null;
  identifierIsPhone?: boolean;
  rawIdentifier?: string;
}): Promise<string> {
  const {
    event,
    attendeeId,
    entryId,
    email,
    hasArrived,
    authUserId,
    participantId,
    participantName,
    identifierIsPhone,
    rawIdentifier,
  } = params;

  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEYS.memberAttendeeId, attendeeId);
    localStorage.setItem(STORAGE_KEYS.memberEmail, email || "");
    if (authUserId) {
      localStorage.setItem(STORAGE_KEYS.memberAuthUserId, authUserId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.memberAuthUserId);
    }
    localStorage.setItem(STORAGE_KEYS.memberEntryId, entryId || "");
    localStorage.setItem(STORAGE_KEYS.memberHasArrived, String(hasArrived));
    localStorage.setItem(STORAGE_KEYS.userMode, "member");
    localStorage.setItem(STORAGE_KEYS.userModeChanged, String(Date.now()));
  }

  saveMemberSession({
    event_id: event.id,
    event_name: event.name || null,
    event_code: null,
    venue_name: event.venue_name || null,
    location: event.location || null,
    start_date: event.start_date || null,
    end_date: event.end_date || null,
    lat: event.lat || null,
    lng: event.lng || null,
    attendee_id: attendeeId,
    attendee_email: email || null,
    attendee_phone: identifierIsPhone ? rawIdentifier || null : null,
    participant_id: participantId || null,
    participant_name: participantName || null,
    login_at: new Date().toISOString(),
    expires_at: null,
  });

  await logEngagement({
    eventId: event.id,
    attendeeId,
    activityType: "login",
  });

  const today = new Date().toISOString().slice(0, 10);
  const checkinOpen = !!event.start_date && today >= event.start_date;

  return hasArrived || !checkinOpen ? "/member" : "/member/checkin";
}

// Enter a resolved (server-authorized) registration directly -- used by
// both the Account Login single/multi picker and the Account Home
// event cards. All event fields come from resolve_member_account();
// no separate client-side events lookup is made.
export async function enterResolvedRegistration(
  row: ResolvedRegistration,
  authUserId: string,
): Promise<string> {
  const event: MinimalEventForSession = {
    id: row.event_id,
    name: row.event_name,
    venue_name: row.venue_name,
    location: row.location,
    start_date: row.start_date,
    end_date: row.end_date,
    lat: row.lat,
    lng: row.lng,
  };

  return finishMemberLogin({
    event,
    attendeeId: row.attendee_id,
    entryId: row.entry_id,
    email: row.email,
    hasArrived: !!row.has_arrived,
    authUserId,
  });
}

// Local-storage cleanup shared by full logout and by Member Event Context
// Stage 2's invalid-established-context handling. Clears every piece of
// legacy/local member and account-picker state -- MemberSession plus every
// standalone legacy key -- but never touches the Supabase Auth session
// itself; callers that are actually signing the account out call
// supabase.auth.signOut() separately (see signOutOfMemberAccount below).
// An invalid Event context is not an invalid account: the Person may still
// be legitimately signed in and simply needs to choose a different, valid
// Event.
export function clearMemberLocalState() {
  clearMemberSession();

  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEYS.memberAttendeeId);
    localStorage.removeItem(STORAGE_KEYS.memberEntryId);
    localStorage.removeItem(STORAGE_KEYS.memberEmail);
    localStorage.removeItem(STORAGE_KEYS.memberHasArrived);
    localStorage.removeItem(STORAGE_KEYS.memberEventContext);
    localStorage.removeItem(STORAGE_KEYS.memberEventChanged);
    localStorage.removeItem(STORAGE_KEYS.memberAuthUserId);
  }
}

// Full logout: ends the Supabase Auth session and clears every piece
// of legacy/local member and account-picker state so no stale identity
// evidence remains in the browser.
export async function signOutOfMemberAccount() {
  // Clear the account-origin marker before Supabase publishes SIGNED_OUT.
  // MemberRouteGuard intentionally treats that marker plus an absent Auth
  // session as an unexpected/lapsed Account session. During an explicit
  // logout, removing it first prevents that legitimate guard from racing
  // this deliberate transition and showing the expired-session notice.
  clearMemberLocalState();

  // Reset shared-device intent at the same boundary. A later sign-in must
  // always choose its storage mode explicitly, including if signOut fails.
  setSharedDeviceMode(false);

  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.error("Sign out failed:", err);
  } finally {
    // Keep cleanup idempotent in case browser storage changed while the
    // sign-out request was in flight.
    clearMemberLocalState();
    setSharedDeviceMode(false);
  }
}
