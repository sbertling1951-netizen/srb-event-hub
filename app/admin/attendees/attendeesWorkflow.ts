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
