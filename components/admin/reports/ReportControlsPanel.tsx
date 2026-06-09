export type ReportType =
  | "first_timers"
  | "volunteers"
  | "vendors"
  | "staff_hosts_helpers"
  | "parking_assignments"
  | "unassigned_parking_needed"
  | "activity_summary";

export type SortType = "name_asc" | "name_desc" | "site_asc" | "site_desc";

export type ParticipantTypeFilter =
  | "all"
  | "attendee"
  | "vendor"
  | "staff"
  | "speaker"
  | "volunteer"
  | "event_host";

export type DataStatusFilter =
  | "all"
  | "pending"
  | "corrected"
  | "reviewed"
  | "locked";

type Props = {
  reportType: ReportType;
  setReportType: (value: ReportType) => void;
  sortType: SortType;
  setSortType: (value: SortType) => void;
  participantTypeFilter: ParticipantTypeFilter;
  setParticipantTypeFilter: (value: ParticipantTypeFilter) => void;
  dataStatusFilter: DataStatusFilter;
  setDataStatusFilter: (value: DataStatusFilter) => void;
  loading: boolean;
  canExport: boolean;
  onExportCsv: () => void;
  onExportXlsx: () => void;
  presetName: string;
  setPresetName: (value: string) => void;
  onSavePreset: () => void;
  reportPackType: "parking_ops" | "checkin_ops" | "hospitality_ops";
  setReportPackType: (
    value: "parking_ops" | "checkin_ops" | "hospitality_ops",
  ) => void;
  onPrintPack: () => void;
};

export default function ReportControlsPanel(props: Props) {
  return <div>ReportControlsPanel extraction in progress</div>;
}
