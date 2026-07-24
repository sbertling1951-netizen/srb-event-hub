"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { type CurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
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
  isInitializing: boolean;
  hasEvent: boolean;
  hasAttendee: boolean;
};

export const MemberWorkspaceContext =
  createContext<MemberWorkspaceContextValue | null>(null);

export function MemberWorkspaceProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [workspace, setWorkspace] = useState<MemberWorkspaceSnapshot>({
    session: null,
    attendeeId: null,
    participantId: null,
    event: null,
    isAuthenticated: false,
    isReady: false,
    isInitializing: true,
    hasEvent: false,
    hasAttendee: false,
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
    const nextEvent = nextSession?.event_id
      ? ({
          id: nextSession.event_id,
          name: nextSession.event_name ?? null,
          eventName: nextSession.event_name ?? null,
          venue_name: nextSession.venue_name ?? null,
          location: nextSession.location ?? null,
          start_date: nextSession.start_date ?? null,
          end_date: nextSession.end_date ?? null,
          event_code: nextSession.event_code ?? null,
          participant_capacity: nextSession.participant_capacity ?? null,
          lat: nextSession.lat ?? null,
          lng: nextSession.lng ?? null,
        } satisfies CurrentMemberEvent)
      : null;
    const nextIsAuthenticated = isMemberAuthenticated();
    const nextHasEvent = !!nextEvent;
    const nextHasAttendee = !!nextAttendeeId;

    setWorkspace({
      session: nextSession,
      attendeeId: nextAttendeeId,
      participantId: nextParticipantId,
      event: nextEvent,
      isAuthenticated: nextIsAuthenticated,
      isReady: true,
      isInitializing: false,
      hasEvent: nextHasEvent,
      hasAttendee: nextHasAttendee,
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    const handleStorage = () => {
      refresh();
    };

    const handlePageShow = () => {
      refresh();
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("focus", handlePageShow);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("focus", handlePageShow);
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
