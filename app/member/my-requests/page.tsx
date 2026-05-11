"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { supabase } from "@/lib/supabase";

type RequestVendorRow = {
  business_name: string | null;
};

type RequestRow = {
  id: string;
  event_id: string | null;
  requester_email: string | null;
  requester_name: string | null;
  requester_phone: string | null;
  site_number: string | null;
  requested_service: string | null;
  guest_count: number | null;
  request_notes: string | null;
  request_status: string | null;
  created_at: string | null;
  vendors?: RequestVendorRow | RequestVendorRow[] | null;
};

function statusBadgeStyle(status: string): React.CSSProperties {
  const normalized = status.toLowerCase();

  if (normalized === "completed") {
    return {
      background: "#dcfce7",
      color: "#166534",
      border: "1px solid #86efac",
    };
  }

  if (normalized === "contacted" || normalized === "confirmed") {
    return {
      background: "#dbeafe",
      color: "#1e3a8a",
      border: "1px solid #93c5fd",
    };
  }

  if (normalized === "cancelled") {
    return {
      background: "#fee2e2",
      color: "#7f1d1d",
      border: "1px solid #fecaca",
    };
  }

  return {
    background: "#fef9c3",
    color: "#713f12",
    border: "1px solid #fde68a",
  };
}

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString();
}

function statusMessage(status: string) {
  const normalized = status.toLowerCase();

  if (normalized === "completed") {
    return "The vendor marked this service request complete.";
  }

  if (normalized === "contacted" || normalized === "confirmed") {
    return "The vendor has acknowledged this request and should follow up with you.";
  }

  if (normalized === "cancelled") {
    return "You cancelled this request. Use Undo Cancel if you still need the service.";
  }

  return "Your request has been submitted and is waiting for vendor follow-up.";
}

export default function MyRequestsPage() {
  return (
    <MemberRouteGuard>
      <MyRequestsInner />
    </MemberRouteGuard>
  );
}

