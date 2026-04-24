"use client";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { getAdminEvent } from "@/lib/getAdminEvent";
import { supabase } from "@/lib/supabase";

export default function ExportPage() {
  return (
    <AdminRouteGuard requiredPermission="can_export_reports">
      <ExportPageInner />
    </AdminRouteGuard>
  );
}

function ExportPageInner() {
  async function exportAttendees() {
    console.log("Starting attendee export...");
    const adminEvent = getAdminEvent();

    if (!adminEvent?.id) {
      alert(
        "No admin event selected. Choose one on the Admin Dashboard first.",
      );
      return;
    }

    const { data, error } = await supabase
      .from("attendees")
      .select("*")
      .eq("event_id", adminEvent.id)
      .order("pilot_last", { ascending: true })
      .order("pilot_first", { ascending: true });

    if (error) {
      alert(`Could not export attendees: ${error.message}`);
      return;
    }

    if (!data || data.length === 0) {
      alert("No attendees found for the selected event.");
      return;
    }

    const headers = Object.keys(data[0]);
    const csv = [
      headers.join(","),
      ...data.map((row) =>
        headers
          .map((key) => {
            const value = row[key as keyof typeof row];
            if (value === null || value === undefined) {return "";}
            const text = String(value).replace(/"/g, '""');
            return /[",\n]/.test(text) ? `"${text}"` : text;
          })
          .join(","),
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    const safeName = (adminEvent.name || "event")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const date = new Date().toISOString().slice(0, 10);
    a.download = `${safeName}-attendees-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Export</h1>
      <button type="button" onClick={exportAttendees}>
        Export Attendees
      </button>
    </div>
  );
}
