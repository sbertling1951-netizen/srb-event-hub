"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  getCurrentMemberEvent,
  getStoredMemberAttendeeId,
  getStoredMemberHasArrived,
} from "@/lib/getCurrentMemberEvent";
import { getStoredUserMode } from "@/lib/getCurrentMemberEvent";
import { supabase } from "@/lib/supabase";
import { getTenantLabel } from "@/lib/tenantLabels";

export default function HomePage() {
  const [checked, setChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const router = useRouter();
  const appTitle = getTenantLabel("app_title");
  const welcomeMessage = getTenantLabel("welcome_message");
  const memberLoginLabel = getTenantLabel("member_login_label");
  const adminLoginLabel = getTenantLabel("admin_login_label");

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
          localStorage.removeItem("fcoc-user-mode");
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
    const links = [
      { href: "/member/login", label: memberLoginLabel },
      { href: "/admin/login", label: adminLoginLabel },
    ];

    return (
      <div style={{ padding: 30, maxWidth: 700, margin: "0 auto" }}>
        <h1 style={{ marginTop: 0 }}>{appTitle}</h1>

        <p>{welcomeMessage}</p>

        <div
          style={{
            display: "grid",
            gap: 14,
            marginTop: 20,
          }}
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href as Route}
              style={{
                display: "block",
                padding: "16px 18px",
                border: "1px solid #ddd",
                borderRadius: 10,
                textDecoration: "none",
                color: "#111",
                background: "white",
                fontWeight: 700,
                textAlign: "center",
              }}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return null;
}
