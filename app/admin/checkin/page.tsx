"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  checkinServerFingerprint,
  filterCheckinBrowseAttendees,
  reconcileCheckinEditState,
  selectedAttendeeChangedRemotely,
} from "@/app/admin/checkin/checkinWorkflow";
import { AdminReturnLink } from "@/components/admin/AdminReturnLink";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useShellInterfaceCapabilities } from "@/components/shell/useShellViewport";
import { Alert } from "@/components/ui/Alert";
import { AppButton, AppLinkButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { DataTable, ResponsiveList } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Checkbox } from "@/components/ui/Field";
import { PageSection } from "@/components/ui/PageSection";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/StatusBadge";
import {
  SearchField,
  TableToolbar,
  TableToolbarPrimaryRow,
} from "@/components/ui/TableToolbar";
import { buildAdminAttendeeTargetHref } from "@/lib/adminAttendeeTarget";
import {
  readAdminAttendeeTarget,
  resolveAdminAttendeeTarget,
} from "@/lib/adminAttendeeTarget";
import { getSharingBulkAction } from "@/lib/adminCheckinSharing";
import { useAdmin } from "@/lib/adminContext";
import {
  getCurrentAdminEvent,
  useAdminWorkingEventScope,
} from "@/lib/adminWorkspaceContext";
import { fullName, preferredDisplayLine } from "@/lib/formatters";
import { canAccessEvent } from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

// Check-In owns Arrival only (Admin Check-In / Parking ownership cutover,
// Stage A). complete_admin_checkin no longer accepts or performs any
// placement action -- these are the codes it, and the Event lifecycle guard
// it now enforces, can actually return.
const CHECKIN_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "You do not have check-in authority for this event.",
  authorization_denied: "You do not have check-in authority for this event.",
  attendee_not_found: "Attendee not found.",
  event_scope_mismatch: "Your admin working event changed. Reload and try again.",
  event_archived: "This Event is archived and can no longer be modified.",
  event_lifecycle_indeterminate:
    "This Event's lifecycle state could not be determined. Contact an administrator.",
  unknown_share_field:
    "One of the sharing choices was not recognized. Please try again.",
};

function mapCheckinError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : "";
  return CHECKIN_ERROR_MESSAGES[raw] || raw || fallback;
}

type AttendeeRow = {
  id: string;
  entry_id: string | null;
  email: string | null;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  coach_make: string | null;
  coach_model: string | null;
  coach_length: string | null;
  assigned_site: string | null;
  has_arrived: boolean | null;
  arrival_status: string | null;
  handicap_parking: boolean | null;
  volunteer: boolean | null;
  first_time: boolean | null;
};

// The four attendee-chosen optional sharing fields, per the governed
// attendee_sharing_fields registry. Name is deliberately excluded here --
// it is the mandatory participation identity, derived automatically
// (server-side) from whether any of these four are on, never an
// independent choice this page submits.
const SHARING_OPTIONAL_FIELDS = [
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "campsite_location", label: "Campsite location" },
  { key: "coach_make_model", label: "Coach make/model" },
] as const;

type SharingFieldKey = (typeof SHARING_OPTIONAL_FIELDS)[number]["key"];

