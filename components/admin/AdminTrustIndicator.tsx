import { Alert } from "@/components/ui/Alert";

// Presentation-only placeholder for the governed Admin Trust Indicator
// (docs/architecture/EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md §7). The
// governed aggregation point this indicator is meant to consume --
// Collector/Provider evidence quality, connectivity/session state,
// platform-service state -- does not exist yet. This component does not
// compute, poll, fetch, or infer any of that itself; it renders only the
// honest, neutral statement that trust resolution is not yet connected.
//
// It must never default to a green/trustworthy state merely because no
// problem is currently known (§7, Semantic limits) -- the absence of a
// governed signal is not evidence of trustworthiness. It renders through
// the shared `Alert` primitive (UI Phase 1) at its neutral tone -- never
// `success`/`warning`/`danger` -- and the decorative icon within it is
// `aria-hidden`; the visible text is the sole carrier of meaning, matching
// the same discipline already established in
// components/MemberDashboardHeader.tsx's status row.
//
// Not yet interactive: §7 describes a tappable control that opens a
// detail panel explaining which source is unhealthy. Building that
// affordance now, with no real aggregation behind it, would itself be
// inventing Trust Indicator behavior ahead of its governed source --
// left to the separately authorized task that builds the aggregation
// point.
export default function AdminTrustIndicator() {
  return <Alert tone="neutral">Status check not yet connected</Alert>;
}
