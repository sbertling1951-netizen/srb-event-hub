import * as XLSX from "xlsx";

import { getAgendaColor } from "@/lib/agendaColors";
import { AGENDA_IMPORT_TEMPLATE_CONTRACT } from "@/lib/importTemplateContract";

export type RawAgendaImportRow = Record<string, unknown>;

export type AgendaImportIssueCode =
  | "missing_agenda_title"
  | "missing_agenda_date"
  | "invalid_agenda_date"
  | "missing_agenda_start_time"
  | "invalid_agenda_start_time"
  | "invalid_agenda_end_time"
  | "invalid_agenda_sort_order"
  | "duplicate_agenda_external_id_in_file";

export type AgendaImportIssue = {
  code: AgendaImportIssueCode;
  message: string;
  severity: "error";
};

/**
 * JSON-safe evidence produced by the pure Agenda import contract. Invalid
 * rows retain their normalized partial evidence; they are never importable.
 */
export type AgendaImportCandidate = {
  source_row_number: number;
  title: string | null;
  description: string | null;
  location: string | null;
  speaker: string | null;
  agenda_date: string | null;
  start_time: string | null;
  end_time: string | null;
  category: string | null;
  color: string;
  is_published: boolean;
  sort_order: number | null;
  external_id: string | null;
};

export type AgendaImportInterpretation = {
  candidate: AgendaImportCandidate;
  validation_state: "valid" | "validation_failed";
  issues: AgendaImportIssue[];
};

export type AgendaImportRowContext = {
  source_row_number: number;
  default_sort_order: number;
  event_start_date?: string | null;
  event_end_date?: string | null;
};

export type AgendaImportEventDateContext = {
  event_start_date: string | null;
  event_end_date: string | null;
};

const AGENDA_FIELD_ALIASES = Object.fromEntries(
  AGENDA_IMPORT_TEMPLATE_CONTRACT.fields.map((field) => [
    field.key,
    field.aliases,
  ]),
) as Record<string, string[]>;

// Historical import-only fallbacks. They are accepted input vocabulary, but
// are not advertised as separate template columns because Agenda Date/Start
// Time/End Time remain the preferred contract.
export const AGENDA_STARTS_AT_ALIASES = [
  "starts_at",
  "Starts At",
  "Start DateTime",
  "start_at",
] as const;
export const AGENDA_ENDS_AT_ALIASES = [
  "ends_at",
  "Ends At",
  "End DateTime",
  "end_at",
] as const;

