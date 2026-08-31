"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useLayoutEffect, useState } from "react";

import {
  getCurrentMemberEvent,
  getStoredMemberAuthUserId,
  getStoredUserMode,
} from "@/lib/getCurrentMemberEvent";
import { clearMemberLocalState } from "@/lib/memberAccountSession";
import {
  canOptimisticallyPaintAllow,
  evaluateMemberRouteAccess,
} from "@/lib/memberWorkspace/memberRouteAccess";
import { useMemberWorkspace } from "@/lib/memberWorkspace/useMemberWorkspace";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { supabase } from "@/lib/supabase";

// Member Event Context Stage 2 + Member Workspace Continuity + M2. For an
// authenticated Account session, localStorage alone is not sufficient to
// grant access: the established Event context must additionally pass
// governed server-side validation (MemberWorkspaceProvider's
// contextStatus). An Event that is merely inactive or hidden is not, by
// itself, a reason to block -- contextStatus only ever becomes "invalid"
// for a genuine authorization loss (see lib/server/workspaceContextResolver.ts).
//
// The full bootstrap + admission decision is a pure function --
// evaluateMemberRouteAccess (lib/memberWorkspace/memberRouteAccess.ts) --
// so the whole state matrix is executable-testable. This component only
// reads the inputs and performs the returned action (setStatus / redirect /
// clearMemberLocalState). It makes no identity RPC of its own.
//
// M2 (Option A): the coarse "is this a member browser" pre-gate is
//   hasLegacySession = mode === "member" && hasEvent
// where hasEvent = !!getCurrentMemberEvent() -- the persisted MemberSession
// Event first, then the fcoc-member-event-context discovery hint. The
// hint-inclusive form is a hard compatibility requirement: an authenticated
// old-browser session with no MemberSession must still reach the governed
// recovery path from the hint. The retired legacy standalone attendee-id key is
// no longer read here.
//
// Bootstrap eligibility is NOT admission. A browser that passes
// hasLegacySession is only kept mounted long enough for
// MemberWorkspaceProvider's shared recovery to run; protected children
// still cannot render until identityStatus === "resolved" (and, for an
// Account session, contextStatus in {valid, error}). The three persisted
// shapes -- authenticated Account, lapsed Account (account-origin marker +
// no live Auth -> clear + re-auth), and Temporary Event Access -- are all
// resolved inside evaluateMemberRouteAccess.
export default function MemberRouteGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const workspace = useMemberWorkspace();
  const [status, setStatus] = useState<"checking" | "allowed" | "denied">(
    "checking",
  );

  useLayoutEffect(() => {
    try {
      // Narrow synchronous fast-path: paint "allowed" immediately only for
      // a Temporary Event Access session whose shared identity is ALREADY
      // resolved (coherent MemberSession), avoiding a checking-state flash.
      // Never fires for an Account session's local presence, for a lapsed
      // Account session, or unless identityStatus === "resolved". The M2
      // Option A change: it no longer consults the retired attendee-id key.
      if (
        canOptimisticallyPaintAllow({
          mode: getStoredUserMode(),
          hasEvent: !!getCurrentMemberEvent(),
          accountOriginMarker: getStoredMemberAuthUserId(),
          isAccountSession: workspace.isAccountSession,
          identityStatus: workspace.identityStatus,
        })
      ) {
        setStatus("allowed");
      }
    } catch {
      // Fall through to the normal verification effect.
    }
  }, [workspace.isAccountSession, workspace.identityStatus]);

  useEffect(() => {
    let mounted = true;

    async function verifyMember() {
      try {
        // localStorage inputs (read once, never mutated here).
        const mode = getStoredUserMode();
        const hasEvent = !!getCurrentMemberEvent();
        const accountOriginMarker = getStoredMemberAuthUserId();

        // Live Supabase Auth session presence -- used only to choose the
        // redirect destination (account picker vs. sign-in). Read fresh at
        // decision time, exactly as the pre-M2 Guard did in its two
        // auth-dependent redirect branches.
        const { data: sessionData } = await supabase.auth.getSession();
        if (!mounted) {
          return;
        }

        const decision = evaluateMemberRouteAccess({
          mode,
          hasEvent,
          accountOriginMarker,
          hasLiveAuthSession: !!sessionData.session,
          isAccountSession: workspace.isAccountSession,
          identityStatus: workspace.identityStatus,
          contextStatus: workspace.contextStatus,
        });

        if (decision.action === "allow") {
          if (mounted) {
            setStatus("allowed");
          }
          return;
        }

        if (decision.action === "checking") {
          if (mounted) {
            setStatus("checking");
          }
          return;
        }

        // decision.action === "redirect"
        if (mounted) {
          setStatus("denied");
        }
        if (decision.clearState) {
          clearMemberLocalState();
        }
        router.replace(decision.destination);
      } catch (err) {
        console.error("MemberRouteGuard error:", err);
        if (mounted) {
          setStatus("denied");
        }
        router.replace("/member/login");
      }
    }

    void verifyMember();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === STORAGE_KEYS.memberSession ||
        e.key === STORAGE_KEYS.memberEventContext ||
        e.key === STORAGE_KEYS.memberEventChanged ||
        e.key === STORAGE_KEYS.userMode ||
        e.key === STORAGE_KEYS.userModeChanged
      ) {
        void verifyMember();
      }
    }

    function handlePageShow() {
      void verifyMember();
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      mounted = false;
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [
    router,
    workspace.isAccountSession,
    workspace.contextStatus,
    workspace.identityStatus,
  ]);

  if (status === "checking") {
    return <div style={{ padding: 24 }}>Checking member access...</div>;
  }

  if (status === "denied") {
    return <div style={{ padding: 24 }}>Redirecting...</div>;
  }

  return <>{children}</>;
}
