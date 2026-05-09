"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function DataReviewRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/attendees?view=review");
  }, [router]);

  return (
    <main style={{ padding: 24 }}>
      <h1>Opening Attendee Workbench…</h1>
      <p>Data Review has been merged into Attendee Management.</p>
    </main>
  );
}
