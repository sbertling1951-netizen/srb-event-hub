import { EmptyState } from "@/components/ui/EmptyState";
import { PageSection } from "@/components/ui/PageSection";
import type { CanonicalEventOperationalSummary } from "@/lib/eventOperationalSummary";

type BreakdownRow = {
  label: string;
  count: number;
};

type RosterRow = {
  site: string;
  pilot: string;
  email: string;
  cityState: string;
  participantType: string;
};

type ReportsSummaryCardsProps = {
  registrationTypeBreakdown: BreakdownRow[];
  dataStatusBreakdown: BreakdownRow[];
  // The canonical Event Operational Summary Read Contract result --
  // docs/architecture/EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md. Card counts
  // below are copied verbatim from this; only the preview name lists are a
  // page-local detail view.
  operationalSummary: CanonicalEventOperationalSummary | null;
  operationalSummaryError: string | null;
  arrivedRows: RosterRow[];
  unassignedParkingRows: RosterRow[];
  notArrivedRows: RosterRow[];
  firstTimerCount: number;
  firstTimerRows: RosterRow[];
  vendorStaffCount: number;
  vendorStaffRows: RosterRow[];
};

function operationalSummaryText(
  operationalSummary: CanonicalEventOperationalSummary | null,
  operationalSummaryError: string | null,
  value: (summary: CanonicalEventOperationalSummary) => number,
  noun: string,
) {
  if (!operationalSummary) {
    return operationalSummaryError || "Operational summary unavailable.";
  }
  const count = value(operationalSummary);
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const quickListRowStyle = {
  borderTop: "var(--border-width-default) solid var(--color-border-default)",
  paddingTop: "var(--space-2)",
};

export default function ReportsSummaryCards({
  registrationTypeBreakdown,
  dataStatusBreakdown,
  operationalSummary,
  operationalSummaryError,
  arrivedRows,
  unassignedParkingRows,
  notArrivedRows,
  firstTimerCount,
  firstTimerRows,
  vendorStaffCount,
  vendorStaffRows,
}: ReportsSummaryCardsProps) {
  return (
    <div
      style={{
        display: "grid",
        gap: "var(--space-5)",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
      }}
    >
      <PageSection variant="card" title="Registration Type Breakdown" titleStyle={{ marginBottom: "var(--space-3)" }}>
        {registrationTypeBreakdown.length === 0 ? (
          <EmptyState message="No registration data found." />
        ) : (
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            {registrationTypeBreakdown.map((row) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "var(--space-3)",
                  ...quickListRowStyle,
                }}
              >
                <span style={{ textTransform: "capitalize" }}>{row.label}</span>
                <strong>{row.count}</strong>
              </div>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection variant="card" title="Data Status Breakdown" titleStyle={{ marginBottom: "var(--space-3)" }}>
        {dataStatusBreakdown.length === 0 ? (
          <EmptyState message="No data status records found." />
        ) : (
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            {dataStatusBreakdown.map((row) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "var(--space-3)",
                  ...quickListRowStyle,
                }}
              >
                <span style={{ textTransform: "capitalize" }}>{row.label}</span>
                <strong>{row.count}</strong>
              </div>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection variant="card" title="Unassigned Parking Needed" titleStyle={{ marginBottom: "var(--space-2)" }}>
        <p className="app-subtle-text" style={{ marginTop: 0, marginBottom: "var(--space-3)" }}>
          {operationalSummaryText(
            operationalSummary,
            operationalSummaryError,
            (summary) => summary.activeNeedsParkingUnplaced,
            "active registration",
          )}
        </p>
        {unassignedParkingRows.length === 0 ? (
          <EmptyState message="No unassigned parking-needed attendees." />
        ) : (
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            {unassignedParkingRows.slice(0, 12).map((row, index) => (
              <div key={`${row.pilot}-${row.email}-${index}`} style={quickListRowStyle}>
                <strong>{row.pilot || "Unnamed"}</strong>
                <div className="data-table-cell-meta">
                  {row.email || "No email"}
                  {row.cityState ? ` • ${row.cityState}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection variant="card" title="Arrived" titleStyle={{ marginBottom: "var(--space-2)" }}>
        <p className="app-subtle-text" style={{ marginTop: 0, marginBottom: "var(--space-3)" }}>
          {operationalSummaryText(
            operationalSummary,
            operationalSummaryError,
            (summary) => summary.activeArrived,
            "active registration",
          )}
        </p>
        {arrivedRows.length === 0 ? (
          <EmptyState message="No attendees are marked arrived." />
        ) : (
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            {arrivedRows.slice(0, 12).map((row, index) => (
              <div key={`${row.pilot}-${row.email}-${index}`} style={quickListRowStyle}>
                <strong>{row.pilot || "Unnamed"}</strong>
                <div className="data-table-cell-meta">
                  {row.site ? `Site ${row.site}` : "No site assigned"}
                  {row.email ? ` • ${row.email}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection variant="card" title="Not Arrived" titleStyle={{ marginBottom: "var(--space-2)" }}>
        <p className="app-subtle-text" style={{ marginTop: 0, marginBottom: "var(--space-3)" }}>
          {operationalSummaryText(
            operationalSummary,
            operationalSummaryError,
            (summary) => summary.activeNotArrived,
            "active registration",
          )}
        </p>
        {notArrivedRows.length === 0 ? (
          <EmptyState message="All attendees are marked arrived." />
        ) : (
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            {notArrivedRows.slice(0, 12).map((row, index) => (
              <div key={`${row.pilot}-${row.email}-${index}`} style={quickListRowStyle}>
                <strong>{row.pilot || "Unnamed"}</strong>
                <div className="data-table-cell-meta">
                  {row.site ? `Site ${row.site}` : "No site assigned"}
                  {row.email ? ` • ${row.email}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection variant="card" title="First Timers" titleStyle={{ marginBottom: "var(--space-2)" }}>
        <p className="app-subtle-text" style={{ marginTop: 0, marginBottom: "var(--space-3)" }}>
          {firstTimerCount} attendee
          {firstTimerCount === 1 ? "" : "s"}
        </p>
        {firstTimerRows.length === 0 ? (
          <EmptyState message="No first timers found." />
        ) : (
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            {firstTimerRows.slice(0, 12).map((row, index) => (
              <div key={`${row.pilot}-${row.email}-${index}`} style={quickListRowStyle}>
                <strong>{row.pilot || "Unnamed"}</strong>
                <div className="data-table-cell-meta">
                  {row.cityState || "No city/state"}
                  {row.email ? ` • ${row.email}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection variant="card" title="Vendors / Staff / Speakers / Hosts" titleStyle={{ marginBottom: "var(--space-2)" }}>
        <p className="app-subtle-text" style={{ marginTop: 0, marginBottom: "var(--space-3)" }}>
          {vendorStaffCount} attendee
          {vendorStaffCount === 1 ? "" : "s"}
        </p>
        {vendorStaffRows.length === 0 ? (
          <EmptyState message="No vendor or staff-type attendees found." />
        ) : (
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            {vendorStaffRows.slice(0, 12).map((row, index) => (
              <div key={`${row.pilot}-${row.email}-${index}`} style={quickListRowStyle}>
                <strong>{row.pilot || "Unnamed"}</strong>
                <div className="data-table-cell-meta">
                  {row.participantType}
                  {row.site ? ` • Site ${row.site}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </PageSection>
    </div>
  );
}
