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

    function verifyMember() {
      try {
        const mode = getStoredUserMode();
        if (mode !== "member") {
          if (mounted) {
            setStatus("denied");
          }
          router.replace("/");
          return;
        }

        const attendeeId = getStoredMemberAttendeeId();
        const entryId = getStoredMemberEntryId();
        const email = getStoredMemberEmail();
        const memberEvent = getCurrentMemberEvent();

        const hasIdentity = !!(attendeeId || entryId || email);
        const hasEvent = !!memberEvent;

        if (hasIdentity && hasEvent) {
          if (mounted) {
            setStatus("allowed");
          }
          return;
        }

        if (mounted) {
          setStatus("denied");
        }
        router.replace("/member/login");
      } catch (err) {
        console.error("MemberRouteGuard error:", err);
        if (mounted) {
          setStatus("denied");
        }
        router.replace("/member/login");
      }
    }

    verifyMember();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === STORAGE_KEYS.memberEventContext ||
        e.key === STORAGE_KEYS.memberEventChanged ||
        e.key === STORAGE_KEYS.userMode ||
        e.key === STORAGE_KEYS.userModeChanged
      ) {
        verifyMember();
      }
    }

    function handlePageShow() {
      verifyMember();
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
    return <div style={{ padding: 24 }}>Redirecting to member login...</div>;
  }

  return <>{children}</>;
}
