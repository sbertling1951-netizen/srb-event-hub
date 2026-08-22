import { AppButton } from "@/components/ui/AppButton";
import { Field, Input, Select } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";

export type ReportType =
  | "all_attendees"
  | "household_contact_sheet"
  | "arrived"
  | "not_arrived"
  | "first_timers"
  | "volunteers"
  | "vendors"
  | "staff_hosts_helpers"
  | "parking_assignments"
  | "unassigned_parking_needed"
  | "activity_summary"
  | "activity_roster";

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
        gap: "var(--space-4)",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        marginTop: "var(--space-3)",
      }}
    >
      <Field label="Report Type">
        {(controlProps) => (
          <Select
            {...controlProps}
            value={reportType}
            onChange={(e) => setReportType(e.target.value as ReportType)}
          >
            <option value="all_attendees">All Attendees</option>
            <option value="household_contact_sheet">
              Household Contact Sheet
            </option>
            <option value="arrived">Arrived</option>
            <option value="not_arrived">Not Arrived</option>
            <option value="first_timers">First Timers</option>
            <option value="volunteers">Volunteers</option>
            <option value="vendors">Vendors</option>
            <option value="staff_hosts_helpers">Staff / Hosts / Helpers</option>
            <option value="parking_assignments">Parking Assignments</option>
            <option value="unassigned_parking_needed">
              Needs Parking / Unassigned
            </option>
            <option value="activity_summary">Activity Summary</option>
            <option value="activity_roster">Activity Roster</option>
          </Select>
        )}
      </Field>

      <Field label="Sort">
        {(controlProps) => (
          <Select
            {...controlProps}
            value={sortType}
            onChange={(e) => setSortType(e.target.value as SortType)}
            disabled={reportType === "activity_summary"}
          >
            <option value="name_asc">Last Name A–Z</option>
            <option value="name_desc">Last Name Z–A</option>
            <option value="site_asc">Site 0–9 / A–Z</option>
            <option value="site_desc">Site 9–0 / Z–A</option>
          </Select>
        )}
      </Field>

      <Field label="Registration Type">
        {(controlProps) => (
          <Select
            {...controlProps}
            value={participantTypeFilter}
            onChange={(e) =>
              setParticipantTypeFilter(e.target.value as ParticipantTypeFilter)
            }
          >
            <option value="all">All Types</option>
            <option value="attendee">Attendee</option>
            <option value="vendor">Vendor</option>
            <option value="staff">Staff</option>
            <option value="speaker">Speaker</option>
            <option value="volunteer">Volunteer</option>
            <option value="event_host">Event Host</option>
          </Select>
        )}
      </Field>

      <Field label="Data Status">
        {(controlProps) => (
          <Select
            {...controlProps}
            value={dataStatusFilter}
            onChange={(e) =>
              setDataStatusFilter(e.target.value as DataStatusFilter)
            }
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="corrected">Corrected</option>
            <option value="reviewed">Reviewed</option>
            <option value="locked">Locked</option>
          </Select>
        )}
      </Field>

      <Field label="Report Pack">
        {(controlProps) => (
          <Select
            {...controlProps}
            value={reportPackType}
            onChange={(e) =>
              setReportPackType(
                e.target.value as
                  | "parking_ops"
                  | "checkin_ops"
                  | "hospitality_ops",
              )
            }
          >
            <option value="parking_ops">Parking Operations Pack</option>
            <option value="checkin_ops">Check-In Pack</option>
            <option value="hospitality_ops">Hospitality Pack</option>
          </Select>
        )}
      </Field>

      <FormActions>
        <AppButton onClick={onExportCsv} disabled={loading || !canExport}>
          Export CSV
        </AppButton>

        <AppButton variant="primary" onClick={onExportXlsx} disabled={loading || !canExport}>
          Export XLSX
        </AppButton>

        <AppButton onClick={() => window.print()}>Print</AppButton>

        <AppButton onClick={onPrintPack} disabled={loading}>
          Print Pack
        </AppButton>
      </FormActions>

      <Field label="Preset Name">
        {(controlProps) => (
          <Input
            {...controlProps}
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="Save current report settings"
          />
        )}
      </Field>

      <FormActions>
        <AppButton onClick={onSavePreset} disabled={loading}>
          Save Preset
        </AppButton>
      </FormActions>
    </div>
  );
}
