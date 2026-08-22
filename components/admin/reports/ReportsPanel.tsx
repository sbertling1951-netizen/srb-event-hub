import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageSection } from "@/components/ui/PageSection";

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
    <PageSection variant="card" title={reportTitle} titleStyle={{ marginBottom: "var(--space-1)" }}>
      <p className="app-subtle-text" style={{ marginTop: 0, marginBottom: "var(--space-4)" }}>
        {reportType === "activity_summary"
          ? `${activitySummaryRows.length} activity rows`
          : `${sortedRosterRows.length} roster rows`}{" "}
        • Registration type:{" "}
        {participantTypeFilter === "all" ? "All Types" : participantTypeFilter}{" "}
        • Data status:{" "}
        {dataStatusFilter === "all" ? "All Statuses" : dataStatusFilter}
      </p>

      {loading ? (
        <LoadingState message="Loading..." />
      ) : reportType === "activity_summary" ? (
        activitySummaryRows.length === 0 ? (
          <EmptyState message="No activity rows found." />
        ) : (
          <DataTable caption={reportTitle}>
            <thead>
              <tr>
                <th scope="col">Activity</th>
                <th scope="col">Participants</th>
                <th scope="col">Total Qty</th>
                <th scope="col">Total Revenue</th>
              </tr>
            </thead>
            <tbody>
              {activitySummaryRows.map((row) => (
                <tr key={row.activityName}>
                  <td>{row.activityName}</td>
                  <td>{row.participantCount}</td>
                  <td>{row.totalQty}</td>
                  <td>${row.totalRevenue.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )
      ) : sortedRosterRows.length === 0 ? (
        <EmptyState message="No rows found for this report." />
      ) : (
        <DataTable caption={reportTitle}>
          <thead>
            <tr>
              <th scope="col">Site</th>
              <th scope="col">Type</th>
              <th scope="col">Pilot</th>
              <th scope="col">Co-Pilot</th>
              <th scope="col">Email</th>
              <th scope="col">City / State</th>
              <th scope="col">Arrived</th>
              <th scope="col">Active</th>
              <th scope="col">First Timer</th>
              <th scope="col">Volunteer</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {sortedRosterRows.map((row, index) => (
              <tr key={`${row.site}-${row.email}-${index}`}>
                <td>{row.site}</td>
                <td>{row.participantType}</td>
                <td>{row.pilot}</td>
                <td>{row.copilot}</td>
                <td>{row.email}</td>
                <td>{row.cityState}</td>
                <td>{row.arrived}</td>
                <td>{row.active}</td>
                <td>{row.firstTimer}</td>
                <td>{row.volunteer}</td>
                <td>{row.source}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </PageSection>
  );
}
