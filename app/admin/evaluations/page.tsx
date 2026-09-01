"use client";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";

import { AdminEvaluationsClient } from "./AdminEvaluationsClient";

export default function AdminEvaluationsPage() {
  return (
    <AdminRouteGuard requiredTask="event.reports.view">
      <AdminShellAdapter
        pageTitle="Evaluations"
        pageSubtitle="Build tenant evaluation templates, assign them to the event or to individual agenda items, and review results."
      >
        <AdminEvaluationsClient />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}
