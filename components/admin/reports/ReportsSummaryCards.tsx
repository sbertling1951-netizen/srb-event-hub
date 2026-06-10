type BreakdownRow = {
  label: string;
  count: number;
};

type RosterRow = {
  site: string;
  pilot: string;
  email: string;
  cityState: string;
};

type ReportsSummaryCardsProps = {
  participantBreakdown: BreakdownRow[];
  dataStatusBreakdown: BreakdownRow[];
  unassignedParkingCount: number;
  unassignedParkingRows: RosterRow[];
  notArrivedCount: number;
  notArrivedRows: RosterRow[];
  firstTimerCount: number;
  firstTimerRows: RosterRow[];
};

export default function ReportsSummaryCards({
  participantBreakdown,
  dataStatusBreakdown,
  unassignedParkingCount,
  unassignedParkingRows,
  notArrivedCount,
  notArrivedRows,
  firstTimerCount,
  firstTimerRows,
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
          Participant Breakdown
        </h2>

        {participantBreakdown.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No participant data found.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {participantBreakdown.map((row) => (
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
          {unassignedParkingRows.length} attendee
          {unassignedParkingRows.length === 1 ? "" : "s"}
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
        <h2 style={{ marginTop: 0, marginBottom: 10 }}>Not Arrived</h2>
        <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 10 }}>
          {notArrivedRows.length} attendee
          {notArrivedRows.length === 1 ? "" : "s"}
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
