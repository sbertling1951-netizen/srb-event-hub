import type { ExperienceContextProvider } from "@/lib/experienceContext/providers/types";
import type {
  NormalizedAgendaItem,
  SharedExperienceContext,
} from "@/lib/experienceContext/types";
import { supabase } from "@/lib/supabase";

type AgendaRow = {
  id: string;
  title: string | null;
  agenda_date: string | null;
  start_time: string | null;
  end_time: string | null;
};

function toDateTime(
  agendaDate: string | null,
  time: string | null,
): Date | null {
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
  const { data, error } = await supabase
    .from("agenda_items")
    .select("id,title,agenda_date,start_time,end_time")
    .eq("event_id", eventId)
    .eq("is_published", true);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as AgendaRow[];
  const current =
    rows.find((row) => classifyAgendaItem(row, now) === "now") ?? null;
  const upcoming = rows
    .filter((row) => classifyAgendaItem(row, now) === "upcoming")
    .sort((a, b) => agendaItemSortValue(a) - agendaItemSortValue(b));

  return {
    currentItem: current ? toNormalizedAgendaItem(current) : null,
    nextItem: upcoming.length > 0 ? toNormalizedAgendaItem(upcoming[0]) : null,
  };
}

export const agendaExperienceContextProvider: ExperienceContextProvider<"agenda"> = {
  name: "agenda",
  key: "agenda",
  async collect(input) {
    return {
      agenda: await collectAgendaSlice(input.event.id, input.now),
    };
  },
};
