"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  getCurrentMemberEvent,
  type CurrentMemberEvent,
} from "@/lib/getCurrentMemberEvent";
import {
  getCurrentAttendeeId,
  getCurrentParticipantId,
  getMemberSession,
  isMemberAuthenticated,
  type MemberSession,
} from "@/lib/memberSession";
import type { MemberWorkspaceContextValue } from "@/lib/memberWorkspace/types";

type MemberWorkspaceSnapshot = {
  session: MemberSession | null;
  attendeeId: string | null;
  participantId: string | null;
  event: CurrentMemberEvent | null;
  isAuthenticated: boolean;
  isReady: boolean;
};

export const MemberWorkspaceContext = createContext<MemberWorkspaceContextValue | null>(null);

export function MemberWorkspaceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [workspace, setWorkspace] = useState<MemberWorkspaceSnapshot>({
    session: null,
    attendeeId: null,
    participantId: null,
    event: null,
    isAuthenticated: false,
    isReady: false,
  });

  const refresh = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextSession = getMemberSession();
    const nextAttendeeId =
      nextSession?.attendee_id ?? getCurrentAttendeeId() ?? null;
    const nextParticipantId =
      nextSession?.participant_id ?? getCurrentParticipantId() ?? null;
    const nextEvent = getCurrentMemberEvent();
    const nextIsAuthenticated = isMemberAuthenticated();

    setWorkspace({
      session: nextSession,
      attendeeId: nextAttendeeId,
      participantId: nextParticipantId,
      event: nextEvent,
      isAuthenticated: nextIsAuthenticated,
      isReady: true,
    });
  }, []);

  useEffect(() => {
    refresh();

    const handleStorage = () => {
      refresh();
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [refresh]);

  const value = useMemo<MemberWorkspaceContextValue>(
    () => ({
      ...workspace,
      refresh,
    }),
    [refresh, workspace],
  );

  return (
    <MemberWorkspaceContext.Provider value={value}>
      {children}
    </MemberWorkspaceContext.Provider>
  );
}
