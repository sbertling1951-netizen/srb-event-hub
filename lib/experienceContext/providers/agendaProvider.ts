import type { ExperienceContextProvider } from "@/lib/experienceContext/providers/types";
import type {
  NormalizedAgendaItem,
  SharedExperienceContext,
} from "@/lib/experienceContext/types";
import { supabase } from "@/lib/supabase";

// This Provider owns exactly the "agenda" Shared Context Pool slice. See
// docs/architecture/EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md
// ("Deduplication", "Evidence Quality Classification", "Freshness"). It
// reads only the same governed, RLS-scoped agenda_items table the agenda
// page already reads, performs no write of any kind, and resolves no
// Person, Tenant, Relationship, Participation, Assignment, Authority, or
// Workspace.
//
// Deduplication: deliberately not implemented at this layer. Investigated
// against the actual schema and write paths, not assumed -- re-verified
// after the Agenda Consumer Migration governed cutover (Stages 2A/2B):
//   - public.agenda_items carries UNIQUE (event_id, external_id) (partial
//     unique index, WHERE external_id IS NOT NULL --
//     20260617000000_create_pre_20260618_public_baseline.sql). Bulk writes
//     now go through governed RPCs rather than any direct browser table
//     access: import_event_agenda_items() upserts on the conflict pair
//     "event_id,external_id" (a re-import can therefore never create a
//     second row for an item that already has an external_id -- the
//     existing row is updated in place, keeping its original id), while
//     apply_agenda_template_to_event()/replace_agenda_from_template()
//     insert fresh rows with external_id always NULL (template-derived
//     copies never inherit the source template item's external_id -- see
//     20260811300000-era repair). Both cases leave the database itself as
//     the governed deduplication mechanism (or, for template-derived
//     rows, the *absence* of any external-id-based identity to collide
//     on); there is nothing left for this Provider to safely deduplicate
//     among rows that carry an external_id, because two such rows sharing
//     one cannot coexist in a query result at all.
//   - `import_key` also exists on the table but is not referenced by any
//     write path found in this repository and carries no uniqueness
//     constraint -- it is not a governed identity mechanism and is not
//     used here.
//   - A manually created row (source = 'manual', or a template-derived
//     row with source = 'template') has no external_id and therefore no
//     governed identity signal at all. Two such rows that happen to share
//     a title, date, and start time are not provably the same underlying
//     fact -- they may simply be two genuinely independent agenda items
//     (parallel tracks, repeated time slots). This Provider must not, and
//     does not, guess that they are duplicates or in conflict merely
//     because they look similar. An earlier draft of this Provider
//     grouped rows by (title, agenda_date, start_time) and treated a
//     mismatched end_time as an unresolvable conflict; that was an
//     invented heuristic with no evidence behind it and has been removed.
//     Establishing a governed identity rule for manually or
//     template-created rows, if one is ever needed, is a separate,
//     future, explicitly authorized architectural decision -- not
//     something this Provider may improvise.

export type AgendaRow = {
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

// Pure: no I/O, no mutation of its input, deterministic in `now`. Kept
// separate from collectAgendaSlice below so normalization and
// classification are testable without a Supabase call. Every row
// received is treated as a genuine, independent fact -- see the
// Deduplication note above for why this Provider does not attempt to
// group or collapse rows itself.
export function computeAgendaSlice(
  rawRows: readonly AgendaRow[],
  now: Date,
): SharedExperienceContext["agenda"] {
  const current =
    rawRows.find((row) => classifyAgendaItem(row, now) === "now") ?? null;
  const upcoming = rawRows
    .filter((row) => classifyAgendaItem(row, now) === "upcoming")
    .slice()
    .sort((a, b) => agendaItemSortValue(a) - agendaItemSortValue(b));

  return {
    currentItem: current ? toNormalizedAgendaItem(current) : null,
    nextItem: upcoming.length > 0 ? toNormalizedAgendaItem(upcoming[0]) : null,
    // Reaching this point means the read succeeded. See Evidence Quality
    // Classification -- this is deliberately independent of observedAt
    // below; neither is derived from the other.
    evidenceQuality: "governed",
    // See Freshness: the moment this data was actually observed. Always
    // sourced from the caller-supplied `now`, never a fresh wall-clock
    // read here, so this function remains fully deterministic.
    observedAt: now.toISOString(),
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

  return computeAgendaSlice((data ?? []) as AgendaRow[], now);
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
