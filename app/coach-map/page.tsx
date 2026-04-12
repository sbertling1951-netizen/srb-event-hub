"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import MemberRouteGuard from "@/components/auth/MemberRouteGuard";

function CoachMapPageInner() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/coach-map/public");
  }, [router]);

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 16,
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
