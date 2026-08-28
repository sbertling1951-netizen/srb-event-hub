"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useLayoutEffect, useState } from "react";

import {
  getCurrentMemberEvent,
  getStoredMemberAttendeeId,
  getStoredMemberEmail,
  getStoredMemberEntryId,
  getStoredUserMode,
} from "@/lib/getCurrentMemberEvent";
import { useMemberWorkspace } from "@/lib/memberWorkspace/useMemberWorkspace";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { supabase } from "@/lib/supabase";

// Member Event Context Stage 2. For an authenticated Account session,
// localStorage alone is no longer sufficient to grant access: the
// established Event context must additionally pass governed server-side
// validation (MemberWorkspaceProvider's contextStatus), so a persisted
// Event that has genuinely become invalid (revoked participation, the
// Event no longer existing) can no longer be presented as a live
// workspace merely because localStorage still names it. An Event that is
// merely inactive or hidden is not, by itself, a reason to block --
// contextStatus only ever becomes "invalid" for a genuine authorization
// loss (see lib/server/workspaceContextResolver.ts).
//
// Temporary Event Access (isAccountSession === false, i.e. no Supabase
// Auth session) keeps its prior, unchanged behavior exactly: localStorage
// mode/identity/event presence is sufficient, since Temporary Access holds
// no durable Person link for a server-side established-context check to
// validate in the first place -- its own governed re-verification already
// happens per-call, inside each identity-scoped RPC it invokes.
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
      const mode = getStoredUserMode();
      const attendeeId = getStoredMemberAttendeeId();
      const entryId = getStoredMemberEntryId();
      const email = getStoredMemberEmail();
      const memberEvent = getCurrentMemberEvent();

      const hasIdentity = !!(attendeeId || entryId || email);
      const hasEvent = !!memberEvent;

      // Only ever an immediate paint for the Temporary Access shape here --
      // an Account session's local presence alone is deliberately not
      // treated as "allowed" pre-paint, since that is exactly the
      // authority this stage moves off of localStorage. workspace.
      // isAccountSession is not yet known this early (its Auth check is
      // itself async), so this optimistic path only fires once the effect
      // below has already confirmed isAccountSession === false.
      if (
        mode === "member" &&
        hasIdentity &&
        hasEvent &&
        workspace.isAccountSession === false
      ) {
        setStatus("allowed");
      }
    } catch {
      // Fall through to the normal verification effect.
    }
  }, [workspace.isAccountSession]);

  useEffect(() => {
    let mounted = true;

    async function verifyMember() {
      try {
        const mode = getStoredUserMode();
        const attendeeId = getStoredMemberAttendeeId();
        const entryId = getStoredMemberEntryId();
        const email = getStoredMemberEmail();
        const memberEvent = getCurrentMemberEvent();

        const hasIdentity = !!(attendeeId || entryId || email);
        const hasEvent = !!memberEvent;
        const hasLegacySession = mode === "member" && hasIdentity && hasEvent;

        if (!hasLegacySession) {
          // 1. No selected-event session at all -- unchanged from before
          // Stage 2. A valid authenticated Supabase account without a
          // persisted Event goes to the account picker to choose (or
          // re-enter) one; anyone else goes to login.
          const { data: sessionData } = await supabase.auth.getSession();
          if (!mounted) {
            return;
          }
          setStatus("denied");
          router.replace(
            sessionData?.session ? "/member/account" : "/member/login",
          );
          return;
        }

        if (workspace.isAccountSession === false) {
          // Temporary Event Access: unchanged. It holds no durable Person
          // link for governed established-context validation to check, so
          // localStorage presence remains sufficient here, exactly as
          // before this stage.
          if (mounted) {
            setStatus("allowed");
          }
          return;
        }

        if (workspace.isAccountSession === null) {
          // The one-time Auth check hasn't resolved yet -- keep showing
          // the checking state rather than guessing which contract
          // applies. This effect re-runs once it resolves (see the
          // dependency array below).
          if (mounted) {
            setStatus("checking");
          }
          return;
        }

        // Authenticated Account session: require governed established-
        // context validation before treating the route as allowed.
        // "error" fails open (a transient validation failure must not be
        // misrepresented as authorization revocation) and keeps showing
        // the existing cached workspace rather than blocking it.
        // "invalid" is not handled here at all -- MemberWorkspaceProvider
        // itself already performs the redirect the moment it observes
        // that outcome, so this Guard only needs to avoid rendering
        // children as if the (now-superseded) workspace were still valid
        // while that navigation is in flight.
        if (
          workspace.contextStatus === "valid" ||
          workspace.contextStatus === "error"
        ) {
          if (mounted) {
            setStatus("allowed");
          }
          return;
        }

        if (mounted) {
          setStatus("checking");
        }
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
  }, [router, workspace.isAccountSession, workspace.contextStatus]);

  if (status === "checking") {
    return <div style={{ padding: 24 }}>Checking member access...</div>;
  }

  if (status === "denied") {
    return <div style={{ padding: 24 }}>Redirecting...</div>;
  }

  return <>{children}</>;
}
