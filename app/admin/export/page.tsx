"use client";

import { supabase } from "@/lib/supabase";
import { getAdminEvent } from "@/lib/getAdminEvent";

export default function ExportPage() {
  async function exportAttendees() {
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
      .eq("event_id", adminEvent.id);

    if (error) {
      alert(`Could not export attendees: ${error.message}`);
      return;
    }

    if (!data || data.length === 0) {
      alert("No attendees found for the selected event.");
      return;
    }

    const csv = [
      Object.keys(data[0]).join(","),
      ...data.map((row) =>
        Object.values(row)
          .map((value) => {
            if (value === null || value === undefined) return "";
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
    a.download = "attendees.csv";
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
