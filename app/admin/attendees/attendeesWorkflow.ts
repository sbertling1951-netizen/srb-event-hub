// Pure Attendees workflow logic -- Stage B of the Attendees Browse ->
// Select -> Understand -> Edit -> Confirm -> Continue refactor (docs/
// architecture/EPICENTRAX_ATTENDEES_MODULE_REFACTOR_AUDIT.md, Section F).
// Mirrors the existing app/admin/checkin/checkinWorkflow.ts split: page.tsx
// owns rendering and Supabase I/O; this module owns the decision logic so
// it is directly unit-testable without a DOM or a network call.

export type ReviewSeverity = "error" | "warning";

export type AttendeeRow = {
  id: string;
  event_id: string;
  entry_id: string | null;
  email: string | null;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  copilot_email?: string | null;
  copilot_cell_phone?: string | null;
  primary_phone?: string | null;
  cell_phone?: string | null;
  nickname: string | null;
  copilot_nickname: string | null;
  membership_number: string | null;
  city: string | null;
  state: string | null;
  assigned_site: string | null;
  participant_capacity?: number | null;
  has_arrived: boolean | null;
  is_first_timer: boolean | null;
  wants_to_volunteer: boolean | null;
  share_with_attendees?: boolean | null;
  participant_type?: string | null;
  coach_manufacturer?: string | null;
  coach_model?: string | null;
  special_events_raw?: string | null;
  include_in_headcount?: boolean | null;
  needs_name_tag?: boolean | null;
  needs_coach_plate?: boolean | null;
  needs_parking?: boolean | null;
  notes?: string | null;
  source_type?: string | null;
  is_active: boolean;
  data_status?: string | null;
  created_at?: string | null;
  registration_status?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancellation_reason?: string | null;
};

export type ReviewFieldIssue = {
  field: string;
  issue: string;
  severity: ReviewSeverity;
};

export type ReviewItem = {
  id: string;
  attendee: AttendeeRow;
  issues: ReviewFieldIssue[];
  severity: ReviewSeverity;
};

export type ValidationRule = {
  id: string;
  field_name: string;
  rule_type: string;
  rule_value: string | null;
  message: string;
  severity: ReviewSeverity;
  is_active: boolean;
  priority: number;
  applies_to_event_id: string | null;
};

export type PageSize = "10" | "25" | "50" | "100" | "all";
export type DataStatusFilter =
  | "all"
  | "pending"
  | "corrected"
  | "reviewed"
  | "locked";
export type ParticipantTypeFilter =
  | "all"
  | "attendee"
  | "vendor"
  | "staff"
  | "speaker"
  | "volunteer"
  | "event_host";
export type ViewMode = "active" | "review" | "cancelled" | "all";
export type AttendeeSortMode = "last_name" | "site";

export const REVIEW_FIELDS: Array<keyof AttendeeRow> = [
  "membership_number",
  "email",
  "assigned_site",
  "pilot_first",
  "pilot_last",
  "city",
  "state",
];

export const DATA_STATUS_OPTIONS: DataStatusFilter[] = [
  "all",
  "pending",
  "corrected",
  "reviewed",
  "locked",
];

export const PARTICIPANT_TYPE_OPTIONS: ParticipantTypeFilter[] = [
  "all",
  "attendee",
  "vendor",
  "staff",
  "speaker",
  "volunteer",
  "event_host",
];

const STATUS_LABELS: Record<Exclude<DataStatusFilter, "all">, string> = {
  pending: "Pending",
  corrected: "Corrected",
  reviewed: "Reviewed",
  locked: "Locked",
};

export function dataStatusOptionLabel(value: Exclude<DataStatusFilter, "all">) {
  return STATUS_LABELS[value];
}

export function dataStatusLabel(value?: string | null) {
  if (!value) {
    return "pending";
  }
  if (["pending", "reviewed", "corrected", "locked"].includes(value)) {
    return value;
  }
  return value;
}

export function participantTypeLabel(value?: string | null) {
  if (!value) {
    return "Attendee";
  }

  const map: Record<string, string> = {
    attendee: "Attendee",
    vendor: "Vendor",
    staff: "Staff",
    speaker: "Speaker",
    volunteer: "Volunteer",
    event_host: "Event Host",
  };

  return map[value] || value.replace(/_/g, " ");
}

