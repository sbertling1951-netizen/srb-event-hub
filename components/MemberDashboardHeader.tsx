import { computeEventDayNumber } from "@/lib/eventDayNumber";
import type { PrimaryExperienceSignal } from "@/lib/experienceContext";

// Presentation-only member dashboard header/status strip. Consumes only
// already-resolved values -- Event fields the page already has from
// getCurrentMemberEvent(), the already-governed Tenant branding source
// (useTenant(), wired at app/layout.tsx per ADR-009), and the already-
// resolved PrimaryExperienceSignal -- and performs no fetching, no
// browser storage access of any kind, no RPC, and no independent Tenant,
// Event, Person, Workspace, Assignment, or Authority resolution. See
// docs/architecture/EPICENTRAX_EXPERIENCE_ARCHITECTURE.md and
// docs/architecture/EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md.

export type MemberDashboardHeaderProps = {
  eventName: string;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  now: Date;
  logoUrl: string | null;
  organizationName: string | null;
  signal: PrimaryExperienceSignal | null;
  onMyEvents: () => void;
};

// Formats a "Day N" label from the shared computeEventDayNumber
// calculation (lib/eventDayNumber.ts) -- the same governed calculation
// the Collector's base event slice uses (lib/experienceContext/
// defaults.ts's buildCanonicalEventSlice). Returns null (never a
// fabricated label) whenever that calculation returns null: no start
// date, an unparseable start date, the event has not started yet, or the
// event is already over. See eventDayNumber.ts for the exact semantics
// and the date-parsing convention it preserves.
export function computeEventDayLabel(
  startDate: string | null,
  endDate: string | null,
  now: Date,
): string | null {
  const dayNumber = computeEventDayNumber(startDate, endDate, now);

  return dayNumber === null ? null : `Day ${dayNumber}`;
}

type StatusPresentation = {
  label: string;
  dotColor: string;
};

// Derives the status strip directly from PrimaryExperienceSignal.kind --
// the Resolver's own already-governed classification -- never by
// re-inspecting assignments/vendorRequests/agenda/capacity facts directly
// (that would be a second, UI-owned priority mapping, which this
// component must not become). "attention" is the one kind reserved for a
// structural/administrative problem (see
// EPICENTRAX_EXPERIENCE_INTELLIGENCE_ARCHITECTURE.md's Current-Rule
// Migration Map, where `attention` is the sole `compliance`-class
// outcome); every other kind ("information", "action", "reminder") is a
// normal operational state, not a problem. No signal yet (collection
// still pending or unavailable) is its own honest, neutral third state --
// never presented as either normal or attention-worthy.
function computeStatusPresentation(
  signal: PrimaryExperienceSignal | null,
): StatusPresentation {
  if (!signal) {
    return { label: "Status unavailable", dotColor: "#9ca3af" };
  }

  if (signal.kind === "attention") {
    return { label: "Needs attention", dotColor: "#ef4444" };
  }

  return { label: "All normal", dotColor: "#22c55e" };
}

export default function MemberDashboardHeader({
  eventName,
  location,
  startDate,
  endDate,
  now,
  logoUrl,
  organizationName,
  signal,
  onMyEvents,
}: MemberDashboardHeaderProps) {
  const dayLabel = computeEventDayLabel(startDate, endDate, now);
  const status = computeStatusPresentation(signal);

  return (
    <div
      className="card"
      style={{
        padding: 18,
        border: "1px solid #ddd",
        borderRadius: 12,
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={organizationName || eventName}
              style={{
                width: 44,
                height: 44,
                objectFit: "contain",
                flexShrink: 0,
              }}
            />
          ) : null}
          <div>
            <h1 style={{ marginTop: 0, marginBottom: 8 }}>{eventName}</h1>
            {location ? (
              <div style={{ fontSize: 14, opacity: 0.8 }}>{location}</div>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onMyEvents}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#f8fafc",
            color: "#0f172a",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          My Events
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 12,
          fontSize: 13,
          color: "#4b5563",
        }}
      >
        {/* Decorative only -- the visible status text below carries the
            meaning, so this must never be the sole accessible carrier of
            it. */}
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: status.dotColor,
            flexShrink: 0,
          }}
        />
        <span>{status.label}</span>
        <span aria-hidden="true">·</span>
        <span>
          {now.toLocaleDateString(undefined, { weekday: "long" })}
          {" · "}
          {now.toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          })}
          {dayLabel ? ` · ${dayLabel}` : ""}
        </span>
      </div>
    </div>
  );
}
