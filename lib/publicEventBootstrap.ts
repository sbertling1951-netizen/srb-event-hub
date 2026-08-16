export type PublicEventCandidate = {
  id: string;
  name: string;
  venue_name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  map_image_url: string | null;
  master_map_id: string | null;
  locations_map_open_scale: number | null;
};

export type PublicEventBootstrap =
  | { kind: "none"; events: [] }
  | { kind: "single"; event: PublicEventCandidate; events: [PublicEventCandidate] }
  | { kind: "multiple"; events: PublicEventCandidate[] };

export function classifyPublicEventCandidates(
  events: PublicEventCandidate[],
): PublicEventBootstrap {
  if (events.length === 0) return { kind: "none", events: [] };
  if (events.length === 1) return { kind: "single", event: events[0], events: [events[0]] };
  return { kind: "multiple", events };
}

export async function loadPublicEventBootstrap(): Promise<PublicEventBootstrap> {
  const response = await fetch("/api/public/event-bootstrap", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load public events.");
  return response.json() as Promise<PublicEventBootstrap>;
}
