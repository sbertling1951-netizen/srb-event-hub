"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";

function CoachMapPageInner() {
  const router = useRouter();

  // This stub only redirects to /coach-map/public. Its former
  // "coach_map_view" engagement log read the retired attendee-id key from
  // sessionStorage (never written there — the log never fired); per M2 the
  // dead read is removed and the telemetry gap is accepted (not relocated).
  useEffect(() => {
    router.replace("/coach-map/public");
  }, [router]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
        background: "#f9fafb",
      }}
    >
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: "10px 14px",
          fontSize: 14,
        }}
      >
        Opening coach map...
      </div>
    </div>
  );
}

export default function CoachMapPage() {
  return (
    <MemberRouteGuard>
      <CoachMapPageInner />
    </MemberRouteGuard>
  );
}
