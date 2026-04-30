"use client";

import { useRouter } from "next/navigation";
import type React from "react";
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
    function verifyMember() {
      try {
        const mode = localStorage.getItem("fcoc-user-mode");
        if (mode !== "member") {
          setStatus("denied");
          router.replace("/");
          return;
        }

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
        {
        }

        setStatus("denied");
        router.replace("/member/login");
      } catch (err) {
        console.error("MemberRouteGuard error:", err);
        setStatus("denied");
        router.replace("/member/login");
      }
    }

    verifyMember();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-member-event-context" ||
        e.key === "fcoc-member-event-changed" ||
        e.key === "fcoc-user-mode" ||
        e.key === "fcoc-user-mode-changed"
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
