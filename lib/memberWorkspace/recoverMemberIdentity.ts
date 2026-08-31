import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import {
  getMemberSession,
  memberIdentityRpcArgs,
  saveMemberSession,
} from "@/lib/memberSession";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { supabase } from "@/lib/supabase";

// Member Workspace Continuity: the ONE shared recovery of a member's
// attendee identity when the persisted MemberSession is present-but-
// incomplete (has an Event id, no attendee id) OR fully absent while a
// live authenticated account + an Event context still exist -- the
// "half-session" state that used to admit a member into a workspace with
// no usable identity and dead-end My Check-In.
//
// Rules this enforces (see the approved repair scope + pre-commit
// correction):
//   * MemberSession is the canonical persisted client workspace source.
//     The current-Event context (MemberSession first, then the
//     fcoc-member-event-context pointer that /member/events public
//     discovery also writes) is used as a recovery HINT ONLY for a live
//     authenticated account, and ONLY when no persisted MemberSession
//     Event exists. Temporary Event Access never uses the hint.
//   * A legacy fcoc-member-attendee-id is NEVER an anchor and is NEVER
//     paired with the (possibly hinted) Event. The attendee identity is
//     always re-derived through the existing governed
//     public.get_my_attendee_record RPC -- its authenticated branch
//     resolves from auth.uid() + p_event_id (no client-supplied attendee
//     id, no credential args); its Temporary Event Access branch needs a
//     still-valid capability hash on a persisted MemberSession. Server
//     success is the sole authority for the resolved attendee.
//   * A stale Temporary Event Access state (no live auth, no capability
//     hash) is NOT reconstructed -- an old Event + attendee key pair
//     cannot recreate a governed TEA capability; the caller surfaces
//     explicit sign-in / Temporary Event Access recovery instead.
//   * On success it rewrites a coherent MemberSession for the anchored
//     Event + resolved attendee, and refreshes the legacy compatibility
//     keys older readers still consult.

export type MemberIdentityRecoveryOutcome =
  | { status: "resolved"; attendeeId: string; eventId: string }
  | {
      status: "recovery_required";
      reason: "no_event" | "not_resolvable" | "stale_temporary";
    };

type AttendeeRecordRow = {
  id?: unknown;
  entry_id?: unknown;
  email?: unknown;
  has_arrived?: unknown;
  participant_capacity?: unknown;
};

