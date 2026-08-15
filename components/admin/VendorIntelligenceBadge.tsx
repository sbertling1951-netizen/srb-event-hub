"use client";

import type { VendorIntelligenceSummary } from "@/lib/vendorEventLifecycle";

type Props = {
  summary: VendorIntelligenceSummary | null;
  loading?: boolean;
};

/**
 * Renders get_vendor_intelligence_summary's derived, cross-platform
 * signal as advisory evidence -- never a prohibition. Only
 * performance_quality-classified dispositions ever produce this
 * (enforced server-side, in the RPC itself); operational/capacity
 * rejections (category full, capacity reached, insufficient space,
 * scheduling conflict, saturation) never appear here. Shows aggregate
 * counts only -- no raw reason text, no actor, no originating Tenant or
 * Event identity, matching the RPC's own privacy boundary.
 */
export default function VendorIntelligenceBadge({ summary, loading = false }: Props) {
  if (loading) {
    return (
      <span style={{ fontSize: 12, color: "#94a3b8" }}>Checking vendor intelligence...</span>
    );
  }

  if (!summary || !summary.has_quality_concerns) {
    return null;
  }

  const recent = summary.most_recent_quality_concern_at
    ? new Date(summary.most_recent_quality_concern_at).toLocaleDateString()
    : null;

  return (
    <div
      role="note"
      style={{
        display: "grid",
        gap: 4,
        fontSize: 12,
        color: "#92400e",
        background: "#fffbeb",
        border: "1px solid #fde68a",
        borderRadius: 10,
        padding: "8px 10px",
      }}
    >
      <div style={{ fontWeight: 800 }}>⚠ Prior performance/quality concerns</div>
      <div>
        {summary.quality_concern_count} adverse quality decision
        {summary.quality_concern_count === 1 ? "" : "s"} across{" "}
        {summary.distinct_events_with_concern_count} Event
        {summary.distinct_events_with_concern_count === 1 ? "" : "s"}
        {summary.distinct_tenants_with_concern_count > 1
          ? ` and ${summary.distinct_tenants_with_concern_count} Tenants`
          : ""}
        {recent ? ` -- most recent ${recent}` : ""}.
      </div>
      <div style={{ fontStyle: "italic", color: "#a16207" }}>
        This is decision-support evidence, not a prohibition. You retain the decision for this
        Event.
      </div>
    </div>
  );
}
