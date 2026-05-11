"use client";

type EventSummary = {
  name?: string | null;
};

type Props = {
  agendaMode: string;
  activeEvent: EventSummary | null;
  importBusy: boolean;
  importStatus: string;
  onImportFile: (file: File) => Promise<void>;
};

export default function AgendaImportPanel({
  agendaMode,
  activeEvent,
  importBusy,
  importStatus,
  onImportFile,
}: Props) {
  if (agendaMode !== "import") {
    return null;
  }

  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 10,
        background: "white",
        padding: 16,
        display: "grid",
        gap: 14,
        marginBottom: 20,
        maxWidth: 840,
      }}
    >
      <div>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>
          Import Agenda
        </div>

        <div style={{ fontSize: 14, color: "#555" }}>
          Import CSV or XLSX agenda rows into the selected admin working event.
        </div>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          Admin working event: {activeEvent?.name || "No selected event"}
        </div>

        <div style={{ fontSize: 13, color: "#666" }}>
          Agenda imports go into this selected admin working event only.
        </div>
      </div>

      <div>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>
          Agenda Import Templates
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <a href="/templates/agenda/agenda_import_template_blank_with_speaker.xlsx">
            Download blank XLSX template
          </a>

          <a href="/templates/agenda/agenda_import_template_blank_with_speaker.csv">
            Download blank CSV template
          </a>

          <a href="/templates/agenda/agenda_import_template_sample_with_speaker.xlsx">
            Download sample XLSX template
          </a>

          <a href="/templates/agenda/agenda_import_template_sample_with_speaker.csv">
            Download sample CSV template
          </a>

          <a href="/templates/agenda/agenda_import_template_notes_with_speaker.txt">
            Download template notes / instructions
          </a>
        </div>

        <div style={{ marginTop: 12, fontSize: 13, color: "#666" }}>
          <strong>Preferred columns:</strong> Title, Description, Location,
          Speaker, Agenda Date, Start Time, End Time, Category, Color,
          Published, Sort Order.
        </div>
      </div>

      <div>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Upload file</div>

        <div style={{ fontSize: 14, color: "#555", marginBottom: 10 }}>
          Accepted formats: CSV and XLSX.
        </div>

        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          disabled={importBusy || !activeEvent}
          onChange={(e) => {
            const file = e.target.files?.[0];

            if (file) {
              void onImportFile(file);
            }
          }}
        />
      </div>

      <div>
        <strong>Status:</strong> {importStatus}
      </div>
    </div>
  );
}
