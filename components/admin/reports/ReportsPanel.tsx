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
          • Participant type:{" "}
          {participantTypeFilter === "all"
            ? "All Types"
            : participantTypeFilter}{" "}
          • Data status:{" "}
          {dataStatusFilter === "all" ? "All Statuses" : dataStatusFilter}
        </div>
      </div>
    </div>
  );
}
