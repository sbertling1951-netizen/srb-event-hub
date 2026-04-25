"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function DataReviewRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/attendees?tab=attendees&mode=review");
  }, [router]);

  return (
    <div className="card" style={{ padding: 18 }}>
      <h1 style={{ marginTop: 0, marginBottom: 8 }}>Data Review Moved</h1>
      <div style={{ fontSize: 14, opacity: 0.8 }}>
        Data Review is now part of Attendee Management. Redirecting to the
        unified attendee workbench...
      </div>
    </div>
  );
}
