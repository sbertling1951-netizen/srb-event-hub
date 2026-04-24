"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function MemberRouteGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "allowed" | "denied">(
    "checking",
  );

  useEffect(() => {
    try {
      const attendeeId = localStorage.getItem("fcoc-member-attendee-id");
      const entryId = localStorage.getItem("fcoc-member-entry-id");
      const email = localStorage.getItem("fcoc-member-email");
      const eventContext = localStorage.getItem("fcoc-member-event-context");

      const hasIdentity = !!(attendeeId || entryId || email);
      const hasEvent = !!eventContext;

      if (hasIdentity && hasEvent) {
        setStatus("allowed");
        return;
      }

      setStatus("denied");
      router.replace("/member/login");
    } catch (err) {
      console.error("MemberRouteGuard error:", err);
      setStatus("denied");
      router.replace("/member/login");
    }
  }, [router]);

  if (status === "checking") {
    return <div style={{ padding: 24 }}>Checking member access...</div>;
  }

  if (status === "denied") {
    return <div style={{ padding: 24 }}>Redirecting to member login...</div>;
  }

  return <>{children}</>;
}
