"use client";

import { useEffect, useState } from "react";
import {
  clearMemberSession,
  getMemberSession,
  isMemberSessionExpired,
} from "@/lib/memberSession";

type Props = {
  children: React.ReactNode;
};

export default function MemberRouteGuard({ children }: Props) {
  const [allowed, setAllowed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const session = getMemberSession();

    if (!session || isMemberSessionExpired(session)) {
      clearMemberSession();
      window.location.href = "/member/login";
      return;
    }

    setAllowed(true);
    setChecking(false);
  }, []);

  if (checking && !allowed) {
    return (
      <div style={{ padding: 24 }}>
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 18,
          }}
        >
          Checking member access...
        </div>
      </div>
    );
  }

  if (!allowed) return null;

  return <>{children}</>;
}
