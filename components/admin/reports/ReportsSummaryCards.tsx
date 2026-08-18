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
        gap: 18,
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
      }}
    >
      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, marginBottom: 10 }}>
          Registration Type Breakdown
        </h2>

        {registrationTypeBreakdown.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No registration data found.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {registrationTypeBreakdown.map((row) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  borderTop: "1px solid #eee",
                  paddingTop: 8,
                }}
              >
                <span style={{ textTransform: "capitalize" }}>{row.label}</span>
                <strong>{row.count}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, marginBottom: 10 }}>
          Data Status Breakdown
        </h2>

        {dataStatusBreakdown.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No data status records found.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {dataStatusBreakdown.map((row) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  borderTop: "1px solid #eee",
                  paddingTop: 8,
                }}
              >
                <span style={{ textTransform: "capitalize" }}>{row.label}</span>
                <strong>{row.count}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, marginBottom: 10 }}>
          Unassigned Parking Needed
        </h2>
        <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 10 }}>
          {operationalSummaryText(
            operationalSummary,
            operationalSummaryError,
            (summary) => summary.activeNeedsParkingUnplaced,
            "active registration",
          )}
        </div>
        {unassignedParkingRows.length === 0 ? (
          <div style={{ opacity: 0.8 }}>
            No unassigned parking-needed attendees.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {unassignedParkingRows.slice(0, 12).map((row, index) => (
              <div
                key={`${row.pilot}-${row.email}-${index}`}
                style={quickListRowStyle}
              >
                <strong>{row.pilot || "Unnamed"}</strong>
                <div style={quickListMetaStyle}>
                  {row.email || "No email"}
                  {row.cityState ? ` • ${row.cityState}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, marginBottom: 10 }}>Arrived</h2>
        <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 10 }}>
          {operationalSummaryText(
            operationalSummary,
            operationalSummaryError,
            (summary) => summary.activeArrived,
            "active registration",
          )}
        </div>
        {arrivedRows.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No attendees are marked arrived.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {arrivedRows.slice(0, 12).map((row, index) => (
              <div
                key={`${row.pilot}-${row.email}-${index}`}
                style={quickListRowStyle}
              >
                <strong>{row.pilot || "Unnamed"}</strong>
                <div style={quickListMetaStyle}>
                  {row.site ? `Site ${row.site}` : "No site assigned"}
                  {row.email ? ` • ${row.email}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, marginBottom: 10 }}>Not Arrived</h2>
        <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 10 }}>
          {operationalSummaryText(
            operationalSummary,
            operationalSummaryError,
            (summary) => summary.activeNotArrived,
            "active registration",
          )}
        </div>
        {notArrivedRows.length === 0 ? (
          <div style={{ opacity: 0.8 }}>All attendees are marked arrived.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {notArrivedRows.slice(0, 12).map((row, index) => (
              <div
                key={`${row.pilot}-${row.email}-${index}`}
                style={quickListRowStyle}
              >
                <strong>{row.pilot || "Unnamed"}</strong>
                <div style={quickListMetaStyle}>
                  {row.site ? `Site ${row.site}` : "No site assigned"}
                  {row.email ? ` • ${row.email}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, marginBottom: 10 }}>First Timers</h2>
        <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 10 }}>
          {firstTimerCount} attendee
          {firstTimerCount === 1 ? "" : "s"}
        </div>
        {firstTimerRows.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No first timers found.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {firstTimerRows.slice(0, 12).map((row, index) => (
              <div
                key={`${row.pilot}-${row.email}-${index}`}
                style={quickListRowStyle}
              >
                <strong>{row.pilot || "Unnamed"}</strong>
                <div style={quickListMetaStyle}>
                  {row.cityState || "No city/state"}
                  {row.email ? ` • ${row.email}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, marginBottom: 10 }}>
          Vendors / Staff / Speakers / Hosts
        </h2>
        <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 10 }}>
          {vendorStaffCount} attendee
          {vendorStaffCount === 1 ? "" : "s"}
        </div>
        {vendorStaffRows.length === 0 ? (
          <div style={{ opacity: 0.8 }}>
            No vendor or staff-type attendees found.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {vendorStaffRows.slice(0, 12).map((row, index) => (
              <div
                key={`${row.pilot}-${row.email}-${index}`}
                style={quickListRowStyle}
              >
                <strong>{row.pilot || "Unnamed"}</strong>
                <div style={quickListMetaStyle}>
                  {row.participantType}
                  {row.site ? ` • Site ${row.site}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
const quickListRowStyle = {
  borderTop: "1px solid #eee",
  paddingTop: 8,
};

const quickListMetaStyle = {
  fontSize: 13,
  color: "#666",
  marginTop: 2,
};
