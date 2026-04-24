"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";

function AdminDataReviewPageInner() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/attendees?tab=attendees&mode=review");
  }, [router]);

  return (
    <div className="card" style={{ padding: 18 }}>
      <h1 style={{ marginTop: 0, marginBottom: 8 }}>Data Review</h1>
      <div style={{ fontSize: 14, opacity: 0.8 }}>
        Opening the merged Attendee Management review queue...
      </div>
    </div>
  );
}

export default function AdminDataReviewPage() {
  return (
    <AdminRouteGuard requiredPermission="can_edit_attendees">
      <AdminDataReviewPageInner />
    </AdminRouteGuard>
  );
}
