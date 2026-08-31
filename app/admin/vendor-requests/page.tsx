"use client";

import { useEffect, useMemo, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useShellInterfaceCapabilities } from "@/components/shell/useShellViewport";
import { Alert, type AlertTone } from "@/components/ui/Alert";
import { AppButton, AppLinkButton } from "@/components/ui/AppButton";
import { DataTable, ResponsiveList } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormActions } from "@/components/ui/FormActions";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { RowActions } from "@/components/ui/RowActions";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/StatusBadge";
import { SearchField, TableToolbar, TableToolbarPrimaryRow } from "@/components/ui/TableToolbar";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { copyTextToClipboard } from "@/lib/copyTextToClipboard";
import { STORAGE_KEYS } from "@/lib/storageKeys";
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

// UI Phase 5: request-status vocabulary for the shared StatusBadge/
// AppButton primitives. Values are unchanged from the original literal
// button labels (request_status itself is still "new"/"contacted"/
// "confirmed"/"completed"/"cancelled" -- only display text/color moved
// onto the shared token system).
const REQUEST_STATUS_OPTIONS = [
  "new",
  "contacted",
  "confirmed",
  "completed",
  "cancelled",
] as const;

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<string, StatusBadgeTone> = {
  new: "neutral",
  contacted: "info",
  confirmed: "info",
  completed: "success",
  cancelled: "danger",
};

// Same completed=success / cancelled=danger / contacted+confirmed=primary /
// new=muted hierarchy the original inline className switch already used --
// carried over exactly, not redesigned.
const STATUS_BUTTON_VARIANT: Record<
  string,
  "success" | "danger" | "primary" | "muted"
> = {
  new: "muted",
  contacted: "primary",
  confirmed: "primary",
  completed: "success",
  cancelled: "danger",
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
    localStorage.setItem(STORAGE_KEYS.parkingFocusSite, site);
  }

  window.location.href = "/admin/parking";
}

// Pure, presentation-only classification of the page's existing status
// text into an Alert tone -- never a second source of the message itself
// (every setStatus call site below is unchanged). Mirrors the same
// heuristic already established for Vendors (vendorPageStatusTone).
function vendorRequestStatusTone(message: string): AlertTone {
  const lower = message.toLowerCase();

  if (
    lower.includes("failed") ||
    lower.startsWith("we couldn't") ||
    lower.startsWith("could not") ||
    lower.includes("denied")
  ) {
    return "danger";
  }
  if (lower.includes("no admin event selected") || lower.includes("unavailable")) {
    return "neutral";
  }
  if (lower.endsWith("...")) {
    return "info";
  }
  if (
    lower.startsWith("loaded") ||
    lower.includes("updated") ||
    lower.includes("sent") ||
    lower.includes("copied") ||
    lower.includes("opened") ||
    lower.includes("admitted")
  ) {
    return "success";
  }
  return "neutral";
}

