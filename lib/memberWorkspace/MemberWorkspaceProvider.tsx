"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { type CurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import { clearMemberLocalState } from "@/lib/memberAccountSession";
import {
  getCurrentAttendeeId,
  getCurrentParticipantId,
  getMemberSession,
  isMemberAuthenticated,
  type MemberSession,
} from "@/lib/memberSession";
import type {
  EstablishedContextStatus,
  MemberWorkspaceContextValue,
} from "@/lib/memberWorkspace/types";
import { supabase } from "@/lib/supabase";

// Member Event Context Stage 2. Governed established-context validation:
// no more than one revalidation per persisted Event ID within this window,
// so focus/pageshow/storage churn cannot spam the server. Any actual
// change of the persisted Event ID always revalidates immediately,
// regardless of this window.
const MIN_REVALIDATE_INTERVAL_MS = 30_000;

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
  isAccountSession: boolean | null;
  contextStatus: EstablishedContextStatus;
};

type EstablishedContextResponseState =
  | "invalid_authorization"
  | "event_missing"
  | "no_context"
  | "unauthenticated"
  | "ambiguous_person"
  | "error";

type ValidateResponseBody =
  | { state: "valid"; event: EstablishedEventPayload }
  | { state: EstablishedContextResponseState };

type EstablishedEventPayload = {
  id: string;
  name: string | null;
  venueName: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  lat: number | null;
  lng: number | null;
};

export const MemberWorkspaceContext =
  createContext<MemberWorkspaceContextValue | null>(null);

function readSnapshot(
  previous: Pick<MemberWorkspaceSnapshot, "isAccountSession" | "contextStatus">,
): MemberWorkspaceSnapshot {
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

  return {
    session: nextSession,
    attendeeId: nextAttendeeId,
    participantId: nextParticipantId,
    event: nextEvent,
    isAuthenticated: isMemberAuthenticated(),
    isReady: true,
    isInitializing: false,
    hasEvent: !!nextEvent,
    hasAttendee: !!nextAttendeeId,
    isAccountSession: previous.isAccountSession,
    contextStatus: previous.contextStatus,
  };
}

export function MemberWorkspaceProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
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
    isAccountSession: null,
    contextStatus: "idle",
  });

  const refresh = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    setWorkspace((prev) =>
      readSnapshot({
        isAccountSession: prev.isAccountSession,
        contextStatus: prev.contextStatus,
      }),
    );
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

  // Whether this browser holds a real Supabase Auth session (an
  // authenticated Account), distinct from Temporary Event Access or no
  // session at all. Live via onAuthStateChange (fires once immediately with
  // the current session, then again on sign-in/sign-out/token refresh) --
  // never polled.
  useEffect(() => {
    let active = true;

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!active) {
          return;
        }
        setWorkspace((prev) => ({ ...prev, isAccountSession: !!session }));
      },
    );

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Governed established-context validation (Member Event Context Stage
  // 2). Applies only to Account sessions on Member routes with a persisted
  // Event -- Temporary Event Access is untouched (isAccountSession is
  // false or null for it, since it never creates a Supabase Auth session).
  const validationSeqRef = useRef(0);
  const lastValidatedRef = useRef<{ eventId: string; at: number } | null>(
    null,
  );
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!pathname.startsWith("/member")) {
      return;
    }

    if (workspace.isAccountSession !== true) {
      return;
    }

    const eventId = workspace.event?.id ?? null;

    if (!eventId) {
      return;
    }

    const last = lastValidatedRef.current;
    const now = Date.now();
    const withinDedupWindow =
      !!last &&
      last.eventId === eventId &&
      now - last.at < MIN_REVALIDATE_INTERVAL_MS;

    if (withinDedupWindow) {
      return;
    }

    const seq = ++validationSeqRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setWorkspace((prev) =>
      prev.contextStatus === "checking"
        ? prev
        : { ...prev, contextStatus: "checking" },
    );

    void (async () => {
      let result: ValidateResponseBody;

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;

        if (!accessToken) {
          result = { state: "unauthenticated" };
        } else {
          const response = await fetch(
            "/api/member/workspace-context/validate",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({ eventId }),
              signal: controller.signal,
            },
          );

          result = response.ok
            ? ((await response.json()) as ValidateResponseBody)
            : { state: "error" };
        }
      } catch {
        if (controller.signal.aborted) {
          // Superseded by a newer validation (Event switch, logout, or a
          // fresher revalidation) -- discard silently, never apply.
          return;
        }
        result = { state: "error" };
      }

      // Superseded by a newer validation started after this one -- a late
      // response must never win over a more recent request's outcome.
      if (seq !== validationSeqRef.current) {
        return;
      }

      // Re-derive the current session fresh at apply time rather than
      // trusting the closure-captured eventId: if the Member explicitly
      // switched Events, or logged out, while this request was in flight,
      // the persisted Event ID here will no longer match, and this late
      // response must never overwrite that newer state.
      const currentSession = getMemberSession();

      if (!currentSession || currentSession.event_id !== eventId) {
        return;
      }

      if (result.state === "error") {
        // Transient failure, not authorization revocation: preserve the
        // existing cached workspace and leave it eligible to retry on the
        // next revalidation trigger.
        setWorkspace((prev) => ({ ...prev, contextStatus: "error" }));
        return;
      }

      if (result.state === "no_context") {
        // Nothing was actually persisted to validate -- leave state as-is.
        return;
      }

      lastValidatedRef.current = { eventId, at: Date.now() };

      if (result.state === "valid") {
        const validated = result.event;

        setWorkspace((prev) => {
          if (getMemberSession()?.event_id !== eventId) {
            return prev;
          }

          return {
            ...prev,
            contextStatus: "valid",
            event: {
              id: validated.id,
              name: validated.name,
              eventName: validated.name,
              venue_name: validated.venueName,
              location: validated.location,
              start_date: validated.startDate,
              end_date: validated.endDate,
              event_code: prev.event?.event_code ?? null,
              participant_capacity: prev.event?.participant_capacity ?? null,
              lat: validated.lat,
              lng: validated.lng,
            },
          };
        });
        return;
      }

      // invalid_authorization | event_missing | ambiguous_person |
      // unauthenticated: the persisted Event is genuinely no longer a
      // valid established workspace for this Person. Never substitute
      // another Event and never leave the stale Event shell rendering as
      // if valid -- clear local state and route to the existing account
      // selection surface (or login, if the Account session itself is
      // gone) with an explicit reason, exactly once.
      setWorkspace((prev) => ({ ...prev, contextStatus: "invalid" }));
      clearMemberLocalState();

      router.replace(
        result.state === "unauthenticated"
          ? "/member/login"
          : "/member/account?contextInvalid=1",
      );
    })();

    return () => {
      controller.abort();
    };
  }, [pathname, workspace.event?.id, workspace.isAccountSession, router]);

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
