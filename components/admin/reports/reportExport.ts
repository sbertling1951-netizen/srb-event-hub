export type ExportActivitySummaryRow = {
  activityName: string;
  participantCount: number;
  totalQty: number;
  totalRevenue: number;
};

export type ExportRosterRow = {
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

export type ExportEventContext = {
  name?: string | null;
  eventName?: string | null;
  location?: string | null;
};

type BuildExportRowsParams = {
  reportType: string;
  reportTitle: string;
  currentEvent: ExportEventContext | null;
  sortType: string;
  participantTypeFilter: string;
  dataStatusFilter: string;
  activitySummaryRows: ExportActivitySummaryRow[];
  sortedRosterRows: ExportRosterRow[];
};

export function buildExportRows({
  reportType,
  reportTitle,
  currentEvent,
  sortType,
  participantTypeFilter,
  dataStatusFilter,
  activitySummaryRows,
  sortedRosterRows,
}: BuildExportRowsParams): string[][] {
  if (reportType === "activity_summary") {
    return [
      [reportTitle],
      ["Event", currentEvent?.name || currentEvent?.eventName || ""],
      ["Location", currentEvent?.location || ""],
      ["Sort", sortType],
      ["Participant Type Filter", participantTypeFilter],
      ["Data Status Filter", dataStatusFilter],
      [],
      ["Activity", "Participant Count", "Total Quantity", "Total Revenue"],
      ...activitySummaryRows.map((row) => [
        row.activityName,
        String(row.participantCount),
        String(row.totalQty),
        row.totalRevenue.toFixed(2),
      ]),
    ];
  }

  return [
    [reportTitle],
    ["Event", currentEvent?.name || currentEvent?.eventName || ""],
    ["Location", currentEvent?.location || ""],
    ["Sort", sortType],
    ["Participant Type Filter", participantTypeFilter],
    ["Data Status Filter", dataStatusFilter],
    [],
    [
      "Site",
      "Participant Type",
      "Pilot",
      "Co-Pilot",
      "Email",
      "City/State",
      "Arrived",
      "Active",
      "First Timer",
      "Volunteer",
      "Source",
    ],
    ...sortedRosterRows.map((row) => [
      row.site,
      row.participantType,
      row.pilot,
      row.copilot,
      row.email,
      row.cityState,
      row.arrived,
      row.active,
      row.firstTimer,
      row.volunteer,
      row.source,
    ]),
  ];
}
