"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useLayoutEffect, useState } from "react";

import {
  getCurrentMemberEvent,
  getStoredMemberAttendeeId,
  getStoredMemberAuthUserId,
  getStoredMemberEntryId,
  getStoredUserMode,
} from "@/lib/getCurrentMemberEvent";
import { clearMemberLocalState } from "@/lib/memberAccountSession";
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
// This guard now distinguishes three persisted-member states explicitly:
//
//   1. Authenticated Account session -- account-origin marker present
//      (fcoc-member-auth-user-id) AND a live Supabase Auth session
//      (isAccountSession === true). Allowed only once
//      MemberWorkspaceProvider's contextStatus is "valid"/"error", exactly
//      as before.
//
//   2. Lapsed Account session -- account-origin marker present but the
//      Supabase Auth session is gone (isAccountSession === false). This is
//      NOT Temporary Event Access. localStorage carries no auth.uid(), so
//      every identity-scoped RPC would dead-end (the My Check-In
//      "no attendee record" failure). Protected children are never
//      rendered; the stale account state is cleared and the member is
//      routed to /member/login?sessionExpired=1. Re-authentication restores
//      auth.uid() and canonical attendee resolution.
//
//   3. Genuine Temporary Event Access -- no account-origin marker,
//      isAccountSession === false, valid persisted event/identity context.
//      Behavior is unchanged: localStorage mode/identity/event presence is
//      sufficient, since Temporary Access holds no durable Person link for
//      a server-side established-context check to validate, and its own
//      governed re-verification happens per-call inside each identity-scoped
//      RPC it invokes.
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
      const memberEvent = getCurrentMemberEvent();
      const accountOriginMarker = getStoredMemberAuthUserId();

      const hasIdentity = !!(attendeeId || entryId);
      const hasEvent = !!memberEvent;

      // Only ever an immediate paint for the Temporary Access shape here --
      // an Account session's local presence alone is deliberately not
      // treated as "allowed" pre-paint, since that is exactly the
      // authority this stage moves off of localStorage. workspace.
      // isAccountSession is not yet known this early (its Auth check is
      // itself async), so this optimistic path only fires once the effect
      // below has already confirmed isAccountSession === false.
      //
      // A lapsed Account session (account-origin marker present, Supabase
      // Auth session gone) is explicitly excluded: it is not Temporary
      // Event Access and must never be optimistically painted as allowed
      // from localStorage. The verification effect below routes it to
      // re-authentication.
      if (
        mode === "member" &&
        hasIdentity &&
        hasEvent &&
        !accountOriginMarker &&
        workspace.isAccountSession === false &&
        workspace.identityStatus === "resolved"
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
        const mode = getStoredUserMode();
        const attendeeId = getStoredMemberAttendeeId();
        const entryId = getStoredMemberEntryId();
        const memberEvent = getCurrentMemberEvent();

        const accountOriginMarker = getStoredMemberAuthUserId();

        const hasIdentity = !!(attendeeId || entryId);
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

        if (accountOriginMarker && workspace.isAccountSession === false) {
          // Lapsed Account session: account-origin evidence
          // (fcoc-member-auth-user-id, written only by the authenticated
          // Account login path) persists in localStorage, but the live
          // Supabase Auth session is gone. This is NOT Temporary Event
          // Access -- that path explicitly clears this marker -- so it must
          // not be admitted from localStorage alone. Without auth.uid()
          // every identity-scoped RPC (get_my_attendee_record and the rest)
          // resolves to nothing, which is exactly the My Check-In
          // "no attendee record" dead-end this guard exists to prevent.
          // Invalidate the stale account identity/access state and route to
          // the clean sign-in path; re-authentication restores auth.uid()
          // and canonical attendee resolution with it.
          if (!mounted) {
            return;
          }
          setStatus("denied");
          clearMemberLocalState();
          router.replace("/member/login?sessionExpired=1");
          return;
        }

        // Member Workspace Continuity. The Guard consumes the SAME shared
        // attendee-identity state the admitted pages consume: a member is
        // only "allowed" once identityStatus is "resolved"; "resolving"
        // holds the checking state; "recovery_required" is routed to
        // explicit recovery here, never admitted into a null-identity
        // workspace. This closes the gap where legacy keys satisfied
        // hasLegacySession while useMemberWorkspace() had no usable
        // identity (a stale Event-A attendee id + a public Event-B context
        // can never be admitted as Event-B identity because MemberSession
        // -- the only identity source -- carries neither a coherent pair).
        if (workspace.identityStatus === "recovery_required") {
          if (!mounted) {
            return;
          }
          setStatus("denied");
          const { data: sessionData } = await supabase.auth.getSession();
          if (!mounted) {
            return;
          }
          clearMemberLocalState();
          router.replace(
            sessionData?.session
              ? "/member/account?contextInvalid=1"
              : "/member/login?sessionExpired=1",
          );
          return;
        }

        if (workspace.identityStatus === "resolving") {
          if (mounted) {
            setStatus("checking");
          }
          return;
        }

        if (workspace.isAccountSession === false) {
          // Temporary Event Access: localStorage presence plus a resolved
          // shared identity is sufficient (it holds no durable Person link
          // for governed established-context validation). identityStatus is
          // "resolved" here -- "resolving"/"recovery_required" returned
          // above.
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
          (workspace.contextStatus === "valid" ||
            workspace.contextStatus === "error") &&
          workspace.identityStatus === "resolved"
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
