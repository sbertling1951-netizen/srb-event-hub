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
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { supabase } from "@/lib/supabase";

export default function MemberRouteGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
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

      if (mode === "member" && hasIdentity && hasEvent) {
        setStatus("allowed");
      }
    } catch {
      // Fall through to the normal verification effect.
    }
  }, []);

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

        // Decision order:
        // 1. A valid legacy selected-event session allows the workspace.
        if (hasLegacySession) {
          if (mounted) {
            setStatus("allowed");
          }
          return;
        }

        // 2. No selected-event session, but a valid authenticated
        // Supabase account -- send to the account picker to choose (or
        // re-enter) an event, not back into an incomplete workspace and
        // not into a loop through "/".
        const { data: sessionData } = await supabase.auth.getSession();
        if (!mounted) {
          return;
        }

        setStatus("denied");

        // 3. Neither a selected event nor an authenticated account.
        router.replace(
          sessionData?.session ? "/member/account" : "/member/login",
        );
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
  }, [router]);

  if (status === "checking") {
    return <div style={{ padding: 24 }}>Checking member access...</div>;
  }

  if (status === "denied") {
    return <div style={{ padding: 24 }}>Redirecting...</div>;
  }

  return <>{children}</>;
}