export default function VendorRequestsPage() {
  return (
    <AdminRouteGuard requiredTask="event.vendors.manage">
      <AdminShellAdapter pageTitle="Vendor Requests">
        <VendorRequestsInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

function VendorRequestsInner() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [status, setStatus] = useState("Loading...");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);
  // Shell's own canonical compact-state signal (Canonical Shell Extension
  // Rule 7) -- decides desktop table vs. narrow-viewport list below,
  // replacing what would otherwise be a page-local resize listener.
  const { isCompact } = useShellInterfaceCapabilities();

  async function loadRequests() {
    const event = getCurrentAdminEvent();
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
      console.error("load vendor requests error:", error);
      setStatus("We couldn't load vendor requests. Please try again.");
      return;
    }

    setRequests((data || []) as RequestRow[]);
    setStatus(`Loaded ${(data || []).length} vendor requests.`);
  }

  useEffect(() => {
    void loadRequests();

    const unsubscribe = subscribeToAdminWorkspace(() => {
      void loadRequests();
    });

    return unsubscribe;
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

  async function sendVendorEmail(request: RequestRow) {
    const vendor = vendorForRequest(request);
    const vendorEmail = vendor?.email?.trim() || "";
    const vendorName = vendor?.business_name || "Vendor";

    if (!vendorEmail) {
      setStatus("This vendor does not have an email address.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setStatus("Email failed: You must be signed in as an admin.");
      return;
    }

    setSendingEmailId(request.id);
    setStatus(`Sending email to ${vendorName}...`);

    try {
      const response = await fetch("/api/email/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          requestId: request.id,
        }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to send vendor email.");
      }

      setStatus(`Email sent to ${vendorName} at ${vendorEmail}.`);
    } catch (error) {
      console.error("sendVendorEmail error:", error);
      setStatus("Email failed. Please try again.");
    } finally {
      setSendingEmailId(null);
    }
  }

  async function updateStatus(id: string, nextStatus: string) {
    setUpdatingId(id);

    const { error } = await supabase
      .from("vendor_service_requests")
      .update({ request_status: nextStatus })
      .eq("id", id);

    setUpdatingId(null);

    if (error) {
      console.error("update vendor request status error:", error);
      setStatus("We couldn't update this request's status. Please try again.");
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
    const result = await copyTextToClipboard(summary);

    if (result.success) {
      setStatus(`Copied ${vendorName} request summary.`);
    } else {
      setStatus(
        "Could not copy summary. Your browser may not allow clipboard access.",
      );
    }
  }

  async function markVendorRequestsStatus(
    vendorName: string,
    vendorRequests: RequestRow[],
    nextStatus: string,
  ) {
    const ids = vendorRequests.map((request) => request.id);

    if (ids.length === 0) {
      return;
    }

    setUpdatingId(`vendor-${vendorName}`);

    const { error } = await supabase
      .from("vendor_service_requests")
      .update({ request_status: nextStatus })
      .in("id", ids);

    setUpdatingId(null);

    if (error) {
      console.error("bulk update vendor request status error:", error);
      setStatus(`We couldn't update ${vendorName}'s requests. Please try again.`);
      return;
    }

    setRequests((prev) =>
      prev.map((request) =>
        ids.includes(request.id)
          ? { ...request, request_status: nextStatus }
          : request,
      ),
    );

    setStatus(`${vendorName} requests marked ${nextStatus}.`);
  }

  // Shared between the desktop table's Actions cell and the compact list
  // card, so both presentations offer identical contact/handoff actions --
  // one render path, two layouts (the pattern established in Vendors/
  // Attendees). Contact/handoff actions (reach the requester or vendor,
  // jump to the site on the map) are kept in their own RowActions group,
  // visually separate from the status-lifecycle actions below.
  function renderContactActions(request: RequestRow) {
    const vendor = vendorForRequest(request);
    const vendorEmail = vendor?.email?.trim() || "";
    const name = request.requester_name || "this requester";
    const site = currentSiteForRequest(request);

    return (
      <RowActions>
        {request.requester_phone ? (
          <AppLinkButton href={phoneHref(request.requester_phone)} aria-label={`Call ${name}`}>
            Call Member
          </AppLinkButton>
        ) : null}

        {request.requester_email ? (
          <AppLinkButton href={emailHref(request.requester_email)} aria-label={`Email ${name}`}>
            Email Member
          </AppLinkButton>
        ) : null}

        {vendorEmail ? (
          <AppButton
            variant="primary"
            onClick={() => void sendVendorEmail(request)}
            disabled={sendingEmailId === request.id}
            aria-label={`Email vendor about ${name}'s request`}
          >
            {sendingEmailId === request.id ? "Sending..." : "Email Vendor"}
          </AppButton>
        ) : null}

        <AppButton
          variant="muted"
          onClick={() => openParkingMapForSite(site)}
          disabled={!site}
          aria-label={`Show current site on map for ${name}`}
        >
          Show Current Site on Map
        </AppButton>
      </RowActions>
    );
  }

  // Status-lifecycle actions -- request_status is Vendor Requests' own
  // field (vendor_service_requests.request_status), unrelated to Vendor
  // Event admission lifecycle (unchanged, untouched by this migration).
  function renderStatusActions(request: RequestRow) {
    const name = request.requester_name || "this requester";
    const current = request.request_status || "new";

    return (
      <RowActions>
        {REQUEST_STATUS_OPTIONS.map((s) => (
          <AppButton
            key={s}
            variant={STATUS_BUTTON_VARIANT[s]}
            disabled={updatingId === request.id || current === s}
            onClick={() => void updateStatus(request.id, s)}
            aria-label={`Mark ${name}'s request ${STATUS_LABELS[s]}`}
          >
            {STATUS_LABELS[s]}
          </AppButton>
        ))}
      </RowActions>
    );
  }

  const activeFilterCount = filter !== "all" ? 1 : 0;
  const hasClearableState = activeFilterCount > 0 || search.trim() !== "";

  function clearFilters() {
    setSearch("");
    setFilter("all");
  }

  const isLoading = status === "Loading..." && requests.length === 0;

  const requestListBody = isLoading ? (
    <LoadingState message="Loading vendor requests..." />
  ) : filtered.length === 0 ? (
    <EmptyState
      message={
        requests.length === 0
          ? "No vendor requests have been submitted for this Event yet."
          : "No vendor requests match your search or filters. Try clearing them."
      }
    />
  ) : isCompact ? (
    <ResponsiveList aria-labelledby="vendor-requests-service-requests-heading">
      {filtered.map((r) => {
        const vendorName = vendorNameForRequest(r);
        const site = currentSiteForRequest(r);
        const priorSite = r.site_number && r.site_number !== site ? r.site_number : null;

        return (
          <li key={r.id} className="responsive-list-item">
            <div className="responsive-list-item-header">
              <div className="responsive-list-item-title">{r.requester_name || "Unnamed"}</div>
              {(() => {
                const s = r.request_status || "new";
                return <StatusBadge tone={STATUS_TONE[s]}>{STATUS_LABELS[s]}</StatusBadge>;
              })()}
            </div>

            <div className="responsive-list-item-meta">
              <span>Vendor: {vendorName}</span>
              <span>Service: {r.requested_service || "—"}</span>
              <span>Party: {r.guest_count || 0}</span>
            </div>

            <div className="responsive-list-item-meta">
              <span>Site: {site || "—"}{priorSite ? ` (was ${priorSite})` : ""}</span>
            </div>

            <div className="responsive-list-item-meta">
              {r.requester_phone ? <span>{r.requester_phone}</span> : null}
              {r.requester_email ? <span>{r.requester_email}</span> : null}
              {r.preferred_response_method ? (
                <span>Prefers {r.preferred_response_method}</span>
              ) : null}
            </div>

            {r.request_notes ? (
              <div className="data-table-cell-meta">Notes: {r.request_notes}</div>
            ) : null}

            {renderContactActions(r)}
            {renderStatusActions(r)}
          </li>
        );
      })}
    </ResponsiveList>
  ) : (
    <DataTable caption="Vendor service requests for the current Event">
      <thead>
        <tr>
          <th scope="col">Requester</th>
          <th scope="col">Vendor</th>
          <th scope="col">Service</th>
          <th scope="col">Site</th>
          <th scope="col">Status</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((r) => {
          const vendor = vendorForRequest(r);
          const vendorName = vendorNameForRequest(r);
          const vendorPhone = vendorPhoneForRequest(r);
          const site = currentSiteForRequest(r);
          const priorSite = r.site_number && r.site_number !== site ? r.site_number : null;
          const s = r.request_status || "new";

          return (
            <tr key={r.id}>
              <td>
                <div className="data-table-cell-primary">{r.requester_name || "Unnamed"}</div>
                <div className="data-table-cell-meta">
                  {[r.requester_phone, r.requester_email].filter(Boolean).join(" · ")}
                  {r.preferred_response_method ? ` · Prefers ${r.preferred_response_method}` : ""}
                </div>
              </td>
              <td>
                <div className="data-table-cell-primary">{vendorName}</div>
                {vendorPhone ? <div className="data-table-cell-meta">{vendorPhone}</div> : null}
                {!vendor ? <div className="data-table-cell-meta">No vendor on file</div> : null}
              </td>
              <td>
                <div className="data-table-cell-primary">{r.requested_service || "—"}</div>
                <div className="data-table-cell-meta">
                  {r.guest_count || 0} guest{(r.guest_count || 0) === 1 ? "" : "s"}
                  {r.request_notes ? ` · ${r.request_notes}` : ""}
                </div>
              </td>
              <td>
                {site || "—"}
                {priorSite ? (
                  <div className="data-table-cell-meta">was {priorSite}</div>
                ) : null}
              </td>
              <td>
                <StatusBadge tone={STATUS_TONE[s]}>{STATUS_LABELS[s]}</StatusBadge>
              </td>
              <td>
                <div style={{ display: "grid", gap: "var(--space-2)" }}>
                  {renderContactActions(r)}
                  {renderStatusActions(r)}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );

  return (
    <div style={{ display: "grid", gap: "var(--space-8)", minWidth: 0 }}>
      <Alert tone={vendorRequestStatusTone(status)}>{status}</Alert>

      <TableToolbar>
        <TableToolbarPrimaryRow>
          <SearchField
            label="Search"
            value={search}
            onChange={setSearch}
            id="vendor-request-search"
            placeholder="Name, vendor, site, phone, service..."
          />

          <div>
            <label className="table-toolbar-label" htmlFor="vendor-request-status">
              Status
            </label>
            <select
              id="vendor-request-status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All</option>
              {REQUEST_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          {hasClearableState ? (
            <div style={{ alignSelf: "end" }}>
              <AppButton onClick={clearFilters}>Clear Search &amp; Filters</AppButton>
            </div>
          ) : null}
        </TableToolbarPrimaryRow>
      </TableToolbar>

      {groupedRequests.length > 0 ? (
        <PageSection variant="section">
          <PageHeader
            title="Vendor Dispatch Lists"
            headingLevel="h2"
            titleClassName="app-section-title"
            description="Export, copy, or text a vendor-specific request list."
            descriptionClassName="app-subtle-text"
          />

          <div style={{ display: "grid", gap: "var(--space-3)" }}>
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
                    border: "var(--border-width-default) solid var(--color-border-default)",
                    borderRadius: "var(--radius-medium)",
                    background: "var(--color-bg-muted)",
                    padding: "var(--space-4)",
                    display: "grid",
                    gap: "var(--space-3)",
                    minWidth: 0,
                    overflowWrap: "anywhere",
                  }}
                >
                  <div className="app-row-between-wrap">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: "var(--font-weight-semibold)", overflowWrap: "anywhere" }}>
                        {vendorName}
                      </div>
                      <div className="data-table-cell-meta">
                        {vendorRequests.length} request
                        {vendorRequests.length === 1 ? "" : "s"}
                        {vendorPhone ? ` • ${vendorPhone}` : ""}
                      </div>
                    </div>

                    <RowActions>
                      <AppButton onClick={() => exportVendorCsv(vendorName, vendorRequests)}>
                        Export CSV
                      </AppButton>

                      <AppButton onClick={() => void copyVendorSummary(vendorName, vendorRequests)}>
                        Copy Summary
                      </AppButton>

                      {textLink ? (
                        <AppLinkButton
                          href={textLink}
                          variant="primary"
                          onClick={() => setStatus(`Opened text message for ${vendorName}.`)}
                        >
                          Text Vendor
                        </AppLinkButton>
                      ) : (
                        <AppButton variant="muted" disabled>
                          No Vendor Phone
                        </AppButton>
                      )}

                      <AppButton
                        onClick={() =>
                          void markVendorRequestsStatus(vendorName, vendorRequests, "contacted")
                        }
                        disabled={updatingId === `vendor-${vendorName}`}
                      >
                        {updatingId === `vendor-${vendorName}` ? "Updating..." : "Mark Contacted"}
                      </AppButton>
                    </RowActions>
                  </div>
                </div>
              );
            })}
          </div>
        </PageSection>
      ) : null}

      <section style={{ display: "grid", gap: "var(--space-4)" }}>
        <PageHeader
          title="Service Requests"
          titleId="vendor-requests-service-requests-heading"
          headingLevel="h2"
          titleClassName="app-section-title"
          description={`Showing ${filtered.length} request${filtered.length === 1 ? "" : "s"} • Total party count: ${totalGuests}.`}
          descriptionClassName="app-subtle-text"
          actions={
            <FormActions>
              <AppButton onClick={() => void loadRequests()}>Refresh</AppButton>
              <AppButton onClick={exportCsv} disabled={filtered.length === 0}>
                Export CSV
              </AppButton>
            </FormActions>
          }
        />

        {requestListBody}
      </section>
    </div>
  );
}
