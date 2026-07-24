"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useMemberWorkspace } from "@/lib/memberWorkspace/useMemberWorkspace";
import { supabase } from "@/lib/supabase";

type VendorRow = {
  id: string;
  business_name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  logo_url: string | null;
  business_description: string | null;
  preferred_contact_method: string | null;
  event_vendors?:
    | {
        event_note: string | null;
        display_order: number | null;
        is_visible_to_members: boolean | null;
        signup_url: string | null;
        action_type: "service_request" | "external_signup" | "info_only" | null;
      }[]
    | null;
};

type AttendeeRow = {
  id: string;
  email: string | null;
  pilot_first: string | null;
  pilot_last: string | null;
  assigned_site: string | null;
  primary_phone: string | null;
  cell_phone: string | null;
  coach_manufacturer: string | null;
  coach_model: string | null;
  coach_length: string | null;
};

type RequestVendorRow = {
  business_name: string | null;
};

type MemberRequestRow = {
  id: string;
  event_id: string;
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
  vendors?: RequestVendorRow | RequestVendorRow[] | null;
};

function fullName(
  first: string | null | undefined,
  last: string | null | undefined,
) {
  return `${first || ""} ${last || ""}`.trim();
}

function phoneHref(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D+/g, "");
  return digits ? `tel:${digits}` : "";
}

function emailHref(value: string | null | undefined, vendorName: string) {
  const email = String(value || "").trim();
  if (!email) {
    return "";
  }
  return `mailto:${email}?subject=${encodeURIComponent(`Service request for ${vendorName}`)}`;
}

