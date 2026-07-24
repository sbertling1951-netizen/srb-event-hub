import type { CurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import type { MemberSession } from "@/lib/memberSession";

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
  refresh: () => void;
};
