import type { MemberSession } from "@/lib/memberSession";
import type { CurrentMemberEvent } from "@/lib/getCurrentMemberEvent";

export type MemberWorkspaceContextValue = {
  session: MemberSession | null;
  attendeeId: string | null;
  participantId: string | null;
  event: CurrentMemberEvent | null;
  isAuthenticated: boolean;
  isReady: boolean;
  refresh: () => void;
};
