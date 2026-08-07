import type { ExperienceContextProvider } from "@/lib/experienceContext/providers/types";
import type { SharedExperienceContext } from "@/lib/experienceContext/types";
import { supabase } from "@/lib/supabase";

// This Provider owns exactly the "announcements" Shared Context Pool
// slice. See docs/architecture/EPICENTRAX_INTELLIGENCE_COLLECTOR_
// ARCHITECTURE.md ("Deduplication", "Evidence Quality Classification",
// "Freshness"). It reads only the same governed, RLS-scoped
// announcements table AnnouncementBanner and the announcements page
// already read, performs no write of any kind, and resolves no Person,
// Tenant, Relationship, Participation, Assignment, Authority, or
// Workspace.
//
// Deduplication: not applicable, and not implemented. The authoritative
// query below is a `count: "exact", head: true` request -- Postgres/
// PostgREST computes COUNT(*) server-side over the matching rows and
// returns only that integer; no row payload is ever returned to this
// Provider. There is no intermediate row-level representation here for
// the Provider to inspect, group, or deduplicate -- the database's own
// aggregate *is* the authoritative fact this slice reports. Unlike
// agendaProvider (which reads individual rows and therefore had to
// establish, from the actual schema and write path, whether two rows
// could be proven to represent the same fact), there is no row-level
// identity question to investigate here at all: this Provider never
// receives more than one datum, so inventing a natural key or a
// conflict rule would have nothing to apply to.

async function collectAnnouncementsActiveCount(
  eventId: string,
  now: Date,
): Promise<number> {
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
}

// Pure: no I/O, deterministic in `now`. Kept separate from
// collectAnnouncementsActiveCount above so the slice's governed metadata
// is testable without a Supabase call, mirroring agendaProvider's
// computeAgendaSlice.
export function buildAnnouncementsSlice(
  activeCount: number,
  now: Date,
): SharedExperienceContext["announcements"] {
  return {
    activeCount,
    // Reaching this point means the read succeeded. See Evidence
    // Quality Classification -- deliberately independent of observedAt
    // below; neither is derived from the other.
    evidenceQuality: "governed",
    // See Freshness: the moment this count was actually observed.
    // Always sourced from the caller-supplied `now`, never a fresh
    // wall-clock read here.
    observedAt: now.toISOString(),
  };
}

export const announcementsExperienceContextProvider: ExperienceContextProvider<"announcements"> =
  {
    name: "announcements",
    key: "announcements",
    async collect(input) {
      const activeCount = await collectAnnouncementsActiveCount(
        input.event.id,
        input.now,
      );

      return {
        announcements: buildAnnouncementsSlice(activeCount, input.now),
      };
    },
  };