function MyRequestsInner() {
  const [memberName, setMemberName] = useState<string | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [status, setStatus] = useState("Loading your requests...");
  const [error, setError] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    try {
      setError(null);
      if (typeof window === "undefined") {
        setRequests([]);
        setStatus("No member session found.");
        return;
      }

      const rawEvent = localStorage.getItem("fcoc-member-event-context");
      const memberEmail = localStorage.getItem("fcoc-member-email");
      const name = localStorage.getItem("fcoc-member-name");

      setMemberName(name);

      if (!rawEvent || !memberEmail) {
        setRequests([]);
        setStatus("No member session found.");
        return;
      }

      const event = JSON.parse(rawEvent);

      if (!event?.id) {
        setRequests([]);
        setStatus("No event selected.");
        return;
      }

      const { data, error } = await supabase
        .from("vendor_service_requests")
        .select(
          `
          id,
          event_id,
          requester_email,
          requester_name,
          requester_phone,
          site_number,
          requested_service,
          guest_count,
          request_notes,
          request_status,
          created_at,
          vendors (
            business_name
          )
        `,
        )
        .eq("event_id", event.id)
        .eq("requester_email", memberEmail)
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      const rows = (data || []) as RequestRow[];
      setRequests(rows);
      setStatus(
        `Loaded ${rows.length} service request${rows.length === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      console.error("load member requests error:", err);
      setRequests([]);
      setError(
        err instanceof Error ? err.message : "Could not load your requests.",
      );
      setStatus("");
    }
  }, []);

  async function cancelRequest(id: string) {
    try {
      setError(null);
      const { error } = await supabase
        .from("vendor_service_requests")
        .update({ request_status: "cancelled" })
        .eq("id", id);

      if (error) {
        throw error;
      }

      setRequests((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, request_status: "cancelled" } : r,
        ),
      );
    } catch (err) {
      console.error("cancel request error:", err);
      setError(
        err instanceof Error ? err.message : "Could not cancel your request.",
      );
    }
  }

  async function undoCancelRequest(id: string) {
    try {
      setError(null);
      const { error } = await supabase
        .from("vendor_service_requests")
        .update({ request_status: "new" })
        .eq("id", id);

      if (error) {
        throw error;
      }

      setRequests((prev) =>
        prev.map((r) => (r.id === id ? { ...r, request_status: "new" } : r)),
      );
    } catch (err) {
      console.error("undo cancel request error:", err);
      setError(
        err instanceof Error ? err.message : "Could not restore your request.",
      );
    }
  }

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const activeCount = useMemo(() => {
    return requests.filter((request) => {
      const requestStatus = request.request_status || "new";
      return requestStatus !== "completed" && requestStatus !== "cancelled";
    }).length;
  }, [requests]);

  return (
    <div style={{ padding: 18, display: "grid", gap: 14 }}>
      <div
        className="card"
        style={{
          padding: 16,
          border: "1px solid #ddd",
          borderRadius: 12,
          background: "#fff",
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>My Requests</h1>
        {memberName ? (
          <div style={{ fontSize: 14, color: "#555" }}>
            {memberName}, here are your service requests.
          </div>
        ) : null}
        {status ? (
          <div style={{ marginTop: 6, fontSize: 14, color: "#555" }}>
            {status}
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            style={{
              marginTop: 10,
              padding: 12,
              borderRadius: 10,
              border: "1px solid #fecaca",
              background: "#fef2f2",
              color: "#991b1b",
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        ) : null}
        {activeCount > 0 ? (
          <div style={{ marginTop: 6, fontWeight: 800 }}>
            Active requests: {activeCount}
          </div>
        ) : null}
      </div>

      {requests.map((request) => {
        const vendor = Array.isArray(request.vendors)
          ? request.vendors[0]
          : request.vendors;
        const requestStatus = request.request_status || "new";

        return (
          <div
            key={request.id}
            className="card"
            style={{
              padding: 16,
              border: "1px solid #ddd",
              borderRadius: 12,
              background: "#fff",
              display: "grid",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 18 }}>
                {vendor?.business_name || "Vendor"}
              </div>
              <div
                style={{
                  padding: "4px 9px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 900,
                  textTransform: "uppercase",
                  ...statusBadgeStyle(requestStatus),
                }}
              >
                {requestStatus}
              </div>
            </div>

            <div
              style={{
                padding: "9px 10px",
                borderRadius: 10,
                background: "#f8fafc",
                border: "1px solid #e5e7eb",
                fontSize: 13,
                color: "#374151",
              }}
            >
              <strong>Vendor response:</strong> {statusMessage(requestStatus)}
            </div>

            <div>
              <strong>Service:</strong> {request.requested_service || "—"}
            </div>
            <div>
              <strong>Site:</strong> {request.site_number || "—"}
            </div>
            <div>
              <strong>Party:</strong> {request.guest_count || 0}
            </div>
            {request.request_notes ? (
              <div>
                <strong>Notes:</strong> {request.request_notes}
              </div>
            ) : null}
            <div style={{ fontSize: 12, color: "#666" }}>
              Submitted: {formatDate(request.created_at)}
            </div>
            {requestStatus !== "completed" && requestStatus !== "cancelled" ? (
              <button
                type="button"
                onClick={() => void cancelRequest(request.id)}
                style={{
                  marginTop: 8,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #ef4444",
                  background: "#fee2e2",
                  color: "#7f1d1d",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Cancel Request
              </button>
            ) : requestStatus === "cancelled" ? (
              <button
                type="button"
                onClick={() => void undoCancelRequest(request.id)}
                style={{
                  marginTop: 8,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #2563eb",
                  background: "#dbeafe",
                  color: "#1e3a8a",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Undo Cancel
              </button>
            ) : null}
          </div>
        );
      })}

      {requests.length === 0 ? (
        <div
          className="card"
          style={{
            padding: 16,
            border: "1px solid #ddd",
            borderRadius: 12,
            background: "#fff",
          }}
        >
          No requests yet.
        </div>
      ) : null}
    </div>
  );
}
