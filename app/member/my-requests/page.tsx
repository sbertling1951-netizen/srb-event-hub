"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { supabase } from "@/lib/supabase";

type RequestVendorRow = {
  business_name: string | null;
};

type RequestRow = {
  id: string;
  site_number: string | null;
  requested_service: string | null;
  guest_count: number | null;
  request_notes: string | null;
  request_status: string | null;
  created_at: string | null;
  vendors?: RequestVendorRow | RequestVendorRow[] | null;
};

// Matches the governed GET /api/member/vendor-requests response row shape
// (app/api/member/vendor-requests/interpretVendorRequestRpcRows.ts) --
// flat vendor_business_name, not a nested `vendors` relation, since this
// Provider-shaped read goes through the RPC's own normalized columns, not
// a PostgREST embed. Only the fields this page actually renders are
// declared.
type VendorRequestApiRow = {
  id: string;
  vendor_business_name: string | null;
  requested_service: string | null;
  guest_count: number | null;
  request_notes: string | null;
  request_status: string | null;
  created_at: string | null;
  site_number: string | null;
};

export function toRequestRow(row: VendorRequestApiRow): RequestRow {
  return {
    id: row.id,
    site_number: row.site_number,
    requested_service: row.requested_service,
    guest_count: row.guest_count,
    request_notes: row.request_notes,
    request_status: row.request_status,
    created_at: row.created_at,
    vendors: { business_name: row.vendor_business_name },
  };
}

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
  // Distinguishes "haven't heard back yet" from "heard back with zero
  // requests" so the error banner and the "No requests yet." message
  // are mutually exclusive instead of both being independently keyed
  // off state that can coincide.
  const [loading, setLoading] = useState(true);

  const loadRequests = useCallback(async () => {
    try {
      setLoading(true);
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

      // Governed read boundary: GET /api/member/vendor-requests ->
      // public.get_my_vendor_service_requests, which independently
      // re-derives and verifies the caller's attendee identity via
      // resolve_temporary_or_authenticated_attendee. This page supplies
      // only the same operational evidence app/member/vendor-signup
      // /page.tsx already sends (event id/code, a registration
      // identifier) -- never a trusted ownership claim of its own -- and
      // performs no Person, Tenant, attendee, or ownership resolution
      // itself.
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      const params = new URLSearchParams({ eventId: event.id });
      if (event.event_code) {
        params.set("eventCode", event.event_code);
      }
      if (memberEmail) {
        params.set("registrationIdentifier", memberEmail);
      }

      const response = await fetch(
        `/api/member/vendor-requests?${params.toString()}`,
        accessToken
          ? { headers: { Authorization: `Bearer ${accessToken}` } }
          : undefined,
      );

      if (!response.ok) {
        // Covers invalid_session (identity could not be resolved) and
        // transient_error alike -- both are a failed read, never a
        // confirmed zero. The route's repaired boundary
        // (20260807150000_repair_governed_member_vendor_request_read_
        // boundary.sql) guarantees a resolver failure is never returned
        // as a 200 empty result.
        throw new Error("Could not load your requests.");
      }

      const payload = (await response.json()) as {
        status?: string;
        data?: VendorRequestApiRow[];
      };

      if (payload.status !== "resolved") {
        // Fail closed: a 2xx response that isn't the recognized
        // "resolved" shape is a protocol violation, never guessed at or
        // treated as a confirmed zero.
        throw new Error("Could not load your requests.");
      }

      const rows = (payload.data ?? []).map(toRequestRow);
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
    } finally {
      setLoading(false);
    }
  }, []);

  async function patchRequestStatus(id: string, nextStatus: "cancelled" | "new") {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    if (!accessToken) {
      throw new Error("Your session has expired. Please sign in again.");
    }

    const response = await fetch("/api/member/vendor-requests", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ requestId: id, nextStatus }),
    });

    if (!response.ok) {
      throw new Error(
        nextStatus === "cancelled"
          ? "Could not cancel your request."
          : "Could not restore your request.",
      );
    }
  }

  async function cancelRequest(id: string) {
    try {
      setError(null);
      await patchRequestStatus(id, "cancelled");

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
      await patchRequestStatus(id, "new");

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

        {!loading && error ? (
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

      {!loading && !error && requests.map((request) => {
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

      {!loading && !error && requests.length === 0 ? (
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