type SharingPreferenceRow = {
  attendee_id: string;
  field_key: string;
  shared: boolean;
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

type AdminEventRow = {
  id: string;
  name: string;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
};

type EditState = {
  sharedFields: SharingFieldKey[];
};

type CheckinFailureCategory =
  | "authority"
  | "lifecycle"
  | "connectivity"
  | "conflict";

type CheckinOperationFailure = {
  category: CheckinFailureCategory;
  message: string;
  retry: { attendeeId: string; nextHasArrived: boolean } | null;
};

function householdLine(member: HouseholdMember) {
  return preferredDisplayLine(member);
}

function getRoleMember(members: HouseholdMember[], role: "pilot" | "copilot") {
  return members.find((m) => m.person_role === role) || null;
}

// Read-only presentation only -- Check-In owns Arrival mutation directly
// (below), but Placement here is always sourced from the already-loaded
// assigned_site projection, never written by this page (Site Assignment
// Governance Architecture Section 4.1: Parking alone owns placement).
function arrivalPresentation(attendee: {
  has_arrived: boolean | null;
}): { label: string; tone: StatusBadgeTone } {
  return attendee.has_arrived
    ? { label: "Checked in", tone: "success" }
    : { label: "Waiting", tone: "neutral" };
}

function placementPresentation(attendee: {
  assigned_site: string | null;
}): { label: string; tone: StatusBadgeTone } {
  return attendee.assigned_site
    ? { label: `Site ${attendee.assigned_site.toUpperCase()}`, tone: "success" }
    : { label: "Not yet placed", tone: "neutral" };
}

function classifyCheckinFailure(error: unknown): CheckinOperationFailure {
  const message = error instanceof Error ? error.message : "Check-In failed.";
  if (/archived|lifecycle/i.test(message)) {
    return { category: "lifecycle", message, retry: null };
  }
  if (/authority|authorized|permission/i.test(message)) {
    return { category: "authority", message, retry: null };
  }
  if (/changed|scope|another station/i.test(message)) {
    return { category: "conflict", message, retry: null };
  }
  if (/network|fetch|offline|connection|timeout/i.test(message)) {
    return { category: "connectivity", message, retry: null };
  }
  return { category: "connectivity", message, retry: null };
}

export default function AdminCheckinPage() {
  return (
    <AdminRouteGuard requiredTask="event.checkin.manage">
      <AdminShellAdapter pageTitle="Admin Check-In">
        <AdminCheckinPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

function AdminCheckinPageInner() {
  const [event, setEvent] = useState<AdminEventRow | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>(
    [],
  );
  const [sharingByAttendee, setSharingByAttendee] = useState<
    Record<string, SharingFieldKey[]>
  >({});
  const [search, setSearch] = useState("");
  const [showArrived, setShowArrived] = useState(false);
  const [selectedAttendeeId, setSelectedAttendeeId] = useState<string | null>(
    null,
  );
  const [status, setStatus] = useState("Loading check-in...");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<Record<string, EditState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [undoAttendee, setUndoAttendee] = useState<AttendeeRow | null>(null);
  const [sharingRetry, setSharingRetry] = useState<{
    attendeeId: string;
    sharedFields: SharingFieldKey[];
  } | null>(null);
  const [selectedIsDirty, setSelectedIsDirty] = useState(false);
  const [selectedConflict, setSelectedConflict] = useState<string | null>(null);
  const [recentCompletion, setRecentCompletion] = useState<{
    attendeeId: string;
    attendeeName: string;
    message: string;
  } | null>(null);
  const [operationFailure, setOperationFailure] =
    useState<CheckinOperationFailure | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selectedAttendeeIdRef = useRef<string | null>(null);
  const selectedIsDirtyRef = useRef(false);
  const selectedBaselineRef = useRef<string | null>(null);
  const editStateRef = useRef<Record<string, EditState>>({});
  const loadGenerationRef = useRef(0);
  // Guards the canonical attendee-target handoff (lib/adminAttendeeTarget)
  // so it is consumed exactly once per raw target value -- never re-run on
  // every realtime-triggered loadPage() reload, which would otherwise
  // silently override whatever the admin has since selected.
  const consumedAttendeeTargetRef = useRef<string | null>(null);

  const { admin } = useAdmin();
  const { isCompact } = useShellInterfaceCapabilities();
  const searchParams = useSearchParams();
  const attendeeTarget = readAdminAttendeeTarget(searchParams);

  function showStatus(message: string) {
    setError(null);
    setStatus(message);
  }

  function showError(message: string) {
    setError(message);
    setStatus("");
  }

  useEffect(() => {
    if (!admin) {
      return;
    }

    const adminEvent = getCurrentAdminEvent();

    if (!adminEvent?.id) {
      setEvent(null);
      setAttendees([]);
      setHouseholdMembers([]);
      setSharingByAttendee({});
      showStatus("No admin working event selected.");
      setLoading(false);
      return;
    }

    if (!canAccessEvent(admin, adminEvent.id)) {
      setEvent(null);
      setAttendees([]);
      setHouseholdMembers([]);
      setSharingByAttendee({});
      showError("You do not have access to this event.");
      setLoading(false);
      return;
    }

    void loadPage();
    // loadPage is intentionally omitted from deps to avoid changing the established admin event reload flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  // Working-Event change (this tab or another): synchronously drop Event A's
  // roster so it can never render under Event B's header, and neutralize row
  // actions (they early-return while `event` is null) until the reload of
  // Event B completes. The reload bumps `loadGenerationRef`, so any in-flight
  // Event-A fetch is already rejected by the existing generation check below.
  useAdminWorkingEventScope(() => {
    setEvent(null);
    setAttendees([]);
    setHouseholdMembers([]);
    setSharingByAttendee({});
    setSelectedAttendeeId(null);
    setUndoAttendee(null);
    setEditState({});
    setLoading(true);
    showStatus("Loading check-in...");
    void loadPage();
  });

  useEffect(() => {
    if (!event?.id) {
      return;
    }

    // Placement lives in Parking's own domain now (Stage A); Check-In only
    // needs to reconcile when the attendees roster itself changes -- which
    // already covers a Parking-originated assigned_site projection update,
    // since record_site_placement writes that projection on the same row.
    const attendeesChannel = supabase
      .channel(`admin-checkin-attendees-${event.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "attendees",
          filter: `event_id=eq.${event.id}`,
        },
        async () => {
          await loadPage({ preserveSelectedEdit: true, silent: true });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(attendeesChannel);
    };
    // loadPage is intentionally omitted to avoid resubscribing on every reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id]);

  async function loadPage(
    options: { preserveSelectedEdit?: boolean; silent?: boolean } = {},
  ) {
    const generation = ++loadGenerationRef.current;
    try {
      if (!options.silent) {
        setLoading(true);
        showStatus("Loading check-in...");
      }

      const adminEvent = getCurrentAdminEvent();
      if (!adminEvent?.id) {
        setEvent(null);
        setAttendees([]);
        setHouseholdMembers([]);
        setSharingByAttendee({});
        showStatus("No admin working event selected.");
        setLoading(false);
        return;
      }

      const { data: eventRow, error: eventError } = await supabase
        .from("events")
        .select("id,name,location,start_date,end_date")
        .eq("id", adminEvent.id)
        .single();

      if (eventError) {
        throw eventError;
      }

      // A working-Event change while this fetch was in flight already
      // started a newer loadPage() (bumping loadGenerationRef). Bail before
      // re-showing the previous Event's header row.
      if (generation !== loadGenerationRef.current) {
        return;
      }

      const loadedEvent = eventRow as AdminEventRow;
      setEvent(loadedEvent);

      const [attendeeResult, sharingResult] = await Promise.all([
        supabase
          .from("attendees")
          .select(
            `
  id,
  entry_id,
  email,
  pilot_first,
  pilot_last,
  copilot_first,
  copilot_last,
  coach_make:coach_manufacturer,
  coach_model,
  coach_length,
  assigned_site,
  has_arrived,
  arrival_status,
  handicap_parking,
  volunteer:wants_to_volunteer,
  first_time:is_first_timer
`,
          )
          .eq("event_id", loadedEvent.id)
          .order("pilot_last", { ascending: true, nullsFirst: false })
          .order("pilot_first", { ascending: true, nullsFirst: false }),
        supabase.rpc("get_admin_attendee_sharing_preferences", {
          p_event_id: loadedEvent.id,
        }),
      ]);

      if (attendeeResult.error) {
        throw attendeeResult.error;
      }
      if (sharingResult.error) {
        throw sharingResult.error;
      }

      const attendeeList = (attendeeResult.data || []) as AttendeeRow[];
      const sharingRows = (sharingResult.data || []) as SharingPreferenceRow[];

      const optionalFieldKeys = new Set<string>(
        SHARING_OPTIONAL_FIELDS.map((field) => field.key),
      );
      const nextSharingByAttendee: Record<string, SharingFieldKey[]> = {};
      sharingRows.forEach((row) => {
        if (!row.shared || !optionalFieldKeys.has(row.field_key)) {
          return;
        }
        const existing = nextSharingByAttendee[row.attendee_id] || [];
        existing.push(row.field_key as SharingFieldKey);
        nextSharingByAttendee[row.attendee_id] = existing;
      });

      const attendeeIds = attendeeList.map((a) => a.id);
      let nextHouseholdMembers: HouseholdMember[] = [];

      if (attendeeIds.length > 0) {
        const { data: memberRows, error: memberError } = await supabase
          .from("attendee_household_members")
          .select(
            "id,attendee_id,person_role,first_name,last_name,nickname,display_name,age_text,sort_order,raw_text",
          )
          .in("attendee_id", attendeeIds)
          .order("sort_order", { ascending: true, nullsFirst: false });

        if (memberError) {
          throw memberError;
        }

        nextHouseholdMembers = (memberRows || []) as HouseholdMember[];
      }

      if (generation !== loadGenerationRef.current) {
        return;
      }

      setAttendees(attendeeList);
      setSharingByAttendee(nextSharingByAttendee);
      setHouseholdMembers(nextHouseholdMembers);

      const nextEditState: Record<string, EditState> = {};
      attendeeList.forEach((attendee) => {
        nextEditState[attendee.id] = {
          sharedFields: nextSharingByAttendee[attendee.id] || [],
        };
      });
      const selectedId = selectedAttendeeIdRef.current;
      const selectedServerAttendee = selectedId
        ? attendeeList.find((attendee) => attendee.id === selectedId) || null
        : null;
      const selectedServerFingerprint = selectedServerAttendee
        ? checkinServerFingerprint(
            selectedServerAttendee,
            nextSharingByAttendee[selectedServerAttendee.id] || [],
          )
        : null;

      if (
        options.preserveSelectedEdit &&
        selectedAttendeeChangedRemotely(
          selectedBaselineRef.current,
          selectedServerFingerprint,
          selectedIsDirtyRef.current,
        )
      ) {
        setSelectedConflict(
          "This attendee changed at another Check-In station. Reload their current record before continuing.",
        );
      }

      const reconciledEditState = reconcileCheckinEditState(
        nextEditState,
        editStateRef.current,
        selectedId,
        !!options.preserveSelectedEdit && selectedIsDirtyRef.current,
      );
      editStateRef.current = reconciledEditState;
      setEditState(reconciledEditState);

      if (selectedId && !selectedIsDirtyRef.current) {
        selectedBaselineRef.current = selectedServerFingerprint;
      }

      if (!options.silent) {
        showStatus(`Loaded ${attendeeList.length} attendees for check-in.`);
      }
    } catch (err: any) {
      console.error("loadPage error:", err);
      showError(err?.message || "Failed to load admin check-in.");
    } finally {
      if (!options.silent && generation === loadGenerationRef.current) {
        setLoading(false);
      }
    }
  }

  const householdByAttendee = useMemo(() => {
    const map = new Map<string, HouseholdMember[]>();
    householdMembers.forEach((member) => {
      const existing = map.get(member.attendee_id) || [];
      existing.push(member);
      map.set(member.attendee_id, existing);
    });
    return map;
  }, [householdMembers]);

  const filteredAttendees = useMemo(
    () =>
      filterCheckinBrowseAttendees(attendees, search, showArrived, (attendee) =>
        (householdByAttendee.get(attendee.id) || [])
          .map((member) =>
            [
              member.display_name,
              member.first_name,
              member.last_name,
              member.nickname,
              member.raw_text,
            ]
              .filter(Boolean)
              .join(" "),
          )
          .join(" "),
      ),
    [attendees, householdByAttendee, search, showArrived],
  );

  const selectedAttendee = useMemo(
    () =>
      attendees.find((attendee) => attendee.id === selectedAttendeeId) || null,
    [attendees, selectedAttendeeId],
  );

  function selectAttendee(attendeeId: string) {
    const attendee = attendees.find((row) => row.id === attendeeId) || null;
    selectedAttendeeIdRef.current = attendeeId;
    selectedIsDirtyRef.current = false;
    selectedBaselineRef.current = attendee
      ? checkinServerFingerprint(attendee, sharingByAttendee[attendeeId] || [])
      : null;
    setSelectedAttendeeId(attendeeId);
    setSelectedIsDirty(false);
    setSelectedConflict(null);
    setError(null);
  }

  // Canonical attendee-target handoff (lib/adminAttendeeTarget): consumes
  // ?attendee=<id>, once per distinct value, once the current Event's own
  // roster has loaded. Resolution is purely against `attendees`, which
  // loadPage() has already filtered to the current working Event -- so a
  // stale, deleted, or cross-Event id simply will not be found here, and
  // this never fetches, never switches Event, and never mutates Arrival.
  useEffect(() => {
    if (!attendeeTarget || loading) {
      return;
    }
    if (consumedAttendeeTargetRef.current === attendeeTarget) {
      return;
    }

    const resolution = resolveAdminAttendeeTarget(attendeeTarget, attendees);

    if (resolution.status === "none") {
      return;
    }

    consumedAttendeeTargetRef.current = attendeeTarget;

    if (resolution.status === "valid") {
      selectAttendee(resolution.attendeeId);
      return;
    }

    showError(
      "That attendee could not be found in the current Check-In event. They may have been removed, or the link may be for a different event.",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendeeTarget, attendees, loading]);

  function closeSelectedAttendee() {
    selectedAttendeeIdRef.current = null;
    selectedIsDirtyRef.current = false;
    selectedBaselineRef.current = null;
    setSelectedAttendeeId(null);
    setSelectedIsDirty(false);
    setSelectedConflict(null);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  async function reloadSelectedAttendee() {
    selectedIsDirtyRef.current = false;
    setSelectedIsDirty(false);
    setSelectedConflict(null);
    await loadPage();
  }

  function updateEditState(attendeeId: string, patch: Partial<EditState>) {
    setEditState((prev) => {
      const next = {
        ...prev,
        [attendeeId]: {
          ...prev[attendeeId],
          ...patch,
        },
      };
      editStateRef.current = next;
      return next;
    });
    if (selectedAttendeeIdRef.current === attendeeId) {
      selectedIsDirtyRef.current = true;
      setSelectedIsDirty(true);
    }
  }

  function toggleSharedField(attendeeId: string, fieldKey: SharingFieldKey) {
    const current = editState[attendeeId];
    if (!current) {
      return;
    }
    const isShared = current.sharedFields.includes(fieldKey);
    updateEditState(attendeeId, {
      sharedFields: isShared
        ? current.sharedFields.filter((key) => key !== fieldKey)
        : [...current.sharedFields, fieldKey],
    });
  }

  function toggleAllSharedFields(attendeeId: string) {
    const current = editState[attendeeId];
    if (!current) {
      return;
    }

    updateEditState(attendeeId, {
      sharedFields: getSharingBulkAction(
        SHARING_OPTIONAL_FIELDS.map((field) => field.key),
        current.sharedFields,
      ).sharedFields,
    });
  }

  async function saveSharingPreferences(
    attendee: AttendeeRow,
    sharedFields: SharingFieldKey[],
  ): Promise<string | null> {
    if (!event?.id) {
      return "No working event selected.";
    }

    const { data, error: sharingError } = await supabase.rpc(
      "set_attendee_sharing_preferences",
      {
        p_attendee_id: attendee.id,
        p_expected_event_id: event.id,
        p_shared_field_keys: sharedFields,
      },
    );
    const result = data?.[0];
    if (sharingError || !result || result.outcome === "rejected") {
      return mapCheckinError(
        new Error(sharingError?.message || result?.rejection_code || "unknown"),
        "an unknown error",
      );
    }
    return null;
  }

  async function retrySharingPreferences(attendee: AttendeeRow) {
    if (!sharingRetry || sharingRetry.attendeeId !== attendee.id) {
      return;
    }
    setSavingId(attendee.id);
    setError(null);
    showStatus("Retrying attendee sharing...");
    try {
      const sharingError = await saveSharingPreferences(
        attendee,
        sharingRetry.sharedFields,
      );
      if (sharingError) {
        showError(`Sharing was not updated -- ${sharingError}`);
        return;
      }
      setSharingRetry(null);
      selectedIsDirtyRef.current = false;
      setSelectedIsDirty(false);
      setSelectedConflict(null);
      await loadPage();
      showStatus("Attendee sharing updated.");
    } finally {
      setSavingId(null);
    }
  }

  async function saveCheckin(attendee: AttendeeRow, nextHasArrived: boolean) {
    if (!event?.id) {
      showError("No working event selected.");
      return;
    }

    const current = editState[attendee.id];
    if (!current) {
      return;
    }

    try {
      setSavingId(attendee.id);
      setOperationFailure(null);
      showStatus("Saving check-in changes...");

      const oldHasArrived = !!attendee.has_arrived;
      const oldSharedFields = sharingByAttendee[attendee.id] || [];
      const oldParticipates = oldSharedFields.length > 0;

      const { data: checkinData, error: checkinError } = await supabase.rpc(
        "complete_admin_checkin",
        {
          p_attendee_id: attendee.id,
          p_expected_event_id: event.id,
          p_has_arrived: nextHasArrived,
          p_share_with_attendees: current.sharedFields.length > 0,
        },
      );

      if (checkinError) {
        throw new Error(
          mapCheckinError(new Error(checkinError.message), "Could not save check-in."),
        );
      }
      const checkinResult = checkinData?.[0];
      if (!checkinResult || checkinResult.outcome === "rejected") {
        throw new Error(
          mapCheckinError(
            new Error(checkinResult?.rejection_code || "unknown"),
            "Could not save check-in.",
          ),
        );
      }

      const attendeeName =
        fullName(attendee.pilot_first, attendee.pilot_last) || "Attendee";

      // Arrival and sharing preferences are two separate governed domain
      // concepts (an operational fact vs. a Person's own consent) written by
      // two separate RPC calls on purpose -- see the top-of-function note.
      // complete_admin_checkin has already committed by this point, so a
      // failure here must always read as "check-in saved, sharing
      // preferences were not" and never as "check-in failed," regardless of
      // which specific rejection code fired. The page is reloaded so the
      // card reflects the true persisted state rather than the operator's
      // stale local edit.
      const sharingFailure = await saveSharingPreferences(
        attendee,
        current.sharedFields,
      );

      if (sharingFailure) {
        setSharingRetry({
          attendeeId: attendee.id,
          sharedFields: current.sharedFields,
        });
        selectedIsDirtyRef.current = false;
        setSelectedIsDirty(false);
        setSelectedConflict(null);
        await loadPage();
        setRecentCompletion({
          attendeeId: attendee.id,
          attendeeName,
          message: "Check-In saved. Sharing still needs attention.",
        });
        showError(
          `${attendeeName}: check-in (arrival) was saved, but sharing preferences were not saved -- ${sharingFailure}`,
        );
        return;
      }
      setSharingRetry(null);

      const changes: string[] = [];

      if (!oldHasArrived && nextHasArrived) {
        changes.push("marked arrived");
      } else if (oldHasArrived && !nextHasArrived) {
        changes.push("arrival unmarked");
      }

      const newParticipates = current.sharedFields.length > 0;
      const sharedFieldsChanged =
        oldSharedFields.length !== current.sharedFields.length ||
        oldSharedFields.some((key) => !current.sharedFields.includes(key));

      if (oldParticipates !== newParticipates) {
        changes.push(
          newParticipates
            ? "attendee sharing turned on"
            : "attendee sharing turned off",
        );
      } else if (sharedFieldsChanged) {
        changes.push("attendee sharing choices updated");
      }

      const feedback =
        changes.length === 0
          ? `${attendeeName} saved. No visible changes were made.`
          : `${attendeeName}: ${changes.join(" · ")}.`;

      selectedIsDirtyRef.current = false;
      setSelectedIsDirty(false);
      setOperationFailure(null);
      await loadPage();
      setRecentCompletion({
        attendeeId: attendee.id,
        attendeeName,
        message: nextHasArrived
          ? "Checked in successfully."
          : "Check-In was undone.",
      });
      showStatus(feedback);
      setSearch("");
      setShowArrived(false);
      closeSelectedAttendee();
    } catch (err: any) {
      console.error("saveCheckin error:", err);
      const failure = classifyCheckinFailure(err);
      const retryable = failure.category === "connectivity";
      setOperationFailure({
        ...failure,
        retry: retryable ? { attendeeId: attendee.id, nextHasArrived } : null,
      });
      showError(`${failure.category}: ${failure.message}`);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-6)", minWidth: 0 }}>
      <AdminReturnLink searchParams={searchParams} />

      <ConfirmDialog
        open={!!undoAttendee}
        title="Undo Check-In"
        message={`Mark ${undoAttendee ? fullName(undoAttendee.pilot_first, undoAttendee.pilot_last) || "this attendee" : "this attendee"} as not arrived? Any current parking placement is unaffected.`}
        confirmLabel="Undo Check-In"
        danger
        busy={!!undoAttendee && savingId === undoAttendee.id}
        onCancel={() => setUndoAttendee(null)}
        onConfirm={async () => {
          if (!undoAttendee) {
            return;
          }
          const attendee = undoAttendee;
          await saveCheckin(attendee, false);
          setUndoAttendee(null);
        }}
      />

      <Alert tone="neutral">{status}</Alert>

      {error ? (
        <Alert tone="danger">
          {error}
          {operationFailure?.retry ? (
            <div style={{ marginTop: "var(--space-3)" }}>
              <AppButton
                variant="primary"
                onClick={() => {
                  const retryAttendee = attendees.find(
                    (attendee) =>
                      attendee.id === operationFailure.retry?.attendeeId,
                  );
                  if (retryAttendee && operationFailure.retry) {
                    void saveCheckin(
                      retryAttendee,
                      operationFailure.retry.nextHasArrived,
                    );
                  }
                }}
              >
                Retry Check-In
              </AppButton>
            </div>
          ) : null}
        </Alert>
      ) : null}

      {recentCompletion ? (
        <Alert tone="success">
          <strong>{recentCompletion.attendeeName}</strong>:{" "}
          {recentCompletion.message}
        </Alert>
      ) : null}

      <TableToolbar>
        <TableToolbarPrimaryRow>
          <SearchField
            ref={searchInputRef}
            label="Find attendee"
            value={search}
            onChange={setSearch}
            id="checkin-search"
            disabled={loading}
            placeholder="Name, nickname, email, coach, or site"
          />

          <Checkbox
            checked={showArrived}
            onChange={(event) => setShowArrived(event.target.checked)}
            label="Show already checked-in attendees"
          />
        </TableToolbarPrimaryRow>
      </TableToolbar>

      <p className="app-subtle-text" style={{ margin: 0 }}>
        {search.trim() || showArrived
          ? `Showing ${filteredAttendees.length} matching attendee${filteredAttendees.length === 1 ? "" : "s"}.`
          : `${filteredAttendees.length} attendee${filteredAttendees.length === 1 ? "" : "s"} waiting to check in.`}
      </p>

      {!selectedAttendee ? (
        filteredAttendees.length === 0 ? (
          <EmptyState message="No attendees found." />
        ) : isCompact ? (
          <ResponsiveList aria-label="Check-in attendees">
            {filteredAttendees.map((attendee) => {
              const pilotName =
                fullName(attendee.pilot_first, attendee.pilot_last) ||
                "Unnamed attendee";
              const copilotName = fullName(
                attendee.copilot_first,
                attendee.copilot_last,
              );
              const arrival = arrivalPresentation(attendee);

              return (
                <li key={attendee.id}>
                  <button
                    type="button"
                    onClick={() => selectAttendee(attendee.id)}
                    className={
                      "responsive-list-item" +
                      (attendee.has_arrived ? " responsive-list-item-selected" : "")
                    }
                    style={{ width: "100%", textAlign: "left" }}
                  >
                    <div className="responsive-list-item-header">
                      <div className="responsive-list-item-title">
                        {pilotName}
                        {copilotName ? ` + ${copilotName}` : ""}
                      </div>
                      <StatusBadge tone={arrival.tone}>{arrival.label}</StatusBadge>
                    </div>
                    <div className="responsive-list-item-meta">
                      <span>{attendee.email || "No email"}</span>
                      <span>
                        {attendee.assigned_site
                          ? `Site ${attendee.assigned_site}`
                          : "No site confirmed"}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ResponsiveList>
        ) : (
          <DataTable caption="Check-In attendee results">
            <thead>
              <tr>
                <th scope="col">Attendee</th>
                <th scope="col">Arrival</th>
              </tr>
            </thead>
            <tbody>
              {filteredAttendees.map((attendee) => {
                const pilotName =
                  fullName(attendee.pilot_first, attendee.pilot_last) ||
                  "Unnamed attendee";
                const copilotName = fullName(
                  attendee.copilot_first,
                  attendee.copilot_last,
                );
                const arrival = arrivalPresentation(attendee);

                return (
                  <tr
                    key={attendee.id}
                    className={attendee.has_arrived ? "data-table-row-selected" : undefined}
                  >
                    <td>
                      <button
                        type="button"
                        onClick={() => selectAttendee(attendee.id)}
                        aria-label={`Select "${pilotName}" for check-in`}
                        style={{
                          all: "unset",
                          cursor: "pointer",
                          display: "block",
                          width: "100%",
                        }}
                      >
                        <div className="data-table-cell-primary">
                          {pilotName}
                          {copilotName ? ` + ${copilotName}` : ""}
                        </div>
                        <div className="data-table-cell-meta">
                          {attendee.email || "No email"}
                          {" · "}
                          {attendee.assigned_site
                            ? `Site ${attendee.assigned_site}`
                            : "No site confirmed"}
                        </div>
                      </button>
                    </td>
                    <td>
                      <StatusBadge tone={arrival.tone}>{arrival.label}</StatusBadge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )
      ) : null}

      {(selectedAttendee ? [selectedAttendee] : []).map((attendee) => {
        const members = householdByAttendee.get(attendee.id) || [];
        const pilotMember = getRoleMember(members, "pilot");
        const copilotMember = getRoleMember(members, "copilot");
        const additionalMembers = members.filter(
          (member) => member.person_role === "additional",
        );

        const current = editState[attendee.id] || {
          sharedFields: sharingByAttendee[attendee.id] || [],
        };
        const arrival = arrivalPresentation(attendee);
        const placement = placementPresentation(attendee);

        return (
          <PageSection key={attendee.id} variant="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "var(--space-3)",
                flexWrap: "wrap",
                marginBottom: "var(--space-4)",
              }}
            >
              <strong>Selected attendee</strong>
              <AppButton variant="secondary" onClick={closeSelectedAttendee}>
                Back to results
              </AppButton>
            </div>

            <div style={{ display: "grid", gap: "var(--space-4)", minWidth: 0 }}>
              {selectedIsDirty ? (
                <p className="app-subtle-text" style={{ margin: 0 }}>
                  Unsaved changes
                </p>
              ) : null}

              {selectedConflict ? (
                <Alert tone="warning">
                  <strong>Record changed elsewhere.</strong> {selectedConflict}
                  <div style={{ marginTop: "var(--space-3)" }}>
                    <AppButton
                      variant="primary"
                      onClick={() => void reloadSelectedAttendee()}
                    >
                      Reload Current Record
                    </AppButton>
                  </div>
                </Alert>
              ) : null}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isCompact
                    ? "minmax(0, 1fr)"
                    : "minmax(0, 1.3fr) minmax(0, 1.3fr) minmax(0, 1fr)",
                  gap: "var(--space-4)",
                  minWidth: 0,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>
                    Pilot:{" "}
                    {pilotMember
                      ? householdLine(pilotMember)
                      : fullName(attendee.pilot_first, attendee.pilot_last) ||
                        "—"}
                  </div>
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>
                    Co-Pilot:{" "}
                    {copilotMember
                      ? householdLine(copilotMember)
                      : fullName(
                          attendee.copilot_first,
                          attendee.copilot_last,
                        ) || "—"}
                  </div>
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, marginBottom: "var(--space-2)" }}>
                    Arrival
                  </div>
                  <StatusBadge tone={arrival.tone}>
                    {attendee.has_arrived ? "Checked in" : "Not yet arrived"}
                  </StatusBadge>
                </div>
              </div>

              <details className="app-subtle-text">
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                  Additional details
                </summary>
                <div style={{ display: "grid", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
                  <div>Email: {attendee.email || "Not provided"}</div>
                  <div>
                    Coach:{" "}
                    {[attendee.coach_make, attendee.coach_model]
                      .filter(Boolean)
                      .join(" ") || "Not provided"}
                    {attendee.coach_length
                      ? ` · ${attendee.coach_length} ft`
                      : ""}
                  </div>
                  <div>First Time: {attendee.first_time ? "Yes" : "No"}</div>
                  <div>Volunteer: {attendee.volunteer ? "Yes" : "No"}</div>
                  {additionalMembers.length > 0 ? (
                    <div>
                      <strong>Additional household members</strong>
                      {additionalMembers.map((member) => (
                        <div key={member.id}>{householdLine(member)}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </details>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isCompact
                    ? "minmax(0, 1fr)"
                    : "minmax(220px, 1.2fr) auto",
                  gap: "var(--space-4)",
                  alignItems: isCompact ? "stretch" : "center",
                  minWidth: 0,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, marginBottom: "var(--space-2)" }}>
                    Placement
                  </div>
                  <div
                    className="responsive-list-item-badges"
                    style={{ marginBottom: "var(--space-3)" }}
                  >
                    <StatusBadge tone={placement.tone}>{placement.label}</StatusBadge>
                    {attendee.handicap_parking ? (
                      <StatusBadge tone="info">Handicap parking needed</StatusBadge>
                    ) : null}
                  </div>
                  {attendee.has_arrived && !attendee.assigned_site ? (
                    <AppLinkButton
                      variant="secondary"
                      href={buildAdminAttendeeTargetHref(
                        "/admin/parking",
                        attendee.id,
                      )}
                    >
                      Place in Parking
                    </AppLinkButton>
                  ) : null}
                </div>
                {attendee.has_arrived ? (
                  <AppButton
                    variant="danger"
                    onClick={() => setUndoAttendee(attendee)}
                    disabled={savingId === attendee.id}
                    style={{
                      minHeight: 48,
                      width: isCompact ? "100%" : "auto",
                    }}
                  >
                    Undo Check-In
                  </AppButton>
                ) : (
                  <AppButton
                    variant="primary"
                    onClick={() => void saveCheckin(attendee, true)}
                    disabled={savingId === attendee.id || !!selectedConflict}
                    style={{
                      minHeight: 52,
                      minWidth: 150,
                      width: isCompact ? "100%" : "auto",
                      fontSize: 16,
                    }}
                  >
                    {savingId === attendee.id ? "Checking In..." : "Check In"}
                  </AppButton>
                )}
              </div>

              <details className="app-card-section">
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                  Attendee Sharing
                </summary>
                <div style={{ display: "grid", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
                  <p className="app-subtle-text" style={{ margin: 0 }}>
                    Choose what other participating attendees can see. Name is
                    required for participation.
                  </p>

                  <div
                    style={{
                      display: "flex",
                      gap: "var(--space-4)",
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    {SHARING_OPTIONAL_FIELDS.map((field) => (
                      <Checkbox
                        key={field.key}
                        checked={current.sharedFields.includes(field.key)}
                        onChange={() =>
                          toggleSharedField(attendee.id, field.key)
                        }
                        label={field.label}
                      />
                    ))}

                    <AppButton
                      onClick={() => toggleAllSharedFields(attendee.id)}
                    >
                      {
                        getSharingBulkAction(
                          SHARING_OPTIONAL_FIELDS.map((field) => field.key),
                          current.sharedFields,
                        ).label
                      }
                    </AppButton>
                  </div>

                  <p className="app-subtle-text" style={{ margin: 0 }}>
                    Sharing lets this attendee see information that other
                    participating attendees choose to share. Turning all sharing
                    off removes their access to the attendee-sharing
                    directory/locator.
                  </p>
                  {sharingRetry?.attendeeId === attendee.id ? (
                    <AppButton
                      variant="primary"
                      onClick={() => void retrySharingPreferences(attendee)}
                      disabled={savingId === attendee.id}
                    >
                      Retry Sharing Update
                    </AppButton>
                  ) : null}
                </div>
              </details>
            </div>
          </PageSection>
        );
      })}
    </div>
  );
}
