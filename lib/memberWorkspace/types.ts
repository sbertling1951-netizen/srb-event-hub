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
  refresh: () => void;
};