export function reviewFieldLabel(field: string) {
  const map: Record<string, string> = {
    membership_number: "Membership Number",
    email: "Email",
    assigned_site: "Assigned Site",
    pilot_first: "Pilot First",
    pilot_last: "Pilot Last",
    city: "City",
    state: "State",
  };

  return map[field] || field.replace(/_/g, " ");
}

export function fullName(first?: string | null, last?: string | null) {
  return [first, last].filter(Boolean).join(" ").trim();
}

export function displayPilotName(row: AttendeeRow) {
  return fullName(row.pilot_first, row.pilot_last) || "Unnamed";
}

export function displayCopilotName(row: AttendeeRow) {
  return fullName(row.copilot_first, row.copilot_last);
}

export function cityState(row: AttendeeRow) {
  return [row.city, row.state].filter(Boolean).join(", ");
}

export function normalizeMemberNumber(value?: string | null) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function attendeeMatchesSearch(row: AttendeeRow, term: string) {
  if (!term) {
    return true;
  }

  const haystack = [
    row.pilot_first,
    row.pilot_last,
    row.copilot_first,
    row.copilot_last,
    row.email,
    row.membership_number,
    row.assigned_site,
    row.city,
    row.state,
    row.entry_id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(term);
}

// Surfaces cancellation metadata the record already stores but the UI
// previously fetched and never displayed. Returns null for a non-cancelled
// record so this never appears outside the one context where it is
// relevant (Know More / Show Less).
export function formatCancellationDetail(
  attendee: Pick<
    AttendeeRow,
    "registration_status" | "cancelled_at" | "cancellation_reason"
  >,
): string | null {
  if (attendee.registration_status !== "cancelled") {
    return null;
  }

  const when = attendee.cancelled_at
    ? new Date(attendee.cancelled_at).toLocaleString()
    : null;

  const parts = [when ? `Cancelled ${when}` : "Cancelled"];

  if (attendee.cancellation_reason) {
    parts.push(attendee.cancellation_reason);
  }

  return parts.join(" — ");
}

function ruleAppliesToEvent(rule: ValidationRule, eventId?: string | null) {
  if (!rule.is_active) {
    return false;
  }
  if (!rule.applies_to_event_id) {
    return true;
  }
  return rule.applies_to_event_id === eventId;
}

export function validateField(
  fieldName: string,
  value: string | null | undefined,
  rules: ValidationRule[],
  eventId?: string | null,
): { issue: string; severity: ReviewSeverity } | null {
  const normalizedValue = String(value || "").trim();
  const activeRules = rules
    .filter((rule) => rule.field_name === fieldName)
    .filter((rule) => ruleAppliesToEvent(rule, eventId))
    .sort((a, b) => a.priority - b.priority);

  for (const rule of activeRules) {
    const ruleValue = String(rule.rule_value || "").trim();

    if (rule.rule_type === "required" && !normalizedValue) {
      return { issue: rule.message, severity: rule.severity };
    }

    if (rule.rule_type === "starts_with") {
      if (
        fieldName === "membership_number" &&
        ruleValue.toUpperCase() === "F"
      ) {
        const upperValue = normalizedValue.toUpperCase();
        if (!upperValue.startsWith("F") && !upperValue.startsWith("C")) {
          return {
            issue: rule.message.replace("F", "F or C"),
            severity: rule.severity,
          };
        }
      } else if (!normalizedValue.startsWith(ruleValue)) {
        return { issue: rule.message, severity: rule.severity };
      }
    }

    if (rule.rule_type === "starts_with_any") {
      const allowed = ruleValue
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

      const allowedForField =
        fieldName === "membership_number" && allowed.includes("F")
          ? Array.from(new Set([...allowed, "C"]))
          : allowed;

      const upperValue = normalizedValue.toUpperCase();
      if (
        !allowedForField.some((prefix) =>
          upperValue.startsWith(prefix.toUpperCase()),
        )
      ) {
        return {
          issue:
            fieldName === "membership_number"
              ? rule.message.replace("F", "F or C")
              : rule.message,
          severity: rule.severity,
        };
      }
    }

    if (rule.rule_type === "contains" && !normalizedValue.includes(ruleValue)) {
      return { issue: rule.message, severity: rule.severity };
    }

    if (rule.rule_type === "min_length") {
      const minLength = Number(ruleValue);
      if (Number.isFinite(minLength) && normalizedValue.length < minLength) {
        return { issue: rule.message, severity: rule.severity };
      }
    }
  }

  return null;
}

export function sortReviewItems(items: ReviewItem[]) {
  return [...items].sort((a, b) => {
    const aLast = String(a.attendee.pilot_last || "")
      .trim()
      .toLowerCase();
    const bLast = String(b.attendee.pilot_last || "")
      .trim()
      .toLowerCase();
    const aFirst = String(a.attendee.pilot_first || "")
      .trim()
      .toLowerCase();
    const bFirst = String(b.attendee.pilot_first || "")
      .trim()
      .toLowerCase();

    return (
      aLast.localeCompare(bLast, undefined, { sensitivity: "base" }) ||
      aFirst.localeCompare(bFirst, undefined, { sensitivity: "base" }) ||
      String(a.issues[0]?.issue || "").localeCompare(
        String(b.issues[0]?.issue || ""),
        undefined,
        { sensitivity: "base" },
      )
    );
  });
}

// Single owner of "which attendees are currently flagged" -- both the
// Review Queue and fullyValidCount previously recomputed this
// independently (Refactor Audit Q13/C). Both now derive from this one
// function.
export function computeReviewItems(
  attendees: AttendeeRow[],
  rules: ValidationRule[],
  eventId: string | null | undefined,
): ReviewItem[] {
  return attendees.flatMap((attendee) => {
    const issues = REVIEW_FIELDS.flatMap((field) => {
      const result = validateField(
        field,
        attendee[field] as string | null | undefined,
        rules,
        eventId,
      );
      if (!result) {
        return [];
      }

      return [
        { field, issue: result.issue, severity: result.severity } satisfies ReviewFieldIssue,
      ];
    });

    if (!issues.length) {
      return [];
    }

    const severity: ReviewSeverity = issues.some(
      (issue) => issue.severity === "error",
    )
      ? "error"
      : "warning";

    return [{ id: attendee.id, attendee, issues, severity } satisfies ReviewItem];
  });
}

// Single owner of the View decision (Refactor Audit Q4/F): "active",
// "review", "cancelled", "all" are the only four states, selected through
// exactly one control (the View select). No other control may duplicate
// this decision.
export function matchesViewMode(
  row: Pick<AttendeeRow, "registration_status" | "id">,
  viewMode: ViewMode,
  isFlagged: boolean,
): boolean {
  const registrationStatus = row.registration_status ?? "active";

  if (viewMode === "all") {
    return true;
  }
  if (viewMode === "active") {
    return registrationStatus !== "cancelled";
  }
  if (viewMode === "cancelled") {
    return registrationStatus === "cancelled";
  }
  // "review"
  return registrationStatus !== "cancelled" && isFlagged;
}

export function filterAttendees(
  attendees: AttendeeRow[],
  reviewItems: ReviewItem[],
  options: {
    search: string;
    dataStatusFilter: DataStatusFilter;
    participantTypeFilter: ParticipantTypeFilter;
    viewMode: ViewMode;
  },
): AttendeeRow[] {
  const term = options.search.trim().toLowerCase();
  const flaggedIds = new Set(reviewItems.map((item) => item.attendee.id));

  return attendees.filter((row) => {
    const matchesSearch = attendeeMatchesSearch(row, term);

    const statusValue = dataStatusLabel(row.data_status);
    const matchesStatus =
      options.dataStatusFilter === "all"
        ? true
        : statusValue === options.dataStatusFilter;

    const participantType = (row.participant_type ||
      "attendee") as ParticipantTypeFilter;
    const matchesParticipantType =
      options.participantTypeFilter === "all"
        ? true
        : participantType === options.participantTypeFilter;

    const matchesView = matchesViewMode(
      row,
      options.viewMode,
      flaggedIds.has(row.id),
    );

    return matchesSearch && matchesStatus && matchesParticipantType && matchesView;
  });
}

export function sortAttendees(
  attendees: AttendeeRow[],
  mode: AttendeeSortMode,
): AttendeeRow[] {
  return [...attendees].sort((a, b) => {
    if (mode === "site") {
      const siteA = a.assigned_site?.trim();
      const siteB = b.assigned_site?.trim();

      if (!siteA && !siteB) {
        return 0;
      }
      if (!siteA) {
        return 1;
      }
      if (!siteB) {
        return -1;
      }

      return (
        siteA.localeCompare(siteB, undefined, { numeric: true }) ||
        String(a.pilot_last || "").localeCompare(
          String(b.pilot_last || ""),
          undefined,
          { sensitivity: "base" },
        ) ||
        String(a.pilot_first || "").localeCompare(
          String(b.pilot_first || ""),
          undefined,
          { sensitivity: "base" },
        )
      );
    }

    return (
      String(a.pilot_last || "").localeCompare(
        String(b.pilot_last || ""),
        undefined,
        { sensitivity: "base" },
      ) ||
      String(a.pilot_first || "").localeCompare(
        String(b.pilot_first || ""),
        undefined,
        { sensitivity: "base" },
      ) ||
      String(a.assigned_site || "").localeCompare(
        String(b.assigned_site || ""),
        undefined,
        { numeric: true },
      )
    );
  });
}

// ---------------------------------------------------------------------------
// Stage C/D: editor state, household-removal confirmation, dirty tracking,
// field sections, and same-record concurrency. Kept alongside the rest of
// this module's pure logic (not in page.tsx) so every decision the Selected
// Record Workspace makes is independently unit-testable.
// ---------------------------------------------------------------------------

export type AttendeeEditorState = {
  id: string | null;
  pilot_first: string;
  pilot_last: string;
  copilot_first: string;
  copilot_last: string;
  nickname: string;
  copilot_nickname: string;
  email: string;
  copilot_email: string;
  copilot_cell_phone: string;
  additional_first_name: string;
  additional_last_name: string;
  additional_nickname: string;
  additional_email: string;
  additional_cell_phone: string;
  membership_number: string;
  city: string;
  state: string;
  assigned_site: string;
  participant_type: string;
  registration_capacity: number;
  // True when the underlying stored participant_capacity was null when this
  // editor session loaded (or this is a brand-new record) and the
  // administrator has not yet deliberately changed the capacity control.
  // While true, save must leave capacity unknown rather than persisting the
  // stepper's display default.
  registration_capacity_was_unset: boolean;
  // The stored participant_capacity value as loaded (null if unset, or null
  // for a brand-new record). Used only to detect whether the admin is
  // raising capacity above what is currently stored -- never written back
  // directly.
  registration_capacity_original: number | null;
  // Whether a Co-Pilot / Additional Participant household row already
  // existed when this editor session loaded. Used only to distinguish the
  // administrator newly adding that participant this save (which
  // automatically authorizes the resulting capacity, per governed product
  // rule) from an unrelated edit to an already-existing row (which must
  // never silently "fix" a pre-existing roster/capacity mismatch). Not
  // applicable to create mode (always false there).
  had_copilot_at_load: boolean;
  had_additional_at_load: boolean;
  // The Co-Pilot's / Additional Participant's display name as loaded, used
  // only to name them in the removal-confirmation prompt if their fields
  // are cleared before Save -- never written back, never used to infer
  // identity. Empty when no such household member existed at load.
  copilot_name_at_load: string;
  additional_name_at_load: string;
  // Optional operational note attached to a capacity adjustment, if any
  // occurs this save. EpicentraX does not ask how a slot was authorized or
  // record payment information -- this is purely an optional free-text
  // note. Cleared whenever a record is loaded.
  capacity_increase_note: string;
  primary_phone: string;
  cell_phone: string;
  wants_to_volunteer: boolean;
  coach_manufacturer: string;
  coach_model: string;
  special_events_raw: string;
  include_in_headcount: boolean;
  needs_name_tag: boolean;
  needs_coach_plate: boolean;
  needs_parking: boolean;
  is_first_timer: boolean;
  has_arrived: boolean;
  share_with_attendees: boolean;
  is_active: boolean;
  data_status: string;
  entry_id: string;
  source_type?: string | null;
  notes: string;
};

export function emptyAttendeeEditorState(): AttendeeEditorState {
  return {
    id: null,
    pilot_first: "",
    pilot_last: "",
    copilot_first: "",
    copilot_last: "",
    nickname: "",
    copilot_nickname: "",
    email: "",
    copilot_email: "",
    copilot_cell_phone: "",
    additional_first_name: "",
    additional_last_name: "",
    additional_nickname: "",
    additional_email: "",
    additional_cell_phone: "",
    membership_number: "",
    city: "",
    state: "",
    assigned_site: "",
    participant_type: "attendee",
    registration_capacity: 1,
    registration_capacity_was_unset: false,
    registration_capacity_original: null,
    had_copilot_at_load: false,
    had_additional_at_load: false,
    copilot_name_at_load: "",
    additional_name_at_load: "",
    capacity_increase_note: "",
    primary_phone: "",
    cell_phone: "",
    coach_manufacturer: "",
    coach_model: "",
    special_events_raw: "",
    wants_to_volunteer: false,
    is_first_timer: false,
    has_arrived: false,
    share_with_attendees: false,
    is_active: true,
    include_in_headcount: true,
    needs_name_tag: false,
    needs_coach_plate: false,
    needs_parking: false,
    data_status: "pending",
    entry_id: "",
    notes: "",
  };
}

export function attendeeToEditorState(attendee: AttendeeRow): AttendeeEditorState {
  return {
    id: attendee.id,
    pilot_first: attendee.pilot_first || "",
    pilot_last: attendee.pilot_last || "",
    copilot_first: attendee.copilot_first || "",
    copilot_last: attendee.copilot_last || "",
    nickname: attendee.nickname || "",
    copilot_nickname: attendee.copilot_nickname || "",
    email: attendee.email || "",
    copilot_email: attendee.copilot_email || "",
    copilot_cell_phone: attendee.copilot_cell_phone || "",
    additional_first_name: "",
    additional_last_name: "",
    additional_nickname: "",
    additional_email: "",
    additional_cell_phone: "",
    membership_number: attendee.membership_number || "",
    city: attendee.city || "",
    state: attendee.state || "",
    assigned_site: attendee.assigned_site || "",
    participant_type: attendee.participant_type || "attendee",
    registration_capacity: attendee.participant_capacity ?? 1,
    registration_capacity_was_unset:
      attendee.participant_capacity === null ||
      attendee.participant_capacity === undefined,
    registration_capacity_original: attendee.participant_capacity ?? null,
    // Overwritten immediately after this call in selectAttendee, once the
    // actual attendee_household_members rows are known.
    had_copilot_at_load: false,
    had_additional_at_load: false,
    // Overwritten immediately after this call in selectAttendee, alongside
    // had_copilot_at_load/had_additional_at_load above.
    copilot_name_at_load: "",
    additional_name_at_load: "",
    capacity_increase_note: "",
    primary_phone: attendee.primary_phone || "",
    cell_phone: attendee.cell_phone || "",
    coach_manufacturer: attendee.coach_manufacturer || "",
    coach_model: attendee.coach_model || "",
    special_events_raw: attendee.special_events_raw || "",
    wants_to_volunteer: !!attendee.wants_to_volunteer,
    is_first_timer: !!attendee.is_first_timer,
    has_arrived: !!attendee.has_arrived,
    share_with_attendees: !!attendee.share_with_attendees,
    is_active: attendee.is_active,
    include_in_headcount: attendee.include_in_headcount ?? true,
    needs_name_tag: !!attendee.needs_name_tag,
    needs_coach_plate: !!attendee.needs_coach_plate,
    needs_parking: !!attendee.needs_parking,
    data_status: attendee.data_status || "pending",
    entry_id: attendee.entry_id || "",
    notes: attendee.notes || "",
  };
}

export type HouseholdRemovalWarning = {
  role: "copilot" | "additional";
  name: string;
};

// Pure decision gate: given the editor's loaded-vs-current household state,
// determines which household-member rows this save would silently
// hard-delete (per syncHouseholdMembers's own clear-the-row-when-empty
// behavior), so the save flow can require explicit confirmation before any
// write occurs rather than deleting a person record because a field was
// cleared. Exported so this decision logic is directly unit-testable without
// needing to drive the full save flow.
export function computeHouseholdRemovalWarnings(
  editorMode: "create" | "edit",
  state: AttendeeEditorState,
): HouseholdRemovalWarning[] {
  if (editorMode !== "edit") {
    return [];
  }

  const hasCopilot =
    state.copilot_first.trim() !== "" ||
    state.copilot_last.trim() !== "" ||
    state.copilot_email.trim() !== "";
  const hasAdditional =
    (state.additional_first_name ?? "").trim() !== "" ||
    (state.additional_last_name ?? "").trim() !== "" ||
    (state.additional_email ?? "").trim() !== "" ||
    (state.additional_nickname ?? "").trim() !== "" ||
    (state.additional_cell_phone ?? "").trim() !== "";

  const warnings: HouseholdRemovalWarning[] = [];

  if (state.had_copilot_at_load && !hasCopilot) {
    warnings.push({
      role: "copilot",
      name: state.copilot_name_at_load || "the Co-Pilot",
    });
  }

  if (state.had_additional_at_load && !hasAdditional) {
    warnings.push({
      role: "additional",
      name: state.additional_name_at_load || "the Additional Participant",
    });
  }

  return warnings;
}

const HOUSEHOLD_ROLE_LABEL: Record<HouseholdRemovalWarning["role"], string> = {
  copilot: "Co-Pilot",
  additional: "Additional Participant",
};

// Builds the exact, specific confirmation prompt for a pending
// household-member removal -- deliberately names who is being removed and
// what will happen, per this task's explicit prohibition on vague "Are you
// sure?" wording.
export function buildHouseholdRemovalConfirmMessage(
  warnings: HouseholdRemovalWarning[],
): string {
  const names = warnings
    .map((w) => `${w.name} (${HOUSEHOLD_ROLE_LABEL[w.role]})`)
    .join(" and ");

  const pronoun = warnings.length === 1 ? "them" : "both";

  return (
    `This save will permanently remove ${names} as a household member on ` +
    `this attendee record, because their information was cleared from the ` +
    `form. This cannot be undone from here.\n\n` +
    `Continue and remove ${pronoun}?`
  );
}

// Bookkeeping-only fields: loaded once to inform save-time decisions (which
// household role a capacity increase authorizes, what to name in a removal
// prompt), never themselves a "change" the operator made. Excluded from
// dirty-state detection and the diff/section badges built on it.
const EDITOR_BOOKKEEPING_KEYS: ReadonlySet<keyof AttendeeEditorState> = new Set([
  "id",
  "registration_capacity_was_unset",
  "registration_capacity_original",
  "had_copilot_at_load",
  "had_additional_at_load",
  "copilot_name_at_load",
  "additional_name_at_load",
  "assigned_site",
  "has_arrived",
  "source_type",
]);

// Which editor fields changed between the loaded baseline and the current
// form state -- the single source both "is this dirty at all" (Stage D
// requirement 1) and "which section changed" (badges, requirement 2) derive
// from, so the two can never silently disagree.
export function editorStateDiffKeys(
  baseline: AttendeeEditorState,
  current: AttendeeEditorState,
): Array<keyof AttendeeEditorState> {
  const keys = Object.keys(baseline) as Array<keyof AttendeeEditorState>;
  return keys.filter(
    (key) => !EDITOR_BOOKKEEPING_KEYS.has(key) && baseline[key] !== current[key],
  );
}

export function editorStateIsDirty(
  baseline: AttendeeEditorState,
  current: AttendeeEditorState,
): boolean {
  return editorStateDiffKeys(baseline, current).length > 0;
}

export type AttendeeEditSection = {
  id: string;
  label: string;
  fields: Array<keyof AttendeeEditorState>;
};

// Coherent field groupings for the edit form (Stage D requirement 2): the
// smallest grouping that makes mutation scope understandable, without
// splitting Save into a separate button per group. Every editable field
// belongs to exactly one section.
export const ATTENDEE_EDIT_SECTIONS: AttendeeEditSection[] = [
  {
    id: "identity",
    label: "Pilot Identity",
    fields: ["pilot_first", "pilot_last", "nickname"],
  },
  {
    id: "household",
    label: "Household",
    fields: [
      "copilot_first",
      "copilot_last",
      "copilot_nickname",
      "copilot_email",
      "copilot_cell_phone",
      "additional_first_name",
      "additional_last_name",
      "additional_nickname",
      "additional_email",
      "additional_cell_phone",
    ],
  },
  {
    id: "contact",
    label: "Contact",
    fields: ["email", "primary_phone", "cell_phone"],
  },
  {
    id: "location",
    label: "Location",
    fields: ["city", "state"],
  },
  {
    id: "coach",
    label: "Coach & Logistics",
    fields: [
      "coach_manufacturer",
      "coach_model",
      "special_events_raw",
      "wants_to_volunteer",
      "is_first_timer",
      "share_with_attendees",
      "include_in_headcount",
      "needs_name_tag",
      "needs_coach_plate",
      "needs_parking",
    ],
  },
  {
    id: "registration",
    label: "Registration",
    fields: [
      "membership_number",
      "entry_id",
      "participant_type",
      "data_status",
      "registration_capacity",
      "capacity_increase_note",
      "is_active",
    ],
  },
  {
    id: "notes",
    label: "Notes",
    fields: ["notes"],
  },
];

// Which section ids contain at least one changed field -- drives the
// per-section "Changed" badge so the operator can see, at a glance, exactly
// what Save will affect (Stage D requirement 1).
export function dirtySectionIds(
  baseline: AttendeeEditorState,
  current: AttendeeEditorState,
): string[] {
  const diffKeys = new Set(editorStateDiffKeys(baseline, current));
  if (diffKeys.size === 0) {
    return [];
  }
  return ATTENDEE_EDIT_SECTIONS.filter((section) =>
    section.fields.some((field) => diffKeys.has(field)),
  ).map((section) => section.id);
}

// ---------------------------------------------------------------------------
// Same-record concurrency (Stage D requirement 5). Reuses the architectural
// lesson already proven by app/admin/checkin/checkinWorkflow.ts
// (server-fingerprint + dirty-gated conflict detection), but is its own,
// Attendees-scoped fingerprint -- never a copy of Check-In's fields.
//
// Deliberately excludes has_arrived and assigned_site: those are Check-In's
// and Parking's own governed fields (Stage A), not Attendees'. Including
// them here would make every Check-In/Parking action on this attendee look
// like a conflicting Attendees edit, which is exactly the false-positive
// this module must not create.
// ---------------------------------------------------------------------------

export type AttendeeConcurrencyRow = Pick<
  AttendeeRow,
  | "id"
  | "entry_id"
  | "email"
  | "pilot_first"
  | "pilot_last"
  | "copilot_first"
  | "copilot_last"
  | "copilot_email"
  | "copilot_cell_phone"
  | "primary_phone"
  | "cell_phone"
  | "nickname"
  | "copilot_nickname"
  | "membership_number"
  | "city"
  | "state"
  | "participant_capacity"
  | "is_first_timer"
  | "wants_to_volunteer"
  | "share_with_attendees"
  | "participant_type"
  | "coach_manufacturer"
  | "coach_model"
  | "special_events_raw"
  | "include_in_headcount"
  | "needs_name_tag"
  | "needs_coach_plate"
  | "needs_parking"
  | "notes"
  | "source_type"
  | "is_active"
  | "data_status"
  | "registration_status"
  | "cancelled_at"
  | "cancelled_by"
  | "cancellation_reason"
>;

const CONCURRENCY_FIELDS: Array<keyof AttendeeConcurrencyRow> = [
  "entry_id",
  "email",
  "pilot_first",
  "pilot_last",
  "copilot_first",
  "copilot_last",
  "copilot_email",
  "copilot_cell_phone",
  "primary_phone",
  "cell_phone",
  "nickname",
  "copilot_nickname",
  "membership_number",
  "city",
  "state",
  "participant_capacity",
  "is_first_timer",
  "wants_to_volunteer",
  "share_with_attendees",
  "participant_type",
  "coach_manufacturer",
  "coach_model",
  "special_events_raw",
  "include_in_headcount",
  "needs_name_tag",
  "needs_coach_plate",
  "needs_parking",
  "notes",
  "source_type",
  "is_active",
  "data_status",
  "registration_status",
  "cancelled_at",
  "cancelled_by",
  "cancellation_reason",
];

export function attendeeConcurrencyFingerprint(
  attendee: AttendeeConcurrencyRow,
): string {
  const snapshot: Record<string, unknown> = { id: attendee.id };
  for (const field of CONCURRENCY_FIELDS) {
    snapshot[field] = attendee[field] ?? null;
  }
  return JSON.stringify(snapshot);
}

// True exactly when the selected record is both locally dirty and has a
// server fingerprint that no longer matches the one captured when editing
// began -- the one condition that must block Save and require the operator
// to deliberately reconcile (Stage D requirement 5 / Test Expectation H).
export function attendeeChangedRemotelyWhileDirty(
  baselineFingerprint: string | null,
  serverFingerprint: string | null,
  isDirty: boolean,
): boolean {
  return !!(
    isDirty &&
    baselineFingerprint &&
    serverFingerprint &&
    baselineFingerprint !== serverFingerprint
  );
}
