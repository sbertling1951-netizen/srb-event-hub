"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import { supabase } from "@/lib/supabase";

type MemberEvent = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
};

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

function getStoredMemberAttendeeId() {
  if (typeof window === "undefined") {
    return null;
  }
  return localStorage.getItem("fcoc-member-attendee-id");
}

function getStoredMemberEmail() {
  if (typeof window === "undefined") {
    return null;
  }
  return localStorage.getItem("fcoc-member-email");
}

function fullName(
  first: string | null | undefined,
  last: string | null | undefined,
) {
  return `${first || ""} ${last || ""}`.trim();
}

function eventName(event: MemberEvent | null) {
  return event?.name || event?.eventName || "Current event";
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

function MemberVendorSignupInner() {
  const searchParams = useSearchParams();
  const vendorIdFromUrl = searchParams.get("vendorId") || "";

  const [event, setEvent] = useState<MemberEvent | null>(null);
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

  const selectedVendor = useMemo(
    () => vendors.find((vendor) => vendor.id === selectedVendorId) || null,
    [vendors, selectedVendorId],
  );

  const selectedEventVendor = selectedVendor?.event_vendors?.[0] || null;
  const selectedActionType =
    selectedEventVendor?.action_type || "service_request";
  const selectedSignupUrl = selectedEventVendor?.signup_url || "";

  useEffect(() => {
    void loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function loadPage() {
    try {
      setError(null);
      setStatus("Loading vendor request form...");

      const currentEvent = getCurrentMemberEvent();
      if (!currentEvent?.id) {
        setEvent(null);
        setVendors([]);
        setAttendee(null);
        setStatus("No current event selected.");
        return;
      }

      setEvent(currentEvent);

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
        .eq("event_vendors.event_id", currentEvent.id)
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

      const storedAttendeeId = getStoredMemberAttendeeId();
      const storedEmail = getStoredMemberEmail()?.toLowerCase() || null;

      const { data: attendeeRows, error: attendeeError } = await supabase
        .from("attendees")
        .select(
          "id,email,pilot_first,pilot_last,assigned_site,primary_phone,cell_phone,coach_manufacturer,coach_model,coach_length",
        )
        .eq("event_id", currentEvent.id);

      if (attendeeError) {
        throw attendeeError;
      }

      const allAttendees = (attendeeRows || []) as AttendeeRow[];
      const attendeeRow =
        allAttendees.find(
          (row) => storedAttendeeId && row.id === storedAttendeeId,
        ) ||
        allAttendees.find(
          (row) =>
            storedEmail && (row.email || "").toLowerCase() === storedEmail,
        ) ||
        null;

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
    } catch (err: any) {
      console.error("load vendor signup error:", err);
      setError(err?.message || "Could not load vendor request form.");
      setStatus("Could not load vendor request form.");
    }
  }

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
    } catch (err: any) {
      console.error("submit vendor request error:", err);
      setError(err?.message || "Could not submit vendor request.");
      setStatus("Request failed.");
    } finally {
      setSaving(false);
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
          Current event: {eventName(event)}
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
                <a href={phoneHref(selectedVendor.phone)}>Call Vendor</a>
              ) : null}
              {selectedVendor.email ? (
                <a
                  href={emailHref(
                    selectedVendor.email,
                    selectedVendor.business_name,
                  )}
                >
                  Email Vendor
                </a>
              ) : null}
              {selectedVendor.website ? (
                <a
                  href={selectedVendor.website}
                  target="_blank"
                  rel="noreferrer"
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
            style={{ padding: "10px 14px", borderRadius: 8, fontWeight: 700 }}
          >
            {saving ? "Submitting..." : "Submit Request"}
          </button>

          <button
            type="button"
            onClick={() => void loadPage()}
            disabled={saving}
            style={{ padding: "10px 14px", borderRadius: 8 }}
          >
            Refresh
          </button>
        </div>
      </div>
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
