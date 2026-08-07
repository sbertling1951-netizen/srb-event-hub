import type {
  CollectSharedExperienceContextInput,
  NormalizedAgendaItem,
  SharedExperienceContext,
} from "@/lib/experienceContext/types";
import { supabase } from "@/lib/supabase";

// Collect once. Normalize once. Distribute many times. Never own
// authoritative state. See
// docs/architecture/EPICENTRAX_SHARED_EXPERIENCE_CONTEXT_ARCHITECTURE.md.
//
// This collector performs no Person, Workspace, or event resolution --
// `input.event` must already be resolved by the caller. It reuses the same
// governed, RLS-scoped reads the agenda, announcements, and vendor-request
// pages already use, and fails quiet (returns null for that slice) when an
// optional read fails, so one slow or failing source never blocks the rest
// of the context.

type AgendaRow = {
  id: string;
  title: string | null;
  agenda_date: string | null;
  start_time: string | null;
  end_time: string | null;
};

// Matches public.get_my_vendor_service_requests's return shape (see
// supabase/migrations/20260807120000_create_governed_member_vendor_request_read.sql).
// Only the field this slice needs is declared here.
type VendorRequestRow = {
  request_status: string | null;
};

const CLOSED_VENDOR_REQUEST_STATUSES = new Set(["completed", "cancelled"]);

function computeEventDayNumber(
  startDate: string | null,
  now: Date,
): number | null {
  if (!startDate) {
    return null;
  }

  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) {
    return null;
  }

  const startDay = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayNumber =
    Math.round((today.getTime() - startDay.getTime()) / 86400000) + 1;

  return dayNumber < 1 ? null : dayNumber;
}

function toDateTime(agendaDate: string | null, time: string | null): Date | null {
  if (agendaDate && time) {
    const d = new Date(`${agendaDate}T${time}`);
    if (!Number.isNaN(d.getTime())) {
      return d;
    }
  }
  return null;
}

function classifyAgendaItem(
  row: AgendaRow,
  now: Date,
): "now" | "upcoming" | "past" | "unknown" {
  const start = toDateTime(row.agenda_date, row.start_time);
  const end = toDateTime(row.agenda_date, row.end_time);

  if (start && end) {
    if (now >= start && now <= end) {
      return "now";
    }
    return now < start ? "upcoming" : "past";
  }

  if (start) {
    return now < start ? "upcoming" : "past";
  }

  return "unknown";
}

function agendaItemSortValue(row: AgendaRow): number {
  const start = toDateTime(row.agenda_date, row.start_time);
  if (start) {
    return start.getTime();
  }

  if (row.agenda_date) {
    const d = new Date(`${row.agenda_date}T23:59:59`);
    if (!Number.isNaN(d.getTime())) {
      return d.getTime();
    }
  }

  return Number.MAX_SAFE_INTEGER;
}

function toNormalizedAgendaItem(row: AgendaRow): NormalizedAgendaItem {
  return {
    id: row.id,
    title: row.title,
    agendaDate: row.agenda_date,
    startTime: row.start_time,
    endTime: row.end_time,
  };
}

async function collectAgendaSlice(
  eventId: string,
  now: Date,
): Promise<SharedExperienceContext["agenda"]> {
  try {
    const { data, error } = await supabase
      .from("agenda_items")
      .select("id,title,agenda_date,start_time,end_time")
      .eq("event_id", eventId)
      .eq("is_published", true);

    if (error) {
      throw error;
    }

    const rows = (data ?? []) as AgendaRow[];
    const current = rows.find((row) => classifyAgendaItem(row, now) === "now") ?? null;
    const upcoming = rows
      .filter((row) => classifyAgendaItem(row, now) === "upcoming")
      .sort((a, b) => agendaItemSortValue(a) - agendaItemSortValue(b));

    return {
      currentItem: current ? toNormalizedAgendaItem(current) : null,
      nextItem: upcoming.length > 0 ? toNormalizedAgendaItem(upcoming[0]) : null,
    };
  } catch (err) {
    console.error("collectSharedExperienceContext: agenda slice failed:", err);
    return { currentItem: null, nextItem: null };
  }
}

async function collectAnnouncementsActiveCount(
  eventId: string,
  now: Date,
): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from("announcements")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("is_published", true)
      .or(`expire_at.is.null,expire_at.gt.${now.toISOString()}`);

    if (error) {
      throw error;
    }

    return count ?? 0;
  } catch (err) {
    console.error(
      "collectSharedExperienceContext: announcements slice failed:",
      err,
    );
    return null;
  }
}

async function collectVendorRequestsOpenCount(
  eventId: string,
  eventCode: string | null,
  registrationIdentifier: string | null,
): Promise<number | null> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    const params = new URLSearchParams({ eventId });
    if (eventCode) {
      params.set("eventCode", eventCode);
    }
    if (registrationIdentifier) {
      params.set("registrationIdentifier", registrationIdentifier);
    }

    const response = await fetch(
      `/api/member/vendor-requests?${params.toString()}`,
      accessToken
        ? { headers: { Authorization: `Bearer ${accessToken}` } }
        : undefined,
    );

    if (!response.ok) {
      throw new Error(`vendor requests read failed: ${response.status}`);
    }

    const payload = (await response.json()) as { data?: VendorRequestRow[] };
    const rows = payload.data ?? [];

    return rows.filter(
      (row) => !CLOSED_VENDOR_REQUEST_STATUSES.has(row.request_status || "new"),
    ).length;
  } catch (err) {
    console.error(
      "collectSharedExperienceContext: vendor requests slice failed:",
      err,
    );
    return null;
  }
}

export async function collectSharedExperienceContext(
  input: CollectSharedExperienceContextInput,
): Promise<SharedExperienceContext> {
  const { event, now } = input;

  const [agenda, announcementsActiveCount, vendorRequestsOpenCount] =
    await Promise.all([
      collectAgendaSlice(event.id, now),
      collectAnnouncementsActiveCount(event.id, now),
      collectVendorRequestsOpenCount(
        event.id,
        input.eventCode,
        input.registrationIdentifier,
      ),
    ]);

  return {
    generatedAt: now.toISOString(),
    event: {
      id: event.id,
      name: event.name,
      location: event.location,
      startDate: event.start_date,
      endDate: event.end_date,
      dayNumber: computeEventDayNumber(event.start_date, now),
      // No authoritative event-phase source exists yet. See the
      // architecture document.
      phase: null,
    },
    member: {
      attendeeId: input.attendeeId,
      participantCapacity: input.participantCapacity,
      participantCount: input.participantCount,
      checkedIn: input.checkedIn,
    },
    agenda,
    announcements: { activeCount: announcementsActiveCount },
    // No governed member-facing read path exists for public.assignments
    // yet. See the architecture document.
    assignments: { activeCount: null },
    vendorRequests: { openCount: vendorRequestsOpenCount },
  };
}