function coachInfo(attendee: AttendeeRow | null) {
  if (!attendee) {
    return "";
  }

  return [
    attendee.coach_manufacturer,
    attendee.coach_model,
    attendee.coach_length ? `${attendee.coach_length} ft` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function requestVendorName(request: MemberRequestRow) {
  const vendor = Array.isArray(request.vendors)
    ? request.vendors[0]
    : request.vendors;

  return vendor?.business_name || "Vendor";
}

function formatRequestDate(value: string | null) {
  if (!value) {
    return "";
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function canCancelRequest(request: MemberRequestRow) {
  const status = (request.request_status || "new").toLowerCase();
  return status === "new" || status === "contacted" || status === "confirmed";
}

function statusBadge(status: string) {
  const s = status.toLowerCase();

  if (s === "completed") {
    return "app-badge app-badge-success";
  }
  if (s === "cancelled") {
    return "app-badge app-badge-danger";
  }
  if (s === "contacted" || s === "confirmed") {
    return "app-badge app-badge-primary";
  }

  return "app-badge app-badge-muted";
}

function MemberVendorSignupInner() {
  const searchParams = useSearchParams();
  const vendorIdFromUrl = searchParams.get("vendorId") || "";
  const { event, attendeeId, isReady } = useMemberWorkspace();
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [attendee, setAttendee] = useState<AttendeeRow | null>(null);
  const [selectedVendorId, setSelectedVendorId] = useState(vendorIdFromUrl);
  const [requestedService, setRequestedService] = useState("");
  const [guestCount, setGuestCount] = useState("1");
  const [notes, setNotes] = useState("");
  const [preferredResponseMethod, setPreferredResponseMethod] =
    useState("email");
  const [requesterName, setRequesterName] = useState("");
  const [requesterEmail, setRequesterEmail] = useState("");
  const [requesterPhone, setRequesterPhone] = useState("");
  const [siteNumber, setSiteNumber] = useState("");
  const [status, setStatus] = useState("Loading vendor request form...");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [memberRequests, setMemberRequests] = useState<MemberRequestRow[]>([]);
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(
    null,
  );
  const [requestPendingCancel, setRequestPendingCancel] =
    useState<MemberRequestRow | null>(null);

  const selectedVendor = useMemo(
    () => vendors.find((vendor) => vendor.id === selectedVendorId) || null,
    [vendors, selectedVendorId],
  );

  useEffect(() => {
    if (vendorIdFromUrl) {
      setSelectedVendorId(vendorIdFromUrl);
    }
  }, [vendorIdFromUrl]);

  useEffect(() => {
    if (selectedVendor?.preferred_contact_method) {
      setPreferredResponseMethod(selectedVendor.preferred_contact_method);
    }
  }, [selectedVendor?.preferred_contact_method]);

  const loadPage = useCallback(async () => {
    try {
      setError(null);
      setStatus("Loading vendor request form...");

      if (!isReady || !event?.id || !attendeeId) {
        setVendors([]);
        setAttendee(null);
        setStatus("Loading vendor request form...");
        return;
      }

      const { data: vendorData, error: vendorError } = await supabase
        .from("vendors")
        .select(
          `
          id,
          business_name,
          email,
          phone,
          website,
          logo_url,
          business_description,
          preferred_contact_method,
          event_vendors!inner (
            event_note,
            display_order,
            is_visible_to_members,
            signup_url,
            action_type
          )
        `,
        )
        .eq("is_active", true)
        .eq("event_vendors.event_id", event.id)
        .neq("event_vendors.is_visible_to_members", false);

      if (vendorError) {
        throw vendorError;
      }

      const visibleVendors = ((vendorData || []) as VendorRow[]).sort(
        (a, b) => {
          const aOrder = Number(a.event_vendors?.[0]?.display_order ?? 100);
          const bOrder = Number(b.event_vendors?.[0]?.display_order ?? 100);
          if (aOrder !== bOrder) {
            return aOrder - bOrder;
          }
          return a.business_name.localeCompare(b.business_name);
        },
      );

      setVendors(visibleVendors);

      if (!vendorIdFromUrl && visibleVendors.length > 0) {
        setSelectedVendorId(visibleVendors[0].id);
      }

      const { data: attendeeRow, error: attendeeError } = await supabase
        .from("attendees")
        .select(
          "id,email,pilot_first,pilot_last,assigned_site,primary_phone,cell_phone,coach_manufacturer,coach_model,coach_length",
        )
        .eq("id", attendeeId)
        .eq("event_id", event.id)
        .maybeSingle<AttendeeRow>();

      if (attendeeError) {
        throw attendeeError;
      }

      const { data: requestRows, error: requestError } = await supabase
        .from("vendor_service_requests")
        .select(
          `
          id,
          event_id,
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
          vendors (
            business_name
          )
        `,
        )
        .eq("event_id", event.id)
        .order("created_at", { ascending: false });

      if (requestError) {
        throw requestError;
      }

      const normalizedStoredEmail = (attendeeRow?.email || "").toLowerCase();
      const visibleRequests = (
        (requestRows || []) as MemberRequestRow[]
      ).filter((request) => {
        const requestEmail = (request.requester_email || "").toLowerCase();
        return (
          (!!attendeeRow?.id && request.attendee_id === attendeeRow.id) ||
          (!!normalizedStoredEmail && requestEmail === normalizedStoredEmail)
        );
      });

      setMemberRequests(visibleRequests);
      setAttendee(attendeeRow);

      if (attendeeRow) {
        setRequesterName(
          fullName(attendeeRow.pilot_first, attendeeRow.pilot_last),
        );
        setRequesterEmail(attendeeRow.email || "");
        setRequesterPhone(
          attendeeRow.cell_phone || attendeeRow.primary_phone || "",
        );
        setSiteNumber(attendeeRow.assigned_site || "");
      }

      setStatus(
        visibleVendors.length > 0
          ? `Loaded ${visibleVendors.length} vendor${visibleVendors.length === 1 ? "" : "s"}.`
          : "No vendors are available for this event yet.",
      );
    } catch (err) {
      console.error("load vendor signup error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Could not load vendor request form.",
      );
      setStatus("");
    }
  }, [attendeeId, event?.id, isReady, vendorIdFromUrl]);

  useEffect(() => {
    if (!isReady || !event?.id || !attendeeId) {
      return;
    }

    void loadPage();
  }, [attendeeId, event?.id, isReady, loadPage]);

  async function submitRequest() {
    if (!event?.id) {
      setError("No current event selected.");
      return;
    }
    if (!selectedVendorId) {
      setError("Please select a vendor.");
      return;
    }
    if (!requesterName.trim()) {
      setError("Please enter your name.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setStatus("Submitting vendor request...");

      const { error: insertError } = await supabase
        .from("vendor_service_requests")
        .insert({
          event_id: event.id,
          vendor_id: selectedVendorId,
          attendee_id: attendee?.id || null,
          requester_name: requesterName.trim(),
          requester_email: requesterEmail.trim() || attendee?.email || null,
          requester_phone: requesterPhone.trim() || null,
          site_number: siteNumber.trim() || attendee?.assigned_site || null,
          coach_info: coachInfo(attendee) || null,
          requested_service:
            requestedService.trim() || selectedVendor?.business_name || null,
          guest_count: Number(guestCount) || 1,
          request_notes: notes.trim() || null,
          preferred_response_method: preferredResponseMethod || "email",
          request_status: "new",
        });

      if (insertError) {
        throw insertError;
      }

      setSubmitted(true);
      setStatus("Your vendor request was submitted.");
      setRequestedService("");
      setNotes("");
      await loadPage();
    } catch (err) {
      console.error("submit vendor request error:", err);
      setError(
        err instanceof Error ? err.message : "Could not submit vendor request.",
      );
      setStatus("");
    } finally {
      setSaving(false);
    }
  }

  function cancelRequest(request: MemberRequestRow) {
    if (!canCancelRequest(request)) {
      setError("This request can no longer be cancelled from the member page.");
      return;
    }

    setRequestPendingCancel(request);
  }

  async function confirmCancelRequest() {
    if (!requestPendingCancel) {
      return;
    }

    const request = requestPendingCancel;
    setRequestPendingCancel(null);

    try {
      setCancellingRequestId(request.id);
      setError(null);
      setStatus("Cancelling vendor request...");

      const { error: updateError } = await supabase
        .from("vendor_service_requests")
        .update({ request_status: "cancelled" })
        .eq("id", request.id);

      if (updateError) {
        throw updateError;
      }

      setMemberRequests((prev) =>
        prev.map((row) =>
          row.id === request.id
            ? {
                ...row,
                request_status: "cancelled",
              }
            : row,
        ),
      );
      setStatus("Vendor request cancelled.");
    } catch (err) {
      console.error("cancel vendor request error:", err);
      setError(
        err instanceof Error ? err.message : "Could not cancel vendor request.",
      );
      setStatus("");
    } finally {
      setCancellingRequestId(null);
    }
  }

  return (
    <div style={{ padding: 24, display: "grid", gap: 18, maxWidth: 920 }}>
      <div
        className="card"
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          background: "white",
          padding: 18,
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>
          Vendor Service Request
        </h1>
        <div style={{ fontSize: 14, color: "#555" }}>
          Current event: {event?.name || "Current event"}
        </div>
        <div style={{ fontSize: 13, marginTop: 8 }}>{status}</div>
        {error ? (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              borderRadius: 8,
              border: "1px solid #e2b4b4",
              background: "#fff3f3",
              color: "#8a1f1f",
            }}
          >
            {error}
          </div>
        ) : null}
        {submitted ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 8,
              border: "1px solid #86efac",
              background: "#f0fdf4",
              color: "#166534",
              fontWeight: 700,
            }}
          >
            Request submitted. The vendor or event team will follow up with you.
          </div>
        ) : null}
      </div>

      <div
        className="card"
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          background: "white",
          padding: 18,
          display: "grid",
          gap: 14,
        }}
      >
        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Vendor</div>
          <select
            value={selectedVendorId}
            onChange={(e) => setSelectedVendorId(e.target.value)}
            disabled={saving || !!vendorIdFromUrl}
            style={{ width: "100%", padding: 10 }}
          >
            <option value="">Select vendor</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.business_name}
              </option>
            ))}
          </select>
        </label>

        {selectedVendor ? (
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: 12,
              background: "#fafafa",
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {selectedVendor.logo_url ? (
                <img
                  src={selectedVendor.logo_url}
                  alt={`${selectedVendor.business_name} logo`}
                  style={{
                    width: 90,
                    height: 60,
                    objectFit: "contain",
                    border: "1px solid #ddd",
                    borderRadius: 8,
                    padding: 6,
                    background: "white",
                  }}
                />
              ) : null}
              <div>
                <div style={{ fontWeight: 800 }}>
                  {selectedVendor.business_name}
                </div>
                {selectedVendor.event_vendors?.[0]?.event_note ? (
                  <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
                    {selectedVendor.event_vendors[0].event_note}
                  </div>
                ) : null}
              </div>
            </div>

            {selectedVendor.business_description ? (
              <div style={{ fontSize: 14 }}>
                {selectedVendor.business_description}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {selectedVendor.phone ? (
                <a
                  href={phoneHref(selectedVendor.phone)}
                  className="app-button"
                >
                  Call Vendor
                </a>
              ) : null}
              {selectedVendor.email ? (
                <a
                  href={emailHref(
                    selectedVendor.email,
                    selectedVendor.business_name,
                  )}
                  className="app-button"
                >
                  Email Vendor
                </a>
              ) : null}
              {selectedVendor.website ? (
                <a
                  href={selectedVendor.website}
                  target="_blank"
                  rel="noreferrer"
                  className="app-button"
                >
                  Website
                </a>
              ) : null}
            </div>
          </div>
        ) : null}

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Your Name</div>
          <input
            value={requesterName}
            onChange={(e) => setRequesterName(e.target.value)}
            placeholder="Your name"
            style={{ width: "100%", padding: 10 }}
          />
        </label>

        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
          }}
        >
          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Email</div>
            <input
              value={requesterEmail}
              onChange={(e) => setRequesterEmail(e.target.value)}
              placeholder="Email"
              style={{ width: "100%", padding: 10 }}
            />
          </label>

          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Phone / Text</div>
            <input
              value={requesterPhone}
              onChange={(e) => setRequesterPhone(e.target.value)}
              placeholder="Phone or text number"
              style={{ width: "100%", padding: 10 }}
            />
          </label>

          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Site Number</div>
            <input
              value={siteNumber}
              onChange={(e) => setSiteNumber(e.target.value)}
              placeholder="Site number"
              style={{ width: "100%", padding: 10 }}
            />
          </label>
        </div>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            Requested Service
          </div>
          <input
            value={requestedService}
            onChange={(e) => setRequestedService(e.target.value)}
            placeholder="What service are you requesting?"
            style={{ width: "100%", padding: 10 }}
          />
        </label>

        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
          }}
        >
          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Party Count</div>
            <input
              type="number"
              min="1"
              value={guestCount}
              onChange={(e) => setGuestCount(e.target.value)}
              style={{ width: "100%", padding: 10 }}
            />
          </label>

          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              Preferred Response
            </div>
            <select
              value={preferredResponseMethod}
              onChange={(e) => setPreferredResponseMethod(e.target.value)}
              style={{ width: "100%", padding: 10 }}
            >
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="text">Text</option>
              <option value="in_app">In-app request</option>
            </select>
          </label>
        </div>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Notes</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add any details the vendor should know."
            rows={5}
            style={{ width: "100%", padding: 10 }}
          />
        </label>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => void submitRequest()}
            disabled={saving || vendors.length === 0}
            className="app-button app-button-primary"
          >
            {saving ? "Submitting..." : "Submit Request"}
          </button>

          <button
            type="button"
            onClick={() => void loadPage()}
            disabled={saving}
            className="app-button app-button-muted"
          >
            Refresh
          </button>
        </div>
      </div>

      <div
        className="card"
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          background: "white",
          padding: 18,
          display: "grid",
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0 }}>My Vendor Requests</h2>

        {memberRequests.length === 0 ? (
          <div style={{ fontSize: 14, color: "#666" }}>
            You do not have any vendor requests for this event yet.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {memberRequests.map((request) => {
              const statusValue = request.request_status || "new";
              const cancelAllowed = canCancelRequest(request);

              return (
                <div
                  key={request.id}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 10,
                    background:
                      statusValue === "cancelled" ? "#f9fafb" : "#fafafa",
                    padding: 12,
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800 }}>
                        {requestVendorName(request)}
                      </div>
                      <div style={{ fontSize: 13, color: "#555" }}>
                        {request.requested_service || "Service request"}
                      </div>
                    </div>

                    <div style={{ fontSize: 13, color: "#555" }}>
                      <div>
                        Status:{" "}
                        <span className={statusBadge(statusValue)}>
                          {statusValue}
                        </span>
                      </div>{" "}
                    </div>
                  </div>

                  <div style={{ fontSize: 13, color: "#555" }}>
                    {formatRequestDate(request.created_at)}
                    {request.site_number
                      ? ` • Site ${request.site_number}`
                      : ""}
                    {request.guest_count
                      ? ` • Party ${request.guest_count}`
                      : ""}
                  </div>

                  {request.request_notes ? (
                    <div style={{ fontSize: 13 }}>
                      <strong>Notes:</strong> {request.request_notes}
                    </div>
                  ) : null}

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => cancelRequest(request)}
                      disabled={
                        !cancelAllowed || cancellingRequestId === request.id
                      }
                      className={
                        statusValue === "cancelled"
                          ? "app-button app-button-muted"
                          : "app-button app-button-danger"
                      }
                    >
                      {cancellingRequestId === request.id
                        ? "Cancelling..."
                        : statusValue === "cancelled"
                          ? "Cancelled"
                          : "Cancel Request"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!requestPendingCancel}
        title="Cancel Vendor Request"
        message={
          requestPendingCancel
            ? `Cancel this request for ${requestVendorName(requestPendingCancel)}?`
            : ""
        }
        confirmLabel="Cancel Request"
        cancelLabel="Keep Request"
        danger={true}
        onConfirm={() => void confirmCancelRequest()}
        onCancel={() => setRequestPendingCancel(null)}
      />
    </div>
  );
}

export default function MemberVendorSignupPage() {
  return (
    <MemberRouteGuard>
      <MemberVendorSignupInner />
    </MemberRouteGuard>
  );
}
