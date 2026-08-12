"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";

export default function DataReviewRedirectPage() {
  return (
    <AdminShellAdapter pageTitle="Data Review">
      <DataReviewRedirectPageContent />
    </AdminShellAdapter>
  );
}

function DataReviewRedirectPageContent() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/attendees?view=review");
  }, [router]);

  return (
    <div style={{ padding: 24 }}>
      <h1>Opening Attendee Workbench…</h1>
      <p>Data Review has been merged into Attendee Management.</p>
    </div>
  );
}
