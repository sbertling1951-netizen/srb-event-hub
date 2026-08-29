"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import AnnouncementBanner from "@/components/AnnouncementBanner";
import ContextCard from "@/components/ContextCard";
import { MemberShellAdapter } from "@/components/shell/adapters/MemberShellAdapter";
import {
  collectSharedExperienceContext,
  type PrimaryExperienceSignal,
  resolvePrimaryExperienceContext,
} from "@/lib/experienceContext";
import {
  type CurrentMemberEvent,
  getCurrentMemberAttendeeId,
  getCurrentMemberEvent,
  getStoredMemberEmail,
  getStoredMemberEntryId,
} from "@/lib/getCurrentMemberEvent";
import {
  getMemberSession,
  memberIdentityRpcArgs,
} from "@/lib/memberSession";
import { supabase } from "@/lib/supabase";
import { getTenantLabel } from "@/lib/tenantLabels";
import { formatVendorNoticeDisplay, type VendorNotice } from "@/lib/vendorNotice";

type DashboardVendor = {
  id: string;
  business_name: string;
  business_description: string | null;
  logo_url: string | null;
  signup_url: string | null;
  is_featured: boolean | null;
  action_type: string;
  currentNotice: VendorNotice | null;
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
  // Distinguishes "haven't heard back yet" from "heard back with zero
  // vendors" so the empty-but-successful case can never be rendered
  // (or momentarily flash) as though it were an error.
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [currentVendorIndex, setCurrentVendorIndex] = useState(0);

  // participant_capacity is the stored authorized participant capacity (set
  // by CSV import or an Event Administrator adding a participant or an
  // open slot). null means capacity was never established for this
  // attendee and must not be treated as zero.
  const [participantCapacity, setParticipantCapacity] = useState<
    number | null
  >(null);
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>(
    [],
  );
  // has_arrived from the same get_my_attendee_record call that already
  // supplies participantCapacity; threaded through for the shared
  // experience context rather than issuing a second RPC call.
  const [checkedIn, setCheckedIn] = useState<boolean | null>(null);
  const [primaryContext, setPrimaryContext] =
    useState<PrimaryExperienceSignal | null>(null);
  // Recomputes time-sensitive Shared Experience Context once per minute.
  // This is not a visible dashboard clock.
  const [now, setNow] = useState(new Date());

  const router = useRouter();
  const dashboardTitle = getTenantLabel("dashboard_title");
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

            const session = getMemberSession();
            const rpcArgs = {
              p_event_id: memberEvent.id,
              ...memberIdentityRpcArgs(session),
            };

            const { data: recordData, error: recordError } =
              await supabase.rpc("get_my_attendee_record", rpcArgs);
            if (recordError) {
              throw recordError;
            }
            const record = Array.isArray(recordData) ? recordData[0] : null;
            setParticipantCapacity(record?.participant_capacity ?? null);
            setCheckedIn(
              typeof record?.has_arrived === "boolean"
                ? record.has_arrived
                : null,
            );

            // Get household members
            const { data: membersData, error: membersError } =
              await supabase.rpc("get_my_household_members", rpcArgs);
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

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  // Drives the primary Context Card. Requires the event context this
  // component already resolved above; the collector performs no Person,
  // Workspace, or event resolution of its own. Re-runs on the same minute
  // tick as the header clock so "now"/"next" agenda framing stays current.
  useEffect(() => {
    if (!currentEvent) {
      setPrimaryContext(null);
      return;
    }

    let cancelled = false;

    (async () => {
      const session = getMemberSession();

      try {
        const sharedContext = await collectSharedExperienceContext({
          event: currentEvent,
          now,
          attendeeId: getCurrentMemberAttendeeId(),
          participantCapacity,
          participantCount: householdMembers.length,
          checkedIn,
          eventCode: session?.event_code ?? null,
          registrationIdentifier:
            session?.attendee_email || session?.attendee_phone || null,
        });

        if (cancelled) {
          return;
        }

        setPrimaryContext(resolvePrimaryExperienceContext(sharedContext));
      } catch (err) {
        console.error("Shared experience context collection failed:", err);
        if (!cancelled) {
          setPrimaryContext(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentEvent, participantCapacity, householdMembers, checkedIn, now]);

  const loadVendors = useCallback(async () => {
    try {
      setVendorsLoading(true);
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
          vendors!inner (
            id,
            business_name,
            business_description,
            logo_url
          )
        `,
        )
        .eq("event_id", event.id)
        .eq("is_visible_to_members", true)
        .eq("vendors.is_active", true)
        .order("display_order", { ascending: true });

      if (error) {
        throw error;
      }

      // Supabase does not infer this joined relationship shape here; the select above defines it.
      const rows = (data || []) as EventVendorRow[];

      // Governed read boundary for attendee-facing vendor "Notice" content
      // (public.vendor_event_status): anon holds no raw SELECT grant on
      // that table (correctly hardened alongside the recent vendor
      // governance work), so a direct table read fails for Temporary
      // Event Access. resolve_attendee_visible_vendor_notices re-derives
      // the Event's own visibility/status admission predicate and the
      // same is_visible_to_members/is_active scoping the vendor listing
      // above already requires, returning only the four attendee-safe
      // Notice columns -- never a governance field. See
      // supabase/migrations/20260819120000_create_resolve_attendee_visible_vendor_notices.sql.
      let noticeByVendorId: Record<string, VendorNotice> = {};
      const { data: noticeRows, error: noticeError } = await supabase.rpc(
        "resolve_attendee_visible_vendor_notices",
        { p_event_id: event.id },
      );

      if (noticeError) {
        console.error("Vendor notice load error:", noticeError);
      } else {
        noticeByVendorId = Object.fromEntries(
          (noticeRows || []).map(
            (row: VendorNotice & { vendor_id: string }) => [
              row.vendor_id,
              row as VendorNotice,
            ],
          ),
        );
      }

      const cleaned = rows
        .map((row): DashboardVendor | null => {
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
            currentNotice: noticeByVendorId[vendor.id] || null,
          };
        })
        .filter((vendor): vendor is DashboardVendor => vendor !== null);

      setVendors(cleaned);
      setCurrentVendorIndex(0);
    } catch (err) {
      console.error("Vendor load error:", err);
      setVendorError(
        err instanceof Error ? err.message : "Could not load event vendors.",
      );
    } finally {
      setVendorsLoading(false);
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
    return (
      <MemberShellAdapter pageTitle={dashboardTitle}>
        <div>Loading...</div>
      </MemberShellAdapter>
    );
  }

  if (!currentEvent) {
    return (
      <MemberShellAdapter pageTitle={dashboardTitle}>
        <div />
      </MemberShellAdapter>
    );
  }

  return (
    <MemberShellAdapter pageTitle={dashboardTitle}>
      <div style={{ display: "grid", gap: 18, maxWidth: 1000, minWidth: 0 }}>
      <AnnouncementBanner />

      <ContextCard signal={primaryContext} onNavigate={goTo} />

      {/* Participants */}
      {(() => {
        const hasKnownCapacity = typeof participantCapacity === "number";
        const capacityValue = hasKnownCapacity
          ? (participantCapacity as number)
          : null;
        const isOverCapacity =
          hasKnownCapacity && householdMembers.length > (capacityValue as number);
        const vacantSlots = hasKnownCapacity
          ? Math.max((capacityValue as number) - householdMembers.length, 0)
          : 0;

        return (
          <div
            className="card"
            style={{
              minWidth: 0,
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
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 12,
              }}
            >
              <h2 style={{ margin: 0 }}>Participants</h2>
              <div
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: isOverCapacity ? "#fef3c7" : "#eff6ff",
                  color: isOverCapacity ? "#b45309" : "#1d4ed8",
                  fontWeight: 700,
                }}
              >
                {householdMembers.length} of {capacityValue ?? "—"}
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
              participants until all authorized participant slots are
              filled.
            </div>

            {isOverCapacity && (
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#b45309",
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: 8,
                  padding: "8px 12px",
                  marginBottom: 12,
                }}
              >
                ⚠ Participant roster exceeds authorized capacity.
                Administrator review required.
              </div>
            )}

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
                      minWidth: 0,
                      padding: "10px 12px",
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {name}
                  </div>
                );
              })}

              {Array.from({ length: vacantSlots }).map((_, index) => (
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

            {vacantSlots > 0 && (
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
        );
      })()}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(160px, 100%), 1fr))",
          gap: 12,
          marginTop: 12,
        }}
      >
        <button
          type="button"
          onClick={() => goTo("/member/account")}
          style={memberGridButtonStyle}
        >
          My Events
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

        <button
          type="button"
          onClick={() => goTo("/member/my-assignments")}
          style={memberGridButtonStyle}
        >
          📋 My Assignments
        </button>
      </div>

      {vendorsLoading ? null : vendorError ? (
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
      ) : vendors.length > 0 ? (
        <div
          className="card"
          style={{
            minWidth: 0,
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

              <div
                style={{ fontWeight: 800, fontSize: 20, overflowWrap: "anywhere" }}
              >
                {activeVendor.business_name}
              </div>

              {activeVendor.business_description ? (
                <div
                  style={{
                    fontSize: 14,
                    color: "#555",
                    lineHeight: 1.45,
                    overflowWrap: "anywhere",
                  }}
                >
                  {activeVendor.business_description}
                </div>
              ) : null}

              {formatVendorNoticeDisplay(activeVendor.currentNotice) ? (
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {formatVendorNoticeDisplay(activeVendor.currentNotice)}
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
    </MemberShellAdapter>
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
