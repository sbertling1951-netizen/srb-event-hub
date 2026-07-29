"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import AnnouncementBanner from "@/components/AnnouncementBanner";
import {
  type CurrentMemberEvent,
  getCurrentMemberAttendeeId,
  getCurrentMemberEvent,
  getStoredMemberEmail,
  getStoredMemberEntryId,
} from "@/lib/getCurrentMemberEvent";
import { supabase } from "@/lib/supabase";
import { getTenantLabel } from "@/lib/tenantLabels";

type DashboardVendor = {
  id: string;
  business_name: string;
  business_description: string | null;
  logo_url: string | null;
  signup_url: string | null;
  is_featured: boolean | null;
  action_type: string;
};

type EventVendorDetails = {
  id: string;
  business_name: string;
  business_description: string | null;
  logo_url: string | null;
};

type EventVendorRow = {
  id: string;
  is_featured: boolean | null;
  display_order: number | null;
  signup_url: string | null;
  action_type: string | null;
  vendors: EventVendorDetails | EventVendorDetails[] | null;
};

type HouseholdMember = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
};

function getDashboardVendorDetails(
  value: EventVendorRow["vendors"],
): EventVendorDetails | null {
  if (Array.isArray(value)) {
    return value[0] || null;
  }

  return value;
}

export default function MemberDashboardPage() {
  const [ready, setReady] = useState(false);
  const [currentEvent, setCurrentEvent] = useState<CurrentMemberEvent | null>(
    null,
  );
  const [vendors, setVendors] = useState<DashboardVendor[]>([]);
  const [vendorError, setVendorError] = useState<string | null>(null);
  const [currentVendorIndex, setCurrentVendorIndex] = useState(0);

  const [participantCapacity, setParticipantCapacity] = useState(0);
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>(
    [],
  );

  const router = useRouter();

  const dashboardTitle = getTenantLabel("dashboard_title");
  const agendaNavLabel = getTenantLabel("agenda_nav_label");
  const announcementsNavLabel = getTenantLabel("announcements_nav_label");
  const attendeesNavLabel = getTenantLabel("attendees_nav_label");
  const nearbyNavLabel = getTenantLabel("nearby_nav_label");
  const myRequestsNavLabel = getTenantLabel("my_requests_nav_label");
  const eventVendorsHeading = getTenantLabel("event_vendors_heading");
  const vendorLabel = getTenantLabel("vendor_label");

  function goTo(path: string) {
    router.push(path);
  }

  useEffect(() => {
    let cancelled = false;

    async function verifyAccess() {
      try {
        const memberEvent = getCurrentMemberEvent();
        // Prefer the canonical MemberSession identity via the compatibility helper.
        const attendeeId = getCurrentMemberAttendeeId();
        const entryId = getStoredMemberEntryId();
        const email = getStoredMemberEmail();

        const hasLegacyIdentity = !!(attendeeId || entryId || email);

        if (!memberEvent || !hasLegacyIdentity) {
          // No selected-event workspace session (the legacy identity
          // this dashboard requires). Decision order: an authenticated
          // Supabase account with no selected event goes to the account
          // picker to choose one -- not back through login, and not into
          // an incomplete workspace. Only a visitor with neither a
          // selected event nor an authenticated account goes to
          // /member/login.
          const { data: sessionData } = await supabase.auth.getSession();
          if (cancelled) {
            return;
          }

          router.replace(
            sessionData?.session ? "/member/account" : "/member/login",
          );
          return;
        }

        setCurrentEvent(memberEvent);

        // Load participant capacity and household members
        (async () => {
          try {
            if (!attendeeId) {
              return;
            }
            // Get participant_capacity
            const { data: attendeeData, error: attendeeError } =
              await supabase
                .from("attendees")
                .select("participant_capacity")
                .eq("id", attendeeId)
                .single();
            if (attendeeError) {
              throw attendeeError;
            }
            setParticipantCapacity(attendeeData?.participant_capacity ?? 0);

            // Get household members
            const { data: membersData, error: membersError } = await supabase
              .from("attendee_household_members")
              .select("id, display_name, first_name, last_name")
              .eq("attendee_id", attendeeId)
              .order("created_at", { ascending: true });
            if (membersError) {
              throw membersError;
            }
            setHouseholdMembers(membersData ?? []);
          } catch (err) {
            console.error("Participant summary load failed:", err);
          }
        })();
      } catch (err) {
        console.error("Member dashboard load error:", err);
        if (!cancelled) {
          router.replace("/member/login");
        }
        return;
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    }

    void verifyAccess();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const loadVendors = useCallback(async () => {
    try {
      setVendorError(null);
      const event = getCurrentMemberEvent();
      if (!event?.id) {
        return;
      }

      const { data, error } = await supabase
        .from("event_vendors")
        .select(
          `
          id,
          is_featured,
          display_order,
          signup_url,
          action_type,
          vendors (
            id,
            business_name,
            business_description,
            logo_url
          )
        `,
        )
        .eq("event_id", event.id)
        .eq("is_visible_to_members", true)
        .order("display_order", { ascending: true });

      if (error) {
        throw error;
      }

      // Supabase does not infer this joined relationship shape here; the select above defines it.
      const rows = (data || []) as EventVendorRow[];
      const cleaned = rows
        .map((row) => {
          const vendor = getDashboardVendorDetails(row.vendors);

          if (!vendor) {
            return null;
          }

          return {
            id: vendor.id || row.id,
            business_name: vendor.business_name || vendorLabel,
            business_description: vendor.business_description || null,
            logo_url: vendor.logo_url || null,
            signup_url: row.signup_url,
            is_featured: row.is_featured,
            action_type: row.action_type || "service_request",
          };
        })
        .filter((vendor): vendor is DashboardVendor => !!vendor);

      setVendors(cleaned);
      setCurrentVendorIndex(0);
    } catch (err) {
      console.error("Vendor load error:", err);
      setVendorError(
        err instanceof Error ? err.message : "Could not load event vendors.",
      );
    }
  }, [vendorLabel]);

  useEffect(() => {
    void loadVendors();
  }, [loadVendors]);

  useEffect(() => {
    if (vendors.length <= 1) {
      return;
    }

    const interval = setInterval(() => {
      setCurrentVendorIndex((prev) =>
        prev + 1 >= vendors.length ? 0 : prev + 1,
      );
    }, 5000);

    return () => clearInterval(interval);
  }, [vendors]);

  const activeVendor = vendors[currentVendorIndex] ?? vendors[0] ?? null;

  if (!ready) {
    return <div style={{ padding: 30 }}>Loading...</div>;
  }

  if (!currentEvent) {
    return null;
  }

  return (
    <div style={{ display: "grid", gap: 18, padding: 16 }}>
      <AnnouncementBanner />

      <div
        className="card"
        style={{
          padding: 18,
          border: "1px solid #ddd",
          borderRadius: 12,
          background: "#fff",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div>
            <h1 style={{ marginTop: 0, marginBottom: 8 }}>
              {currentEvent.name || dashboardTitle}
            </h1>
            <div style={{ fontSize: 14, opacity: 0.8 }}>
              {currentEvent.location || ""}
            </div>
          </div>
          <button
            type="button"
            onClick={() => goTo("/member/account")}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: "#f8fafc",
              color: "#0f172a",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            My Events
          </button>
        </div>
      </div>

      {/* Participants */}
      <div
        className="card"
        style={{
          padding: 18,
          border: "1px solid #ddd",
          borderRadius: 12,
          background: "#fff",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h2 style={{ margin: 0 }}>Participants</h2>
          <div
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              background: "#eff6ff",
              color: "#1d4ed8",
              fontWeight: 700,
            }}
          >
            {householdMembers.length} of {participantCapacity}
          </div>
        </div>

        <div
          style={{
            fontSize: 14,
            color: "#4b5563",
            marginBottom: 12,
          }}
        >
          Manage the participants included with your registration. Add
          participants until all purchased participant slots are filled.
        </div>

        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          {householdMembers.map((member) => {
            const fullName = [member.first_name, member.last_name]
              .filter(Boolean)
              .join(" ")
              .trim();

            const name =
              fullName || member.display_name || "Unnamed Participant";

            return (
              <div
                key={member.id}
                style={{
                  padding: "10px 12px",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                }}
              >
                {name}
              </div>
            );
          })}

          {Array.from({
            length: Math.max(participantCapacity - householdMembers.length, 0),
          }).map((_, index) => (
            <div
              key={`empty-${index}`}
              style={{
                padding: "10px 12px",
                border: "1px dashed #cbd5e1",
                borderRadius: 8,
                color: "#6b7280",
                fontStyle: "italic",
              }}
            >
              Available Participant Slot
            </div>
          ))}
        </div>

        {householdMembers.length < participantCapacity && (
          <button
            type="button"
            onClick={() => goTo("/member/participants")}
            style={{
              ...memberGridButtonStyle,
              textAlign: "center",
              marginTop: 12,
            }}
          >
            + Add Participant
          </button>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 12,
          marginTop: 12,
        }}
      >
        <button
          type="button"
          onClick={() => goTo("/member/agenda")}
          style={memberGridButtonStyle}
        >
          📅 {agendaNavLabel}
        </button>

        <button
          type="button"
          onClick={() => goTo("/member/announcements")}
          style={memberGridButtonStyle}
        >
          📣 {announcementsNavLabel}
        </button>
        <button
          type="button"
          onClick={() => goTo("/member/photos")}
          style={memberGridButtonStyle}
        >
          📸 Photos
        </button>

        <button
          type="button"
          onClick={() => goTo("/member/evaluation")}
          style={memberGridButtonStyle}
        >
          📝 Evaluation
        </button>

        <button
          type="button"
          onClick={() => goTo("/member/attendees")}
          style={memberGridButtonStyle}
        >
          👥 {attendeesNavLabel}
        </button>

        <button
          type="button"
          onClick={() => goTo("/coach-map")}
          style={memberGridButtonStyle}
        >
          🗺️ Map
        </button>

        <button
          type="button"
          onClick={() => goTo("/member/nearby")}
          style={memberGridButtonStyle}
        >
          📍 {nearbyNavLabel}
        </button>

        <button
          type="button"
          onClick={() => goTo("/member/my-requests")}
          style={memberGridButtonStyle}
        >
          🧾 {myRequestsNavLabel}
        </button>
      </div>

      {vendorError ? (
        <div
          role="alert"
          style={{
            border: "1px solid #fecaca",
            borderRadius: 12,
            background: "#fef2f2",
            color: "#991b1b",
            padding: 14,
            fontWeight: 700,
          }}
        >
          {vendorError}
        </div>
      ) : null}

      {vendors.length > 0 ? (
        <div
          className="card"
          style={{
            border: "1px solid #ddd",
            borderRadius: 12,
            background: "white",
            padding: 16,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 10 }}>
            {eventVendorsHeading}
          </div>

          {activeVendor ? (
            <div style={{ display: "grid", gap: 10, textAlign: "center" }}>
              {activeVendor.logo_url ? (
                <img
                  src={activeVendor.logo_url}
                  alt={activeVendor.business_name}
                  style={{
                    maxHeight: 90,
                    maxWidth: "100%",
                    objectFit: "contain",
                    margin: "0 auto",
                  }}
                />
              ) : null}

              <div style={{ fontWeight: 800, fontSize: 20 }}>
                {activeVendor.business_name}
              </div>

              {activeVendor.business_description ? (
                <div style={{ fontSize: 14, color: "#555", lineHeight: 1.45 }}>
                  {activeVendor.business_description}
                </div>
              ) : null}

              {activeVendor.action_type === "external_signup" &&
              activeVendor.signup_url ? (
                <a
                  href={activeVendor.signup_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={primaryLinkStyle}
                >
                  Sign Up
                </a>
              ) : activeVendor.action_type === "info_only" ? (
                <Link href="/member/vendor-signup" style={primaryLinkStyle}>
                  View Vendors
                </Link>
              ) : (
                <Link
                  href={`/member/vendor-signup?vendorId=${activeVendor.id}`}
                  style={primaryLinkStyle}
                >
                  Request Service
                </Link>
              )}
            </div>
          ) : null}

          {vendors.length > 1 ? (
            <div style={{ marginTop: 12, textAlign: "center" }}>
              {vendors.map((vendor, index) => (
                <button
                  key={vendor.id}
                  type="button"
                  aria-label={`Show ${vendorLabel} ${index + 1}`}
                  onClick={() => setCurrentVendorIndex(index)}
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    margin: "0 4px",
                    padding: 0,
                    border: "none",
                    background:
                      index === currentVendorIndex ? "#0b5cff" : "#ccc",
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const primaryLinkStyle = {
  display: "inline-block",
  width: "fit-content",
  margin: "6px auto 0",
  padding: "10px 14px",
  borderRadius: 8,
  background: "#0b5cff",
  color: "#fff",
  textDecoration: "none",
  fontWeight: 700,
};
const memberGridButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 56,
  padding: "14px 12px",
  borderRadius: 12,
  border: "1px solid #d1d5db",
  background: "#ffffff",
  color: "#111827",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 16,
  textAlign: "left",
  boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
};
