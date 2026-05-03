"use client";

import { useEffect, useMemo, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { getAdminEvent } from "@/lib/getAdminEvent";
import { supabase } from "@/lib/supabase";

type RequestRow = {
  id: string;
  vendor_id: string | null;
  attendee_id: string | null;
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
  attendees?:
    | {
        assigned_site: string | null;
      }
    | {
        assigned_site: string | null;
      }[]
    | null;
  vendors?:
    | {
        business_name: string | null;
        email: string | null;
        phone: string | null;
      }
    | {
        business_name: string | null;
        email: string | null;
        phone: string | null;
      }[]
    | null;
};

function csvEscape(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function currentSiteForRequest(request: RequestRow) {
  const attendee = Array.isArray(request.attendees)
    ? request.attendees[0]
    : request.attendees;

  return attendee?.assigned_site || request.site_number || "";
}

function phoneHref(value: string | null) {
  const digits = (value || "").replace(/\D+/g, "");
  return digits ? `tel:${digits}` : "";
}

function emailHref(value: string | null) {
  const email = (value || "").trim();
  return email ? `mailto:${email}` : "";
}

function vendorEmailHref(request: RequestRow) {
  const vendor = Array.isArray(request.vendors)
    ? request.vendors[0]
    : request.vendors;
  const vendorEmail = vendor?.email?.trim();

  if (!vendorEmail) {
    return "";
  }

  const vendorName = vendor?.business_name || "Vendor";
  const site = currentSiteForRequest(request) || "Not provided";
  const subject = `Vendor Service Request - ${request.requester_name || "FCOC Member"}`;

  const body = [
    `Hello ${vendorName},`,
    "",
    "A vendor service request was submitted through the FCOC Event Hub.",
    "",
    `Name: ${request.requester_name || ""}`,
    `Site: ${site}`,
    `Phone: ${request.requester_phone || ""}`,
    `Email: ${request.requester_email || ""}`,
    `Service: ${request.requested_service || ""}`,
    `Party Count: ${request.guest_count || 0}`,
    `Preferred response: ${request.preferred_response_method || ""}`,
    "",
    "Notes:",
    request.request_notes || "",
    "",
    "Please contact the member directly to follow up.",
  ].join("\n");

  return `mailto:${vendorEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function vendorForRequest(request: RequestRow) {
  return Array.isArray(request.vendors) ? request.vendors[0] : request.vendors;
}

function vendorNameForRequest(request: RequestRow) {
  return vendorForRequest(request)?.business_name || "Unassigned Vendor";
}

function vendorPhoneForRequest(request: RequestRow) {
  return vendorForRequest(request)?.phone || "";
}

function safeFileName(value: string) {
  return String(value || "vendor")
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function requestSummaryLine(request: RequestRow, index: number) {
  const site = currentSiteForRequest(request) || "Not provided";

  return [
    `${index + 1}. ${request.requester_name || "Unnamed"}`,
    `Site: ${site}`,
    `Phone: ${request.requester_phone || ""}`,
    `Email: ${request.requester_email || ""}`,
    `Service: ${request.requested_service || ""}`,
    `Party Count: ${request.guest_count || 0}`,
    `Status: ${request.request_status || "new"}`,
    request.request_notes ? `Notes: ${request.request_notes}` : "Notes: —",
  ].join("\n");
}

function vendorSummaryText(vendorName: string, requests: RequestRow[]) {
  return [
    `${vendorName} Service Requests`,
    "",
    ...requests.map((request, index) => requestSummaryLine(request, index)),
  ].join("\n\n");
}

function smsHref(phone: string | null, body: string) {
  const digits = String(phone || "").replace(/\D+/g, "");

  if (!digits) {
    return "";
  }

  return `sms:${digits}?body=${encodeURIComponent(body)}`;
}

function openParkingMapForSite(siteNumber: string | null) {
  const site = (siteNumber || "").trim();

  if (site) {
    localStorage.setItem("fcoc-parking-focus-site", site);
  }

  window.location.href = "/admin/parking";
}

export default function VendorRequestsPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_events">
      <VendorRequestsInner />
    </AdminRouteGuard>
  );
}

function VendorRequestsInner() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [status, setStatus] = useState("Loading...");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function loadRequests() {
    const event = getAdminEvent();

    if (!event?.id) {
      setStatus("No admin event selected.");
      setRequests([]);
      return;
    }

    const { data, error } = await supabase
      .from("vendor_service_requests")
      .select(
        `
        id,
        vendor_id,
        attendee_id,
        requester_name,
        requester_email,
        requester_phone,
        site_number,
        requested_service,
        guest_count,
        request_notes,
        preferred_response_method,
        request_status,
        created_at,
        attendees (
          assigned_site
        ),
        vendors (
          business_name,
          email,
          phone
        )
      `,
      )
      .eq("event_id", event.id)
      .order("created_at", { ascending: false });

    if (error) {
      setStatus(error.message);
      return;
    }

    setRequests((data || []) as RequestRow[]);
    setStatus(`Loaded ${(data || []).length} vendor requests.`);
  }

  useEffect(() => {
    void loadRequests();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return requests.filter((r) => {
      if (filter !== "all" && (r.request_status || "new") !== filter) {
        return false;
      }

      if (!q) {
        return true;
      }

      const vendor = Array.isArray(r.vendors) ? r.vendors[0] : r.vendors;

      return [
        vendor?.business_name,
        r.requester_name,
        r.requester_email,
        r.requester_phone,
        currentSiteForRequest(r),
        r.requested_service,
        r.request_notes,
        r.request_status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [requests, search, filter]);

  const totalGuests = filtered.reduce(
    (sum, r) => sum + Number(r.guest_count || 0),
    0,
  );

  const groupedRequests = useMemo(() => {
    const map = new Map<string, RequestRow[]>();

    filtered.forEach((request) => {
      const name = vendorNameForRequest(request);
      const existing = map.get(name) || [];
      existing.push(request);
      map.set(name, existing);
    });

    return Array.from(map.entries()).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [filtered]);

  async function updateStatus(id: string, nextStatus: string) {
    setUpdatingId(id);

    const { error } = await supabase
      .from("vendor_service_requests")
      .update({ request_status: nextStatus })
      .eq("id", id);

    setUpdatingId(null);

    if (error) {
      setStatus(error.message);
      return;
    }

    setRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, request_status: nextStatus } : r)),
    );

    setStatus("Request status updated.");
  }

  function exportCsv() {
    const rows = [
      [
        "Created",
        "Vendor",
        "Name",
        "Service",
        "Guests",
        "Site",
        "Phone",
        "Email",
        "Notes",
        "Status",
      ],
      ...filtered.map((r) => [
        r.created_at || "",
        (Array.isArray(r.vendors) ? r.vendors[0] : r.vendors)?.business_name ||
          "",
        r.requester_name || "",
        r.requested_service || "",
        r.guest_count || 0,
        currentSiteForRequest(r),
        r.requester_phone || "",
        r.requester_email || "",
        r.request_notes || "",
        r.request_status || "new",
      ]),
    ];

    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "vendor-requests.csv";
    a.click();

    URL.revokeObjectURL(url);
  }

  function exportVendorCsv(vendorName: string, vendorRequests: RequestRow[]) {
    const rows = [
      [
        "Created",
        "Vendor",
        "Name",
        "Service",
        "Guests",
        "Site",
        "Phone",
        "Email",
        "Notes",
        "Status",
      ],
      ...vendorRequests.map((r) => [
        r.created_at || "",
        vendorName,
        r.requester_name || "",
        r.requested_service || "",
        r.guest_count || 0,
        currentSiteForRequest(r),
        r.requester_phone || "",
        r.requester_email || "",
        r.request_notes || "",
        r.request_status || "new",
      ]),
    ];

    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeFileName(vendorName)}-requests.csv`;
    a.click();

    URL.revokeObjectURL(url);
  }

  async function copyVendorSummary(
    vendorName: string,
    vendorRequests: RequestRow[],
  ) {
    const summary = vendorSummaryText(vendorName, vendorRequests);

    try {
      await navigator.clipboard.writeText(summary);
      setStatus(`Copied ${vendorName} request summary.`);
    } catch (err) {
      console.error("copyVendorSummary error:", err);
      setStatus(
        "Could not copy summary. Your browser may not allow clipboard access.",
      );
    }
  }

  return (
    <div style={{ padding: 24, display: "grid", gap: 16 }}>
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0 }}>Vendor Requests</h1>
        <div style={{ fontSize: 14, opacity: 0.8 }}>{status}</div>
      </div>

      <div
        className="card"
        style={{
          padding: 18,
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          alignItems: "end",
        }}
      >
        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Search</div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, vendor, site, phone, service..."
            style={{ width: "100%", padding: 10 }}
          />
        </label>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Status</div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: "100%", padding: 10 }}
          >
            <option value="all">All</option>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>

        <button type="button" onClick={() => void loadRequests()}>
          Refresh
        </button>

        <button
          type="button"
          onClick={exportCsv}
          disabled={filtered.length === 0}
        >
          Export CSV
        </button>
      </div>

      <div style={{ fontWeight: 700 }}>
        Showing {filtered.length} request{filtered.length === 1 ? "" : "s"} •
        Total party count: {totalGuests}
      </div>

      {groupedRequests.length > 0 ? (
        <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>
            Vendor Dispatch Lists
          </div>
          <div style={{ fontSize: 13, color: "#555" }}>
            Export, copy, or text a vendor-specific request list.
          </div>

          {groupedRequests.map(([vendorName, vendorRequests]) => {
            const firstRequest = vendorRequests[0];
            const vendorPhone = firstRequest
              ? vendorPhoneForRequest(firstRequest)
              : "";
            const summary = vendorSummaryText(vendorName, vendorRequests);
            const textLink = smsHref(vendorPhone, summary);

            return (
              <div
                key={vendorName}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  background: "#f8fafc",
                  padding: 12,
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
                  <div>
                    <div style={{ fontWeight: 800 }}>{vendorName}</div>
                    <div style={{ fontSize: 13, color: "#555" }}>
                      {vendorRequests.length} request
                      {vendorRequests.length === 1 ? "" : "s"}
                      {vendorPhone ? ` • ${vendorPhone}` : ""}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() =>
                        exportVendorCsv(vendorName, vendorRequests)
                      }
                    >
                      Export Vendor CSV
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void copyVendorSummary(vendorName, vendorRequests)
                      }
                    >
                      Copy Summary
                    </button>

                    {textLink ? (
                      <a href={textLink} style={primaryButtonStyle}>
                        Text Vendor
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {filtered.map((r) => (
        <div
          key={r.id}
          className="card"
          style={{
            padding: 16,
            border: "1px solid #ddd",
            borderRadius: 12,
            background: "white",
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 18 }}>
            {r.requester_name || "Unnamed"}
          </div>

          <div>
            <strong>Vendor:</strong>{" "}
            {(Array.isArray(r.vendors) ? r.vendors[0] : r.vendors)
              ?.business_name || "—"}
          </div>
          <div>
            <strong>Service:</strong> {r.requested_service || "—"}
          </div>
          <div>
            <strong>Party:</strong> {r.guest_count || 0}
          </div>
          <div>
            <strong>Current Site:</strong> {currentSiteForRequest(r) || "—"}
            {r.site_number && r.site_number !== currentSiteForRequest(r) ? (
              <span style={{ color: "#666" }}> (was {r.site_number})</span>
            ) : null}
          </div>
          <div>
            <strong>Phone:</strong> {r.requester_phone || "—"}
          </div>
          <div>
            <strong>Email:</strong> {r.requester_email || "—"}
          </div>
          <div>
            <strong>Preferred:</strong> {r.preferred_response_method || "—"}
          </div>
          <div>
            <strong>Notes:</strong> {r.request_notes || "—"}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {r.requester_phone ? (
              <a
                href={phoneHref(r.requester_phone)}
                style={secondaryButtonStyle}
              >
                Call Member
              </a>
            ) : null}

            {r.requester_email ? (
              <a
                href={emailHref(r.requester_email)}
                style={secondaryButtonStyle}
              >
                Email Member
              </a>
            ) : null}

            {vendorEmailHref(r) ? (
              <a href={vendorEmailHref(r)} style={primaryButtonStyle}>
                Email Vendor
              </a>
            ) : null}

            <button
              type="button"
              onClick={() => openParkingMapForSite(currentSiteForRequest(r))}
              disabled={!currentSiteForRequest(r)}
            >
              Show Current Site on Map
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["new", "contacted", "confirmed", "completed", "cancelled"].map(
              (s) => (
                <button
                  key={s}
                  type="button"
                  disabled={
                    updatingId === r.id || (r.request_status || "new") === s
                  }
                  onClick={() => void updateStatus(r.id, s)}
                >
                  {s}
                </button>
              ),
            )}
          </div>
        </div>
      ))}

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: 16 }}>
          No vendor requests found.
        </div>
      ) : null}
    </div>
  );
}

const secondaryButtonStyle = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid #ccc",
  background: "white",
  color: "#111827",
  textDecoration: "none",
  fontWeight: 700,
};

const primaryButtonStyle = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid #0b5cff",
  background: "#0b5cff",
  color: "white",
  textDecoration: "none",
  fontWeight: 700,
};
