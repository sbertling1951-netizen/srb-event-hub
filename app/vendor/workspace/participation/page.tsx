"use client";

import { useEffect, useState } from "react";

import VendorWorkspaceShell from "@/components/vendor/VendorWorkspaceShell";

type ParticipationRow = {
  id: string;
  event_id: string | null;
  status: string | null;
  action_type: string | null;
  allow_service_requests: boolean;
  is_visible_to_members: boolean | null;
  display_order: number | null;
  event_note: string | null;
  signup_url: string | null;
  events?:
    | {
        id: string;
        name: string | null;
        location: string | null;
        start_date: string | null;
        end_date: string | null;
      }
    | {
        id: string;
        name: string | null;
        location: string | null;
        start_date: string | null;
        end_date: string | null;
      }[]
    | null;
};

type ParticipationPayload = {
  ok: boolean;
  error?: string;
  participationRows?: ParticipationRow[];
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] || null;
  }
  return value || null;
}

function formatDateRange(start: string | null, end: string | null) {
  if (!start && !end) {
    return "Date not set";
  }

  const startText = start ? new Date(start).toLocaleDateString() : "";
  const endText = end ? new Date(end).toLocaleDateString() : "";

  if (startText && endText) {
    return `${startText} - ${endText}`;
  }

  return startText || endText;
}

export default function VendorWorkspaceParticipationPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ParticipationRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch("/api/vendor/workspace/summary", {
          method: "GET",
          credentials: "include",
        });

        const payload = (await response.json()) as ParticipationPayload;

        if (!response.ok || !payload.ok) {
          throw new Error(
            payload.error || "Could not load event participation.",
          );
        }

        if (!cancelled) {
          setRows(payload.participationRows || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load event participation.",
          );
          setRows([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <VendorWorkspaceShell title="Event Participation">
      {loading ? (
        <div>Loading participation records...</div>
      ) : error ? (
        <div style={{ color: "#991b1b", fontWeight: 700 }}>{error}</div>
      ) : rows.length === 0 ? (
        <div>No event participation records exist yet for this vendor.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ color: "#555", fontSize: 14 }}>
            This page is read-only. Event participation approval and publication
            remain administrator-controlled.
          </div>

          {rows.map((row) => {
            const event = firstRelation(row.events);

            return (
              <div
                key={row.id}
                className="app-card-section-muted"
                style={{ display: "grid", gap: 4 }}
              >
                <div style={{ fontWeight: 800 }}>{event?.name || "Event"}</div>
                <div>Location: {event?.location || "—"}</div>
                <div>
                  Dates:{" "}
                  {formatDateRange(
                    event?.start_date || null,
                    event?.end_date || null,
                  )}
                </div>
                <div>Status: {row.status || "assigned"}</div>
                <div>Action Type: {row.action_type || "service_request"}</div>
                <div>
                  Visible to members:{" "}
                  {row.is_visible_to_members === false ? "No" : "Yes"}
                </div>
                <div>
                  Service requests enabled:{" "}
                  {row.allow_service_requests ? "Yes" : "No"}
                </div>
                <div>Display order: {row.display_order ?? 100}</div>
                <div>Event note: {row.event_note || "—"}</div>
                <div>Signup URL: {row.signup_url || "—"}</div>
              </div>
            );
          })}
        </div>
      )}
    </VendorWorkspaceShell>
  );
}