export function normalizeImportHeaderKey(value: string) {
  return value
    .replace(/\u00A0/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function getImportField(
  row: RawAgendaImportRow,
  names: readonly string[],
) {
  const normalizedRow: Record<string, unknown> = {};

  Object.keys(row).forEach((key) => {
    normalizedRow[normalizeImportHeaderKey(key)] = row[key];
  });

  for (const name of names) {
    const value = normalizedRow[normalizeImportHeaderKey(name)];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return undefined;
}

export function normalizeImportText(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function validCalendarDate(year: number, month: number, day: number) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }

  const probe = new Date(0);
  probe.setUTCHours(0, 0, 0, 0);
  probe.setUTCFullYear(year, month - 1, day);
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function formatCalendarDate(year: number, month: number, day: number) {
  if (!validCalendarDate(year, month, day)) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(
    2,
    "0",
  )}-${String(day).padStart(2, "0")}`;
}

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

type EventCalendarRange = {
  start: CalendarDate | null;
  end: CalendarDate | null;
  firstYear: number;
  lastYear: number;
};

function parseCanonicalCalendarDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const match = String(value)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (!match) {
    return null;
  }
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  return validCalendarDate(date.year, date.month, date.day) ? date : null;
}

function compareCalendarDates(left: CalendarDate, right: CalendarDate) {
  return (
    left.year * 10_000 + left.month * 100 + left.day -
    (right.year * 10_000 + right.month * 100 + right.day)
  );
}

function eventCalendarRange(
  context: Partial<AgendaImportEventDateContext> | undefined,
): EventCalendarRange | null {
  const hasStart = Boolean(context?.event_start_date);
  const hasEnd = Boolean(context?.event_end_date);
  if (!hasStart && !hasEnd) {
    return null;
  }

  const start = parseCanonicalCalendarDate(context?.event_start_date);
  const end = parseCanonicalCalendarDate(context?.event_end_date);
  if ((hasStart && !start) || (hasEnd && !end)) {
    return null;
  }
  if (start && end && compareCalendarDates(start, end) > 0) {
    return null;
  }

  return {
    start,
    end,
    firstYear: start?.year ?? end!.year,
    lastYear: end?.year ?? start!.year,
  };
}

function resolveMonthDayYear(
  month: number,
  day: number,
  context: Partial<AgendaImportEventDateContext> | undefined,
) {
  const range = eventCalendarRange(context);
  if (!range) {
    return null;
  }

  if (range.firstYear === range.lastYear) {
    return formatCalendarDate(range.firstYear, month, day);
  }

  const matches: string[] = [];
  for (let year = range.firstYear; year <= range.lastYear; year += 1) {
    const formatted = formatCalendarDate(year, month, day);
    if (!formatted) {
      continue;
    }
    const candidate = { year, month, day };
    if (
      (!range.start || compareCalendarDates(candidate, range.start) >= 0) &&
      (!range.end || compareCalendarDates(candidate, range.end) <= 0)
    ) {
      matches.push(formatted);
    }
  }

  return matches.length === 1 ? matches[0] : null;
}

function resolveTwoDigitYear(
  month: number,
  day: number,
  shortYear: number,
  context: Partial<AgendaImportEventDateContext> | undefined,
) {
  const range = eventCalendarRange(context);
  if (!range) {
    return null;
  }

  const candidates: Array<{ formatted: string; distance: number }> = [];
  for (let year = shortYear || 100; year <= 9999; year += 100) {
    const formatted = formatCalendarDate(year, month, day);
    if (!formatted) {
      continue;
    }
    const distance =
      year < range.firstYear
        ? range.firstYear - year
        : year > range.lastYear
          ? year - range.lastYear
          : 0;
    candidates.push({ formatted, distance });
  }

  const nearestDistance = Math.min(...candidates.map((candidate) => candidate.distance));
  const nearest = candidates.filter(
    (candidate) => candidate.distance === nearestDistance,
  );
  return nearest.length === 1 ? nearest[0].formatted : null;
}

export function normalizeImportDate(
  value: unknown,
  context?: Partial<AgendaImportEventDateContext>,
) {
  if (value === undefined || value === null) {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    return formatCalendarDate(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate(),
    );
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return formatCalendarDate(parsed.y, parsed.m, parsed.d);
    }
    return null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  // The date prefix also preserves the historical starts_at fallback without
  // allowing JavaScript Date to roll an impossible calendar date forward.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (iso) {
    return formatCalendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);
  if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    if (!slash[3]) {
      return resolveMonthDayYear(month, day, context);
    }
    if (slash[3].length === 2) {
      return resolveTwoDigitYear(month, day, Number(slash[3]), context);
    }
    return formatCalendarDate(Number(slash[3]), month, day);
  }

  return null;
}

function formatClock(hour: number, minute: number) {
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function excelTimeNumberToHHMM(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  // A parsed Excel value may be either a time fraction or a full date-time
  // serial. Preserve the live parser's modulo-day behavior for both forms.
  const totalMinutes = Math.round(value * 24 * 60) % (24 * 60);
  return formatClock(Math.floor(totalMinutes / 60), totalMinutes % 60);
}

export function normalizeImportTimeOnly(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : formatClock(value.getHours(), value.getMinutes());
  }

  if (typeof value === "number") {
    return excelTimeNumberToHHMM(value);
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const direct = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (direct) {
    return formatClock(Number(direct[1]), Number(direct[2]));
  }

  if (/^\d{3,4}$/.test(raw)) {
    const padded = raw.padStart(4, "0");
    return formatClock(Number(padded.slice(0, 2)), Number(padded.slice(2, 4)));
  }

  const meridiem = raw.match(
    /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i,
  );
  if (meridiem) {
    const hour12 = Number(meridiem[1]);
    const minute = Number(meridiem[2] ?? 0);
    if (hour12 < 1 || hour12 > 12) {
      return null;
    }
    const hour =
      (hour12 % 12) + (meridiem[3].toLowerCase() === "p" ? 12 : 0);
    return formatClock(hour, minute);
  }

  // Explicitly support the legacy starts_at/ends_at fallback for a full
  // datetime string while validating its clock components independently.
  const dateTime = raw.match(/(?:T|\s)(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (dateTime) {
    return formatClock(Number(dateTime[1]), Number(dateTime[2]));
  }

  return null;
}

export function yesNoToBool(value: unknown) {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  return raw === "yes" || raw === "y" || raw === "true" || raw === "1";
}

function slugifyAgendaTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Preserve the pre-Stage-A Agenda import identity formula byte-for-byte. */
export function deriveAgendaExternalId(
  title: string,
  agendaDate: string,
  startTime: string,
) {
  return [slugifyAgendaTitle(title), agendaDate, startTime].join("-");
}

function field(row: RawAgendaImportRow, key: string) {
  return getImportField(row, AGENDA_FIELD_ALIASES[key] || []);
}

function supplied(value: unknown) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

export function interpretAgendaImportRow(
  source_payload: RawAgendaImportRow,
  context: AgendaImportRowContext,
): AgendaImportInterpretation {
  const issues: AgendaImportIssue[] = [];
  const title = normalizeImportText(field(source_payload, "title"));
  const startsAtRaw = getImportField(source_payload, AGENDA_STARTS_AT_ALIASES);
  const endsAtRaw = getImportField(source_payload, AGENDA_ENDS_AT_ALIASES);
  const dateRaw = field(source_payload, "agenda_date") ?? startsAtRaw;
  const startRaw = field(source_payload, "start_time") ?? startsAtRaw;
  const endRaw = field(source_payload, "end_time") ?? endsAtRaw;
  const sortRaw = field(source_payload, "sort_order");
  const agendaDate = normalizeImportDate(dateRaw, context);
  const startTime = normalizeImportTimeOnly(startRaw);
  const endTime = normalizeImportTimeOnly(endRaw);
  const category = normalizeImportText(field(source_payload, "category"));
  const explicitColor = normalizeImportText(field(source_payload, "color"));

  let sortOrder: number | null = context.default_sort_order;
  if (supplied(sortRaw)) {
    const raw = String(sortRaw).trim();
    sortOrder = /^\d+$/.test(raw) ? Number(raw) : null;
    if (sortOrder === null || !Number.isSafeInteger(sortOrder)) {
      sortOrder = null;
      issues.push({
        code: "invalid_agenda_sort_order",
        message: "Sort Order must be a non-negative integer",
        severity: "error",
      });
    }
  }

  if (!title) {
    issues.push({
      code: "missing_agenda_title",
      message: "Missing Title",
      severity: "error",
    });
  }
  if (!supplied(dateRaw)) {
    issues.push({
      code: "missing_agenda_date",
      message: "Missing Agenda Date",
      severity: "error",
    });
  } else if (!agendaDate) {
    issues.push({
      code: "invalid_agenda_date",
      message: "Invalid Agenda Date",
      severity: "error",
    });
  }
  if (!supplied(startRaw)) {
    issues.push({
      code: "missing_agenda_start_time",
      message: "Missing Start Time",
      severity: "error",
    });
  } else if (!startTime) {
    issues.push({
      code: "invalid_agenda_start_time",
      message: "Invalid Start Time",
      severity: "error",
    });
  }
  if (supplied(endRaw) && !endTime) {
    issues.push({
      code: "invalid_agenda_end_time",
      message: "Invalid End Time",
      severity: "error",
    });
  }

  const externalId =
    title && agendaDate && startTime
      ? deriveAgendaExternalId(title, agendaDate, startTime)
      : null;
  const candidate: AgendaImportCandidate = {
    source_row_number: context.source_row_number,
    title,
    description: normalizeImportText(field(source_payload, "description")),
    location: normalizeImportText(field(source_payload, "location")),
    speaker: normalizeImportText(field(source_payload, "speaker")),
    agenda_date: agendaDate,
    start_time: startTime,
    end_time: endTime,
    category,
    color: getAgendaColor(category, explicitColor),
    is_published: yesNoToBool(field(source_payload, "is_published")),
    sort_order: sortOrder,
    external_id: externalId,
  };

  return {
    candidate,
    validation_state: issues.length ? "validation_failed" : "valid",
    issues,
  };
}

/**
 * Classify all otherwise-valid duplicate identities as validation failures.
 * There is deliberately no first-row winner and no needs_review state.
 */
export function classifyAgendaFileDuplicates(
  rows: AgendaImportInterpretation[],
): AgendaImportInterpretation[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const externalId = row.candidate.external_id;
    if (row.validation_state === "valid" && externalId) {
      counts.set(externalId, (counts.get(externalId) || 0) + 1);
    }
  }

  return rows.map((row) => {
    const externalId = row.candidate.external_id;
    if (
      row.validation_state !== "valid" ||
      !externalId ||
      (counts.get(externalId) || 0) < 2
    ) {
      return row;
    }

    return {
      ...row,
      validation_state: "validation_failed",
      issues: [
        ...row.issues,
        {
          code: "duplicate_agenda_external_id_in_file",
          message: "Duplicate Agenda item identity in file",
          severity: "error",
        },
      ],
    };
  });
}

export function interpretAgendaImportRows(
  rows: RawAgendaImportRow[],
  eventDateContext?: AgendaImportEventDateContext,
): AgendaImportInterpretation[] {
  return classifyAgendaFileDuplicates(
    rows.map((row, index) =>
      interpretAgendaImportRow(row, {
        source_row_number: index + 2,
        default_sort_order: index + 1,
        event_start_date: eventDateContext?.event_start_date,
        event_end_date: eventDateContext?.event_end_date,
      }),
    ),
  );
}

// Agenda's shipped XLSX assets intentionally keep title/instruction content
// above the headings. The fourth worksheet row is found from the same field
// contract used by row interpretation, without hard-coding a row number.
export function findAgendaWorkbookHeaderRow(worksheet: XLSX.WorkSheet): number {
  const worksheetRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  const requiredFields = AGENDA_IMPORT_TEMPLATE_CONTRACT.fields.filter(
    (field) => field.required,
  );

  return worksheetRows.findIndex((row) => {
    const headings = new Set(
      row.map((value) => normalizeImportHeaderKey(String(value ?? ""))),
    );

    return requiredFields.every((requiredField) =>
      requiredField.aliases.some((alias) =>
        headings.has(normalizeImportHeaderKey(alias)),
      ),
    );
  });
}

export function parseAgendaWorkbookWorksheet(
  worksheet: XLSX.WorkSheet,
): RawAgendaImportRow[] {
  const headerRow = findAgendaWorkbookHeaderRow(worksheet);

  return XLSX.utils.sheet_to_json<RawAgendaImportRow>(worksheet, {
    range: headerRow >= 0 ? headerRow : 0,
    defval: "",
    raw: false,
  });
}
