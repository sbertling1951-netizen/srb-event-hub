import type { ExperienceContextProvider } from "@/lib/experienceContext/providers/types";
import type { SharedExperienceContext } from "@/lib/experienceContext/types";
import { supabase } from "@/lib/supabase";

// This Provider owns exactly the "assignments" Shared Context Pool
// slice. See docs/architecture/EPICENTRAX_INTELLIGENCE_COLLECTOR_
// ARCHITECTURE.md ("Deduplication", "Evidence Quality Classification",
// "Freshness") and
// docs/architecture/EPICENTRAX_MEMBER_ASSIGNMENT_READ_BOUNDARY_
// ARCHITECTURE.md.
//
// Governed read boundary: GET /api/member/assignments
// (app/api/member/assignments/route.ts), which in turn calls the
// governed RPC public.get_my_active_assignments. This Provider already
// consumed that boundary correctly before this pass -- it calls the API
// route, never the RPC directly, exactly as
// EPICENTRAX_MEMBER_ASSIGNMENT_READ_BOUNDARY_ARCHITECTURE.md requires
// ("a future assignmentsProvider.ts would call a new GET
// /api/member/assignments route"). No bypass was found; this pass only
// adds the governed slice metadata and normalizes the boundary's
// existing four-state contract more precisely (see
// buildAssignmentsSlice below) -- it does not change, improve,
// reinterpret, or supplement the boundary itself, and performs no
// Person, Tenant, Workspace, Relationship, Participation, or Authority
// resolution of its own.
//
// Deduplication: not applicable, and not implemented. public.assignments
// carries `UNIQUE (person_id, responsibility_id, event_id) WHERE status
// = 'active'` (assignments_active_person_responsibility_event_unique,
// 20260804140000_create_responsibility_and_assignment_foundation.sql) --
// the database itself already makes it structurally impossible for two
// active-assignment rows to represent the same Person x Responsibility x
// Event fact. The governed RPC additionally fails closed
// (transient_error) if it ever received a malformed or mixed-status
// result (see app/api/member/assignments/route.ts,
// resolveUniformAssignmentStatus) -- conflict handling for this read
// already exists at the governed boundary, upstream of this Provider.
// This Provider never sees individual assignment rows at all; it only
// counts an already-authoritative, already-deduplicated array returned
// by the API route. There is no row-level identity question left for it
// to invent a rule for.

type AssignmentSummary = {
  id: string;
  responsibilityLabel: string;
  attributedAt: string;
};

export type AssignmentApiResponse =
  | { status: "resolved"; assignments: AssignmentSummary[] }
  | { status: "identity_unavailable" }
  | { status: "invalid_session" }
  | { status: "transient_error" };

type ResolvedOrUnavailableAssignmentApiResponse = Extract<
  AssignmentApiResponse,
  { status: "resolved" | "identity_unavailable" }
>;

// Pure: no I/O. Normalizes an already-fetched, already-governed API
// response into the Pool's slice shape.
//
// `identity_unavailable` is itself a governed, successful API outcome --
// per EPICENTRAX_MEMBER_ASSIGNMENT_READ_BOUNDARY_ARCHITECTURE.md, a 200
// response, not an error ("a legitimate temporary session with an
// unbridged Person is not an invalid session"). The read genuinely
// executed against the governed boundary -- this is not "not collected
// at all" (EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md's own
// definition of "unavailable"), so evidenceQuality is "partial": the
// collection happened, but the required sub-fact needed to produce
// activeCount -- a resolved identity -- could not be resolved
// ("collected, but some required sub-fact within it could not be
// resolved," the architecture's own definition of "partial"). observedAt
// records the real moment this was observed. A genuine collection
// failure (`invalid_session` / `transient_error`) is a different case
// entirely and is not handled here: collectAssignmentsSlice below throws
// instead, so the Collector's existing generic per-provider isolation
// applies the canonical unavailable default (evidenceQuality:
// "unavailable", observedAt: null) exactly as for any other Provider
// failure -- reserving "unavailable" for when nothing was collected at
// all, never for a governed response that arrived but was incomplete.
export function buildAssignmentsSlice(
  payload: ResolvedOrUnavailableAssignmentApiResponse,
  now: Date,
): SharedExperienceContext["assignments"] {
  if (payload.status === "identity_unavailable") {
    return {
      activeCount: null,
      evidenceQuality: "partial",
      observedAt: now.toISOString(),
    };
  }

  return {
    // Preserves the authoritative result exactly -- a straight count of
    // the array the governed boundary already returned. No filtering,
    // inference, or reinterpretation of which assignments count.
    activeCount: payload.assignments.length,
    evidenceQuality: "governed",
    observedAt: now.toISOString(),
  };
}

async function collectAssignmentsSlice(
  eventId: string,
  eventCode: string | null,
  registrationIdentifier: string | null,
  now: Date,
): Promise<SharedExperienceContext["assignments"]> {
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
    `/api/member/assignments?${params.toString()}`,
    accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
  );

  const payload = (await response.json()) as AssignmentApiResponse;

  if (!response.ok) {
    throw new Error(
      `assignments read failed: ${response.status} (${payload.status})`,
    );
  }

  if (
    payload.status !== "resolved" &&
    payload.status !== "identity_unavailable"
  ) {
    throw new Error(
      `assignments read returned unexpected status: ${payload.status}`,
    );
  }

  return buildAssignmentsSlice(payload, now);
}

export const assignmentsExperienceContextProvider: ExperienceContextProvider<"assignments"> =
  {
    name: "assignments",
    key: "assignments",
    async collect(input) {
      return {
        assignments: await collectAssignmentsSlice(
          input.event.id,
          input.eventCode,
          input.registrationIdentifier,
          input.now,
        ),
      };
    },
  };
