"use client";

import { useCallback, useEffect, useState } from "react";

import VendorWorkspaceShell from "@/components/vendor/VendorWorkspaceShell";

type EventDetails = { name: string | null };

type RequestRow = {
  id: string;
  event_id: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  site_number: string | null;
  requested_service: string | null;
  guest_count: number | null;
  request_notes: string | null;
  preferred_response_method: string | null;
  request_status: string | null;
  created_at: string | null;
  events: EventDetails | EventDetails[] | null;
};

type RequestsPayload = {
  ok: boolean;
  error?: string;
  requests?: RequestRow[];
  openCount?: number;
};

function getEventDetails(value: RequestRow["events"]): EventDetails | null {
  if (Array.isArray(value)) {
    return value[0] || null;
  }
  return value;
}

function formatDate(value: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString();
}

export default function VendorWorkspaceRequestsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<RequestsPayload | null>(null);

  const loadRequests = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/vendor/workspace/requests", {
        method: "GET",
        credentials: "include",
      });

      const data = (await response.json()) as RequestsPayload;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not load requests.");
      }

      setPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load requests.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const requests = payload?.requests || [];

  return (
    <VendorWorkspaceShell title="Requests">
      {loading ? (
        <div>Loading requests...</div>
      ) : error ? (
        <div style={{ color: "#991b1b", fontWeight: 700 }}>{error}</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ fontSize: 14, color: "#555" }}>
            Open requests: <strong>{payload?.openCount ?? 0}</strong>. This
            list is read-only; requests are managed by event staff.
          </div>

          {requests.length === 0 ? (
            <div style={{ color: "#555" }}>No requests yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {requests.map((request) => {
                const event = getEventDetails(request.events);
                return (
                  <div
                    key={request.id}
                    className="app-card-section-muted"
                    style={{ display: "grid", gap: 4 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <strong>{request.requested_service || "Service request"}</strong>
                      <span>{request.request_status || "new"}</span>
                    </div>
                    {event?.name ? <div style={{ fontSize: 13, color: "#555" }}>{event.name}</div> : null}
                    <div style={{ fontSize: 13, color: "#555" }}>
                      {request.requester_name || "Unknown requester"}
                      {request.site_number ? ` · Site ${request.site_number}` : ""}
                      {request.guest_count ? ` · ${request.guest_count} guests` : ""}
                    </div>
                    {request.request_notes ? (
                      <div style={{ fontSize: 13 }}>{request.request_notes}</div>
                    ) : null}
                    <div style={{ fontSize: 12, color: "#777" }}>
                      {[request.requester_email, request.requester_phone]
                        .filter(Boolean)
                        .join(" · ")}
                      {request.created_at ? ` · ${formatDate(request.created_at)}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </VendorWorkspaceShell>
  );
}
