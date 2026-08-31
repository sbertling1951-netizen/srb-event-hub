import type { CurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import type { MemberSession } from "@/lib/memberSession";

// Member Event Context Stage 2. "valid"/"invalid" describe the governed,
// server-verified established-context result for an authenticated Account
// session's persisted Event -- never inferred from localStorage alone.
// "idle": not yet evaluated (e.g. not an Account session, or no Event
// persisted). "checking": a governed validation call is in flight.
// "error": the validation call itself failed transiently; the cached
// workspace is preserved (fail open) rather than treated as revoked.
// Temporary Event Access sessions are never assigned anything but "idle" --
// they are validated per-call by their own existing contract, not by this
// established-context state machine.
export type EstablishedContextStatus =
  | "idle"
  | "checking"
  | "valid"
  | "invalid"
  | "error";

// Member Workspace Continuity. The single coherent answer to "does this
// admitted member workspace have a usable attendee identity" that
// MemberRouteGuard, MemberWorkspaceProvider consumers, and the member
// dashboard all share:
//   "idle"              -- not yet evaluated
//   "resolving"         -- a governed recovery of the attendee identity is
//                          in flight (a present-but-incomplete MemberSession)
//   "resolved"          -- MemberSession is coherent (Event id + attendee
//                          id); the workspace is usable
//   "recovery_required" -- no coherent identity and it cannot be re-derived
//                          here; the UI must route to / render explicit
//                          sign-in or Temporary Event Access recovery,
//                          never a silent null-identity workspace
export type MemberIdentityStatus =
  | "idle"
  | "resolving"
  | "resolved"
  | "recovery_required";

export type MemberWorkspaceContextValue = {
  session: MemberSession | null;
  attendeeId: string | null;
  participantId: string | null;
  event: CurrentMemberEvent | null;
  isAuthenticated: boolean;
  isReady: boolean;
  isInitializing: boolean;
  hasEvent: boolean;
  hasAttendee: boolean;
  // Whether this session has a real Supabase Auth session (an authenticated
  // Account) as opposed to Temporary Event Access or no session at all.
  // null until the one-time Auth check resolves.
  isAccountSession: boolean | null;
  // Governed established-context validity for an Account session's
  // persisted Event. Always "idle" for Temporary Event Access.
  contextStatus: EstablishedContextStatus;
  // Shared attendee-identity continuity state (see MemberIdentityStatus).
  // Both account and Temporary Event Access sessions participate. When a
  // persisted MemberSession has an Event id but no attendee id, the
  // provider attempts one governed recovery and this moves
  // "idle" -> "resolving" -> "resolved" | "recovery_required".
  identityStatus: MemberIdentityStatus;
  // Convenience: identityStatus === "recovery_required". True means an
  // admitted route must surface explicit recovery, not a null workspace.
  needsIdentityRecovery: boolean;
  refresh: () => void;
};
