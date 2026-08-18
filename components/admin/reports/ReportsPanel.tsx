import type { CSSProperties } from "react";

type ActivitySummaryRow = {
  activityName: string;
  participantCount: number;
  totalQty: number;
  totalRevenue: number;
};

type RosterRow = {
  site: string;
  participantType: string;
  pilot: string;
  copilot: string;
  email: string;
  cityState: string;
  arrived: string;
  active: string;
  firstTimer: string;
  volunteer: string;
  source: string;
};

type ReportsPanelProps = {
  reportTitle: string;
  loading: boolean;
  reportType: string;
  participantTypeFilter: string;
  dataStatusFilter: string;
  activitySummaryRows: ActivitySummaryRow[];
  sortedRosterRows: RosterRow[];
};

export default function ReportsPanel({
  reportTitle,
  loading,
  reportType,
  participantTypeFilter,
  dataStatusFilter,
  activitySummaryRows,
  sortedRosterRows,
}: ReportsPanelProps) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0, marginBottom: 6 }}>{reportTitle}</h2>

        <div style={{ fontSize: 14, opacity: 0.8 }}>
          {reportType === "activity_summary"
            ? `${activitySummaryRows.length} activity rows`
            : `${sortedRosterRows.length} roster rows`}{" "}
          • Registration type:{" "}
          {participantTypeFilter === "all"
            ? "All Types"
            : participantTypeFilter}{" "}
          • Data status:{" "}
          {dataStatusFilter === "all" ? "All Statuses" : dataStatusFilter}
        </div>
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : reportType === "activity_summary" ? (
        activitySummaryRows.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No activity rows found.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Activity</th>
                  <th style={thStyle}>Participants</th>
                  <th style={thStyle}>Total Qty</th>
                  <th style={thStyle}>Total Revenue</th>
                </tr>
              </thead>
              <tbody>
                {activitySummaryRows.map((row) => (
                  <tr key={row.activityName}>
                    <td style={tdStyle}>{row.activityName}</td>
                    <td style={tdStyle}>{row.participantCount}</td>
                    <td style={tdStyle}>{row.totalQty}</td>
                    <td style={tdStyle}>${row.totalRevenue.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : sortedRosterRows.length === 0 ? (
        <div style={{ opacity: 0.8 }}>No rows found for this report.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Site</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Pilot</th>
                <th style={thStyle}>Co-Pilot</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>City / State</th>
                <th style={thStyle}>Arrived</th>
                <th style={thStyle}>Active</th>
                <th style={thStyle}>First Timer</th>
                <th style={thStyle}>Volunteer</th>
                <th style={thStyle}>Source</th>
              </tr>
            </thead>
            <tbody>
              {sortedRosterRows.map((row, index) => (
                <tr key={`${row.site}-${row.email}-${index}`}>
                  <td style={tdStyle}>{row.site}</td>
                  <td style={tdStyle}>{row.participantType}</td>
                  <td style={tdStyle}>{row.pilot}</td>
                  <td style={tdStyle}>{row.copilot}</td>
                  <td style={tdStyle}>{row.email}</td>
                  <td style={tdStyle}>{row.cityState}</td>
                  <td style={tdStyle}>{row.arrived}</td>
                  <td style={tdStyle}>{row.active}</td>
                  <td style={tdStyle}>{row.firstTimer}</td>
                  <td style={tdStyle}>{row.volunteer}</td>
                  <td style={tdStyle}>{row.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
const tableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse" };

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "2px solid #ddd",
  whiteSpace: "nowrap" as const,
};

const tdStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderTop: "1px solid #ddd",
  verticalAlign: "top",
};
