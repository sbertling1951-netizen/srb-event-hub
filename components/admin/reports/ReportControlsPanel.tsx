import { type CSSProperties } from "react";

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

export default function ReportControlsPanel(props: {
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
}) {
  const {
    reportType,
    setReportType,
    sortType,
    setSortType,
    participantTypeFilter,
    setParticipantTypeFilter,
    dataStatusFilter,
    setDataStatusFilter,
    loading,
    canExport,
    onExportCsv,
    onExportXlsx,
    presetName,
    setPresetName,
    onSavePreset,
    reportPackType,
    setReportPackType,
    onPrintPack,
  } = props;

  return (
    <div
      style={{
        display: "grid",
        gap: 14,
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        marginTop: 12,
      }}
    >
      <div>
        <label style={labelStyle}>Report Type</label>
        <select
          value={reportType}
          onChange={(e) => setReportType(e.target.value as ReportType)}
          style={inputStyle}
        >
          <option value="first_timers">First Timers</option>
          <option value="volunteers">Volunteers</option>
          <option value="vendors">Vendors</option>
          <option value="staff_hosts_helpers">Staff / Hosts / Helpers</option>
          <option value="parking_assignments">Parking Assignments</option>
          <option value="unassigned_parking_needed">
            Needs Parking / Unassigned
          </option>
          <option value="activity_summary">Activity Summary</option>
        </select>
      </div>

      <div>
        <label style={labelStyle}>Sort</label>
        <select
          value={sortType}
          onChange={(e) => setSortType(e.target.value as SortType)}
          style={inputStyle}
          disabled={reportType === "activity_summary"}
        >
          <option value="name_asc">Last Name A–Z</option>
          <option value="name_desc">Last Name Z–A</option>
          <option value="site_asc">Site 0–9 / A–Z</option>
          <option value="site_desc">Site 9–0 / Z–A</option>
        </select>
      </div>

      <div>
        <label style={labelStyle}>Participant Type</label>
        <select
          value={participantTypeFilter}
          onChange={(e) =>
            setParticipantTypeFilter(e.target.value as ParticipantTypeFilter)
          }
          style={inputStyle}
        >
          <option value="all">All Types</option>
          <option value="attendee">Attendee</option>
          <option value="vendor">Vendor</option>
          <option value="staff">Staff</option>
          <option value="speaker">Speaker</option>
          <option value="volunteer">Volunteer</option>
          <option value="event_host">Event Host</option>
        </select>
      </div>

      <div>
        <label style={labelStyle}>Data Status</label>
        <select
          value={dataStatusFilter}
          onChange={(e) =>
            setDataStatusFilter(e.target.value as DataStatusFilter)
          }
          style={inputStyle}
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="corrected">Corrected</option>
          <option value="reviewed">Reviewed</option>
          <option value="locked">Locked</option>
        </select>
      </div>

      <div>
        <label style={labelStyle}>Report Pack</label>
        <select
          value={reportPackType}
          onChange={(e) =>
            setReportPackType(
              e.target.value as
                | "parking_ops"
                | "checkin_ops"
                | "hospitality_ops",
            )
          }
          style={inputStyle}
        >
          <option value="parking_ops">Parking Operations Pack</option>
          <option value="checkin_ops">Check-In Pack</option>
          <option value="hospitality_ops">Hospitality Pack</option>
        </select>
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "end",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={onExportCsv}
          style={secondaryButtonStyle}
          disabled={loading || !canExport}
        >
          Export CSV
        </button>

        <button
          type="button"
          onClick={onExportXlsx}
          style={primaryButtonStyle}
          disabled={loading || !canExport}
        >
          Export XLSX
        </button>

        <button
          type="button"
          onClick={() => window.print()}
          style={secondaryButtonStyle}
        >
          Print
        </button>
        <button
          type="button"
          onClick={onPrintPack}
          style={secondaryButtonStyle}
          disabled={loading}
        >
          Print Pack
        </button>
      </div>

      <div>
        <label style={labelStyle}>Preset Name</label>
        <input
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
          style={inputStyle}
          placeholder="Save current report settings"
        />
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "end",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={onSavePreset}
          style={secondaryButtonStyle}
          disabled={loading}
        >
          Save Preset
        </button>
      </div>
    </div>
  );
}
const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontWeight: 600,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "white",
  color: "#111827",
  WebkitTextFillColor: "#111827",
  boxSizing: "border-box",
};

const primaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "#ffffff",
  WebkitTextFillColor: "#ffffff",
  fontWeight: 700,
  lineHeight: 1.2,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "#ffffff",
  color: "#111827",
  WebkitTextFillColor: "#111827",
  fontWeight: 700,
  lineHeight: 1.2,
  cursor: "pointer",
};
