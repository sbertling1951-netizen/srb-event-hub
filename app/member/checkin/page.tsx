"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { MemberShellAdapter } from "@/components/shell/adapters/MemberShellAdapter";
import { logEngagement } from "@/lib/engagement";
import { preferredDisplayLine } from "@/lib/formatters";
import { clearMemberLocalState } from "@/lib/memberAccountSession";
import { memberIdentityRpcArgs } from "@/lib/memberSession";
import { useMemberWorkspace } from "@/lib/memberWorkspace/useMemberWorkspace";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { supabase } from "@/lib/supabase";

type AttendeeRow = {
  id: string;
  entry_id?: string | null;
  email?: string | null;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  assigned_site: string | null;
  share_with_attendees: boolean | null;
  has_arrived: boolean | null;
};

// Confirmed site comes only from canonical Parking occupancy (Site
// Assignment Governance Architecture §7; Site Placement Implementation
// Specification §9.2 item 9) -- never from attendees.assigned_site and
// never from what the member types into the report field below.
type ConfirmedSitePlacement = {
  parking_site_id: string;
  master_site_id: string;
  site_number: string | null;
  display_label: string | null;
};

type HouseholdMember = {
  id: string;
  attendee_id: string;
  person_role: "pilot" | "copilot" | "additional";
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  display_name: string | null;
  age_text: string | null;
  sort_order: number | null;
  raw_text: string | null;
};

type CheckinResult = {
  id: string;
  assigned_site: string | null;
  share_with_attendees: boolean;
  has_arrived: boolean;
};

// This page still offers only a single "share" checkbox -- the granular
// per-field panel is Admin Check-In's UI (deliberately not duplicated
// into member self-service in this workstream). Turning it on is the
// coarse-grained equivalent of Select All against the same governed
// registry Admin Check-In writes to; turning it off fully opts out. When
// this page eventually gains its own granular controls, this becomes the
// default rather than a redesign of the write path itself.
const MEMBER_SHARE_ALL_FIELD_KEYS = [
  "email",
  "phone",
  "campsite_location",
  "coach_make_model",
];

function householdLine(member: HouseholdMember) {
  const first = member.first_name?.trim() || "";
  const last = member.last_name?.trim() || "";

  if (first || last) {
    return `${first} ${last}`.trim();
  }

  return preferredDisplayLine(member);
}

