type BreakdownRow = {
  label: string;
  count: number;
};

type ReportsSummaryCardsProps = {
  participantBreakdown: BreakdownRow[];
  dataStatusBreakdown: BreakdownRow[];
};

export default function ReportsSummaryCards({
  participantBreakdown,
  dataStatusBreakdown,
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
    </div>
  );
}
