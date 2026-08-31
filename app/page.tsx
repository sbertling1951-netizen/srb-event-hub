"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { LoginSelector } from "@/components/auth/LoginSelector";
import {
  getCurrentMemberEvent,
  getStoredMemberAttendeeId,
  getStoredMemberHasArrived,
} from "@/lib/getCurrentMemberEvent";
import { getStoredUserMode } from "@/lib/getCurrentMemberEvent";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { supabase } from "@/lib/supabase";

export default function HomePage() {
  const [checked, setChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const router = useRouter();

  useEffect(() => {
    async function run() {
      try {
        // 🔥 REAL AUTH CHECK (fixes ghost admin issue)
        console.log("A: before getUser");
        const {
          data: { user },
        } = await supabase.auth.getUser();
        console.log("B: after getUser", user);

        console.log("C: before getStoredUserMode");
        const mode = getStoredUserMode();

        // 🚨 If no real session, kill fake admin mode
        if (!user && mode === "admin") {
          localStorage.removeItem(STORAGE_KEYS.userMode);
        }

        // ✅ Only redirect to admin if session is REAL
        if (user && mode === "admin") {
          router.replace("/admin/dashboard");
          return;
        }

        console.log("D: before member session reads");
        const attendeeId = getStoredMemberAttendeeId();
        const memberEvent = getCurrentMemberEvent();
        const hasArrived = getStoredMemberHasArrived();

        const sessionExists = !!memberEvent;

        if (sessionExists) {
          setHasSession(true);

          if (attendeeId && hasArrived === "true") {
            router.replace("/member");
          } else {
            router.replace("/member/checkin");
          }

          return;
        }

        // No legacy selected-event session. An already authenticated
        // Supabase account still goes straight to the account picker --
        // never back through /member/login -- so it can choose (or
        // re-enter) an event. Only a visitor with no authenticated
        // account at all sees the sign-in links below.
        if (user) {
          router.replace("/member/account");
          return;
        }

        setHasSession(false);
      } catch (err) {
        console.error("Home redirect error:", err);
        setHasSession(false);
      } finally {
        console.log("E: finally reached");
        setChecked(true);
      }
    }

    run();
  }, [router]);

  if (!checked) {
    return <div style={{ padding: 30 }}>Loading...</div>;
  }

  if (!hasSession) {
    return <LoginSelector />;
  }

  return null;
}