function MemberCheckinPageInner() {
  const router = useRouter();
  const { event, attendeeId, isReady, session } = useMemberWorkspace();
  const [attendee, setAttendee] = useState<AttendeeRow | null>(null);
  const [household, setHousehold] = useState<HouseholdMember[]>([]);
  const [confirmedSite, setConfirmedSite] = useState<ConfirmedSitePlacement | null>(
    null,
  );
  const [shareWithAttendees, setShareWithAttendees] = useState(false);
  // Always starts blank -- this is a forward-looking report prompt, never
  // a display of stored state, so it can never be confused with a
  // previously confirmed or previously reported value.
  const [siteReport, setSiteReport] = useState("");
  const [requiresTemporaryCredentials, setRequiresTemporaryCredentials] =
    useState<boolean | null>(null);
  const [temporaryEventCode, setTemporaryEventCode] = useState("");
  const [temporaryRegistrationIdentifier, setTemporaryRegistrationIdentifier] =
    useState("");
  const [status, setStatus] = useState("Loading check-in...");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Defense-in-depth only: MemberRouteGuard normally intercepts a lapsed
  // Account session upstream. If one still reaches this page, the identity
  // lookup fails purely because there is no auth.uid() -- not because
  // attendee identity is missing -- so we surface a sign-in prompt here
  // rather than a misleading "login needs to store attendee identity".
  const [needsReauth, setNeedsReauth] = useState(false);

  const loadPage = useCallback(async () => {
    try {
      setStatus("Loading check-in...");
      setError(null);
      setNeedsReauth(false);

      if (!isReady) {
        setStatus("Loading check-in...");
        return;
      }

      if (!event?.id || !attendeeId) {
        setAttendee(null);
        setHousehold([]);
        setConfirmedSite(null);
        setStatus("Loading check-in...");
        return;
      }

      const { data: attendeeRecordData, error: attendeeError } =
        await supabase.rpc("get_my_attendee_record", {
          p_event_id: event.id,
          ...memberIdentityRpcArgs(session),
        });

      if (attendeeError) {
        throw attendeeError;
      }

      const attendeeRow = (
        Array.isArray(attendeeRecordData) ? attendeeRecordData[0] : null
      ) as AttendeeRow | null;

      if (!attendeeRow) {
        setAttendee(null);
        setHousehold([]);
        setConfirmedSite(null);

        // An account-origin session (fcoc-member-auth-user-id present) that
        // reaches this point with no live Supabase Auth session failed the
        // identity lookup only because there is no auth.uid() to resolve
        // the canonical Person -> Participation -> attendee path -- the
        // attendee record itself is not missing. Present it as an expired
        // session, not a data problem. (The Guard should normally have
        // caught this first; this branch is the fallback.)
        const accountOrigin =
          typeof window !== "undefined" &&
          !!localStorage.getItem(STORAGE_KEYS.memberAuthUserId);
        const capabilityOrigin = !!session?.temporary_capability_hash;
        const { data: sessionData } = await supabase.auth.getSession();

        if (capabilityOrigin && !sessionData.session) {
          clearMemberLocalState();
          router.replace("/member/login?sessionExpired=1");
          return;
        }

        if (accountOrigin && !sessionData.session) {
          setNeedsReauth(true);
          setStatus(
            "Your account session has expired. Please sign in again to load your check-in.",
          );
          return;
        }

        setStatus(
          "We couldn't confirm your registration for self check-in. Sign in again, or use temporary event access below.",
        );
        return;
      }

      if (typeof window !== "undefined") {
        localStorage.setItem("fcoc-member-attendee-id", attendeeRow.id);
      }

      setAttendee(attendeeRow);

      setShareWithAttendees(!!attendeeRow.share_with_attendees);

      if (typeof window !== "undefined") {
        localStorage.setItem(
          "fcoc-member-has-arrived",
          String(!!attendeeRow.has_arrived),
        );
      }

      // Confirmed site is read separately from canonical Parking occupancy
      // -- never from attendeeRow.assigned_site, which is only a legacy
      // compatibility projection and must not be presented as authority.
      const { data: placementRows, error: placementError } = await supabase.rpc(
        "get_my_confirmed_site_placement",
        {
          p_event_id: event.id,
          ...memberIdentityRpcArgs(session),
        },
      );

      if (placementError) {
        throw placementError;
      }

      setConfirmedSite(
        (Array.isArray(placementRows) ? placementRows[0] : null) ||
          (null as ConfirmedSitePlacement | null),
      );

      const { data: memberRows, error: memberError } = await supabase.rpc(
        "get_my_household_members",
        {
          p_event_id: event.id,
          ...memberIdentityRpcArgs(session),
        },
      );

      if (memberError) {
        throw memberError;
      }
      setHousehold((memberRows || []) as HouseholdMember[]);

      setStatus("Self check-in ready.");
    } catch (err) {
      console.error("loadPage error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load self check-in.",
      );
      setStatus("");
    }
  }, [attendeeId, event?.id, isReady, router, session]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    if (!event?.id || !attendeeId) {
      return;
    }

    void loadPage();
  }, [attendeeId, event?.id, isReady, loadPage]);

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setRequiresTemporaryCredentials(
          !data.session && !session?.temporary_capability_hash,
        );
      }
    });

    return () => {
      active = false;
    };
  }, [session?.temporary_capability_hash]);

  useEffect(() => {
    if (!event?.id) {
      return;
    }

    const storedAttendeeId = localStorage.getItem("fcoc-member-attendee-id");
    if (!storedAttendeeId) {
      return;
    }

    void logEngagement({
      eventId: event.id,
      attendeeId: storedAttendeeId,
      activityType: "checkin_view",
    });
  }, [event?.id]);

  async function saveCheckin() {
    if (!attendee?.id || !event?.id) {
      setStatus("No attendee record found.");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const { data: sessionData } = await supabase.auth.getSession();
      const temporaryAccess = !sessionData.session;
      const hasCapability = !!session?.temporary_capability_hash;

      setRequiresTemporaryCredentials(temporaryAccess && !hasCapability);

      if (
        temporaryAccess &&
        !hasCapability &&
        (!temporaryEventCode.trim() || !temporaryRegistrationIdentifier.trim())
      ) {
        throw new Error(
          "Enter your event code and registration email or mobile number to save check-in.",
        );
      }

      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (sessionData.session?.access_token) {
        requestHeaders.Authorization = `Bearer ${sessionData.session.access_token}`;
      }

      const response = await fetch("/api/member/checkin", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          eventId: event.id,
          expectedAttendeeId: attendee.id,
          // Kept only for submit_member_checkin's stable request contract.
          // The governed RPC derives Arrival from its locked current state and
          // this report, never from a browser-supplied arrival decision.
          hasArrived: !!attendee.has_arrived,
          shareWithAttendees,
          assignedSite: siteReport,
          eventCode:
            temporaryAccess && !hasCapability
              ? temporaryEventCode.trim()
              : null,
          registrationIdentifier:
            temporaryAccess && !hasCapability
              ? temporaryRegistrationIdentifier.trim()
              : null,
          capabilityHash: hasCapability
            ? session?.temporary_capability_hash
            : null,
        }),
      });

      const responseBody = await response.json().catch(() => null);

      if (!response.ok) {
        if (
          hasCapability &&
          responseBody?.error === "temporary_access_invalid"
        ) {
          clearMemberLocalState();
          router.replace("/member/login?teaSessionExpired=1");
          return;
        }

        if (hasCapability) {
          throw new Error(
            "Your check-in could not be saved. Review the form and try again.",
          );
        }

        throw new Error(
          "Check-in verification failed. Re-enter your event code and registration email or mobile number.",
        );
      }

      const data = responseBody?.data;
      const updatedAttendee =
        Array.isArray(data) && data.length > 0
          ? (data[0] as CheckinResult)
          : null;

      if (!updatedAttendee?.id) {
        throw new Error(
          "Check-in verification failed. Re-enter your event code and registration email or mobile number.",
        );
      }

      // assigned_site is deliberately not read from updatedAttendee here --
      // this response reflects submit_member_checkin's own Arrival/sharing
      // update, and assigned_site is only a legacy compatibility
      // projection this page must never present as confirmed placement.
      // The site report just submitted is evidence only, recorded
      // separately; it is cleared below rather than echoed back as if it
      // were now a stored, confirmed value.
      setAttendee((prev) =>
        prev
          ? {
              ...prev,
              share_with_attendees: updatedAttendee.share_with_attendees,
              has_arrived: updatedAttendee.has_arrived,
            }
          : prev,
      );
      setSiteReport("");

      // Check-in itself has already been governedly recorded above. The
      // sharing-preference write is a separate governed call against a
      // separate domain concept (see the transaction-boundary note in
      // saveCheckin's outer scope) -- its own failure must never read as
      // "check-in failed," since it did not.
      const { data: sharingData, error: sharingError } = await supabase.rpc(
        "set_member_attendee_sharing_preferences",
        {
          p_event_id: event.id,
          ...(hasCapability
            ? memberIdentityRpcArgs(session)
            : {
                p_event_code: temporaryAccess
                  ? temporaryEventCode.trim()
                  : null,
                p_registration_identifier: temporaryAccess
                  ? temporaryRegistrationIdentifier.trim()
                  : null,
              }),
          p_shared_field_keys: shareWithAttendees
            ? MEMBER_SHARE_ALL_FIELD_KEYS
            : [],
        },
      );

      const sharingResult = sharingData?.[0];
      if (sharingError || !sharingResult || sharingResult.outcome === "rejected") {
        setError(
          "Your check-in was saved, but your sharing choice could not be saved. Please try Save again.",
        );
        setStatus("");
        return;
      }

      // Update local state immediately before navigating.
      if (typeof window !== "undefined") {
        localStorage.setItem(
          "fcoc-member-has-arrived",
          String(updatedAttendee.has_arrived),
        );
      }

      setStatus("Your check-in preferences were saved.");

      // Use client navigation to avoid reload/race condition.
      router.replace("/member");
      return;
    } catch (err) {
      console.error("saveCheckin error:", err);
      setError(err instanceof Error ? err.message : "Failed to save check-in.");
      setStatus("");
    } finally {
      setSaving(false);
    }
  }

  const participantCapacity = event?.participant_capacity ?? 0;
  const participantCount = household.length;
  const availableSlots = Math.max(0, participantCapacity - participantCount);

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 760 }}>
      {status ? (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "#f8f9fb",
            padding: 14,
            fontSize: 13,
            color: "#666",
          }}
        >
          {status}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          style={{
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#991b1b",
            borderRadius: 10,
            padding: 14,
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      ) : null}

      {!attendee ? (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
            color: "#666",
            display: "grid",
            gap: 12,
          }}
        >
          {needsReauth ? (
            <>
              <div>
                Your account session has expired. Sign in again to load your
                check-in.
              </div>
              <Link
                href="/member/login?sessionExpired=1"
                style={{
                  display: "inline-block",
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#0b5cff",
                  color: "#fff",
                  textDecoration: "none",
                  fontWeight: 700,
                  justifySelf: "start",
                }}
              >
                Sign in again
              </Link>
            </>
          ) : (
            "No attendee record is available for self check-in."
          )}
        </div>
      ) : (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
            display: "grid",
            gap: 14,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              Coach / Household
            </div>
            {household.length > 0 ? (
              <div style={{ display: "grid", gap: 4 }}>
                {household.map((member) => (
                  <div key={member.id} style={{ overflowWrap: "anywhere" }}>
                    {member.person_role === "pilot"
                      ? "Pilot"
                      : member.person_role === "copilot"
                        ? "Co-Pilot"
                        : "Additional"}
                    : {householdLine(member)}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "#666" }}>
                {attendee.pilot_first || attendee.pilot_last
                  ? `${attendee.pilot_first || ""} ${attendee.pilot_last || ""}`.trim()
                  : "Attendee"}
                {attendee.copilot_first || attendee.copilot_last
                  ? ` / ${`${attendee.copilot_first || ""} ${attendee.copilot_last || ""}`.trim()}`
                  : ""}
              </div>
            )}
          </div>

          {availableSlots > 0 ? (
            <div>
              <Link
                href="/member/participants"
                style={{
                  display: "inline-block",
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  textDecoration: "none",
                  fontWeight: 600,
                  color: "inherit",
                }}
              >
                ➕👤 Add Participant
              </Link>
            </div>
          ) : null}

          <div
            style={{ display: "grid", gap: 10, width: "100%", maxWidth: 360, minWidth: 0 }}
          >
            <div style={{ fontSize: 13, color: "#334155" }}>
              Confirmed site:{" "}
              <strong>
                {confirmedSite
                  ? confirmedSite.display_label ||
                    confirmedSite.site_number ||
                    "Assigned"
                  : "Not yet confirmed by Parking"}
              </strong>
            </div>

            <label>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                What site are you parked in?
              </div>
              <input
                value={siteReport}
                onChange={(e) => setSiteReport(e.target.value.toUpperCase())}
                placeholder="e.g. A12"
                style={{ width: "100%", padding: 10 }}
              />
              <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                Leave this blank if you don&apos;t know your site yet or
                haven&apos;t parked. This tells us where you are -- it does
                not assign or reserve a site.
              </div>
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input
                type="checkbox"
                checked={shareWithAttendees}
                onChange={(e) => setShareWithAttendees(e.target.checked)}
              />
              Share my site / household details with other attendees
            </label>

            {requiresTemporaryCredentials ? (
              <div
                style={{
                  borderTop: "1px solid #e2e8f0",
                  paddingTop: 14,
                  display: "grid",
                  gap: 10,
                }}
              >
                <strong>Verify temporary event access</strong>
                <div style={{ color: "#475569", fontSize: 14 }}>
                  Re-enter your event code and the email address or mobile number
                  used for registration to save check-in.
                </div>
                <input
                  type="text"
                  value={temporaryEventCode}
                  onChange={(event) => setTemporaryEventCode(event.target.value)}
                  placeholder="Event code"
                  autoComplete="off"
                  style={{ width: "100%", minWidth: 0, padding: 10 }}
                />
                <input
                  type="text"
                  value={temporaryRegistrationIdentifier}
                  onChange={(event) =>
                    setTemporaryRegistrationIdentifier(event.target.value)
                  }
                  placeholder="Registration email or mobile number"
                  autoComplete="off"
                  style={{ width: "100%", minWidth: 0, padding: 10 }}
                />
              </div>
            ) : null}
          </div>

          <div>
            <button
              type="button"
              onClick={() => void saveCheckin()}
              disabled={saving}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                background: "#fff",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MemberCheckinPage() {
  return (
    <MemberRouteGuard>
      <MemberShellAdapter pageTitle="My Check-In">
        <MemberCheckinPageInner />
      </MemberShellAdapter>
    </MemberRouteGuard>
  );
}
