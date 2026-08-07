import type { PrimaryExperienceSignal } from "@/lib/experienceContext";

// Presentation-only consumer of the already-resolved PrimaryExperienceSignal
// (lib/experienceContext/resolvePrimaryExperienceContext.ts). This component
// renders exactly the Resolver's title/summary/destination -- it performs no
// fetching, no browser storage access of any kind, and re-runs no priority
// rule. See docs/architecture/EPICENTRAX_EXPERIENCE_ARCHITECTURE.md ("The
// Context Card") and
// docs/architecture/EPICENTRAX_EXPERIENCE_INTELLIGENCE_ARCHITECTURE.md.

export type ContextCardProps = {
  signal: PrimaryExperienceSignal | null;
  // The app's normal internal navigation mechanism (app/member/page.tsx's
  // own `goTo`, backed by the Next.js router's push method) -- this
  // component never imports a router itself, so it cannot invent a
  // navigation path the caller did not already establish.
  onNavigate: (destination: string) => void;
};

// Presentation only -- maps the resolved signal's kind to a subtle,
// accessible color tone. Meaning is also carried by the title/summary text,
// never by color alone. Moved from app/member/page.tsx unchanged.
function contextCardTone(kind: PrimaryExperienceSignal["kind"]): {
  background: string;
  border: string;
  title: string;
  body: string;
} {
  switch (kind) {
    case "action":
      return {
        background: "#f0fdf4",
        border: "#bbf7d0",
        title: "#15803d",
        body: "#14532d",
      };
    case "reminder":
      return {
        background: "#fffbeb",
        border: "#fde68a",
        title: "#b45309",
        body: "#78350f",
      };
    case "attention":
      return {
        background: "#fef2f2",
        border: "#fecaca",
        title: "#b91c1c",
        body: "#7f1d1d",
      };
    case "information":
    default:
      return {
        background: "#eff6ff",
        border: "#bfdbfe",
        title: "#1d4ed8",
        body: "#1e3a8a",
      };
  }
}

export default function ContextCard({ signal, onNavigate }: ContextCardProps) {
  if (!signal) {
    return null;
  }

  const tone = contextCardTone(signal.kind);
  const destination = signal.destination;

  const sharedStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: 18,
    border: `1px solid ${tone.border}`,
    borderRadius: 12,
    background: tone.background,
  };

  const body = (
    <>
      <div style={{ fontWeight: 800, fontSize: 17, color: tone.title }}>
        {signal.title}
      </div>
      <div style={{ fontSize: 14, color: tone.body, marginTop: 4 }}>
        {signal.summary}
      </div>
    </>
  );

  // destination !== null is the only condition that makes this card
  // actionable -- never derived from `kind` or any other field. A real
  // <button> is used (matching every other internal-navigation control on
  // this dashboard), not a clickable <div>, so keyboard focus and
  // Enter/Space activation are native, not reimplemented.
  if (destination !== null) {
    return (
      <button
        type="button"
        onClick={() => onNavigate(destination)}
        data-source-slice={signal.sourceSlice ?? undefined}
        style={{ ...sharedStyle, cursor: "pointer" }}
      >
        {body}
      </button>
    );
  }

  // No destination: rendered as informational only -- not a focusable,
  // clickable control with nothing to activate.
  return (
    <div data-source-slice={signal.sourceSlice ?? undefined} style={sharedStyle}>
      {body}
    </div>
  );
}