export async function recoverMemberIdentity(
  signal?: AbortSignal,
): Promise<MemberIdentityRecoveryOutcome> {
  const session = getMemberSession();
  // The current-Event context (MemberSession first, then the
  // fcoc-member-event-context discovery pointer). Used ONLY as a recovery
  // hint when there is no persisted MemberSession Event, and ONLY for a
  // live authenticated account (see below). A legacy attendee id is never
  // an anchor and is never paired with the hinted Event.
  const eventContext = getCurrentMemberEvent();
  const sessionEventId = session?.event_id ?? null;
  const hintEventId = eventContext?.id ?? null;

  const { data: authData } = await supabase.auth.getSession();
  if (signal?.aborted) {
    return { status: "recovery_required", reason: "not_resolvable" };
  }
  const authSession = authData.session;
  const capabilityHash = session?.temporary_capability_hash ?? null;

  let eventId: string;
  let rpcArgs: {
    p_event_id: string;
    p_event_code: string | null;
    p_registration_identifier: string | null;
  };
  let isCapabilityRecovery = false;

  if (authSession) {
    // Live authenticated Member Account. Anchor to the persisted
    // MemberSession's Event, or -- when the MemberSession is fully absent
    // -- the current-Event hint. The governed authenticated resolver
    // derives the attendee from auth.uid() + p_event_id alone: no
    // credential args, and no client-supplied attendee id. Server success
    // is the sole authority for the attendee identity.
    const anchor = sessionEventId ?? hintEventId;
    if (!anchor) {
      return { status: "recovery_required", reason: "no_event" };
    }
    eventId = anchor;
    rpcArgs = {
      p_event_id: eventId,
      p_event_code: null,
      p_registration_identifier: null,
    };
  } else if (sessionEventId && capabilityHash) {
    // Temporary Event Access: reconstructable ONLY from its own governed
    // capability on a persisted MemberSession -- never from a legacy Event
    // + attendee key pair, and never from a discovery Event hint.
    eventId = sessionEventId;
    rpcArgs = { p_event_id: eventId, ...memberIdentityRpcArgs(session) };
    isCapabilityRecovery = true;
  } else {
    return {
      status: "recovery_required",
      reason: sessionEventId ? "stale_temporary" : "no_event",
    };
  }

  const { data, error } = await supabase.rpc("get_my_attendee_record", rpcArgs);
  if (signal?.aborted) {
    return { status: "recovery_required", reason: "not_resolvable" };
  }

  const row = (Array.isArray(data) ? data[0] : null) as AttendeeRecordRow | null;

  if (error || typeof row?.id !== "string") {
    return { status: "recovery_required", reason: "not_resolvable" };
  }

  const resolvedAttendeeId = row.id;

  // Build a coherent MemberSession for the anchored Event + the
  // server-resolved attendee. Event display fields come from the best
  // available persisted context (the MemberSession, then the hint);
  // identity fields are the freshly resolved values merged over what a
  // partial session already held. Temporary Event Access recovery keeps
  // its capability + expiry; an authenticated recovery carries no event
  // code (accounts do not use one) -- never pull one from the hint.
  saveMemberSession({
    event_id: eventId,
    event_name: session?.event_name ?? eventContext?.name ?? null,
    event_code: isCapabilityRecovery ? (session?.event_code ?? null) : null,
    venue_name: session?.venue_name ?? eventContext?.venue_name ?? null,
    location: session?.location ?? eventContext?.location ?? null,
    start_date: session?.start_date ?? eventContext?.start_date ?? null,
    end_date: session?.end_date ?? eventContext?.end_date ?? null,
    lat: session?.lat ?? eventContext?.lat ?? null,
    lng: session?.lng ?? eventContext?.lng ?? null,
    participant_capacity:
      typeof row.participant_capacity === "number"
        ? row.participant_capacity
        : (session?.participant_capacity ?? null),
    attendee_id: resolvedAttendeeId,
    attendee_email: session?.attendee_email ?? null,
    attendee_phone: session?.attendee_phone ?? null,
    temporary_capability_hash: isCapabilityRecovery ? capabilityHash : null,
    participant_id: session?.participant_id ?? null,
    participant_name: session?.participant_name ?? null,
    login_at: session?.login_at ?? new Date().toISOString(),
    expires_at: session?.expires_at ?? null,
  });

  // Legacy compatibility keys remain compatibility data only -- they never
  // independently establish identity -- but older readers (the dashboard,
  // the Guard's bootstrap check, engagement logging) still consult them,
  // so keep them consistent with the repaired MemberSession.
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEYS.memberAttendeeId, resolvedAttendeeId);
    localStorage.setItem(STORAGE_KEYS.userMode, "member");
    if (typeof row.entry_id === "string") {
      localStorage.setItem(STORAGE_KEYS.memberEntryId, row.entry_id);
    }
    if (typeof row.email === "string") {
      localStorage.setItem(STORAGE_KEYS.memberEmail, row.email);
    }
    if (typeof row.has_arrived === "boolean") {
      localStorage.setItem(
        STORAGE_KEYS.memberHasArrived,
        String(row.has_arrived),
      );
    }
    if (authSession?.user?.id) {
      localStorage.setItem(
        STORAGE_KEYS.memberAuthUserId,
        authSession.user.id,
      );
    }
  }

  return { status: "resolved", attendeeId: resolvedAttendeeId, eventId };
}
