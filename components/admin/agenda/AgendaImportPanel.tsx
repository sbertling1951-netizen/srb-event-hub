"use client";

import { Alert } from "@/components/ui/Alert";
import { Field, Input } from "@/components/ui/Field";
import { PageSection } from "@/components/ui/PageSection";

type EventSummary = {
  name?: string | null;
};

type Props = {
  agendaMode: string;
  activeEvent: EventSummary | null;
  importBusy: boolean;
  hasActiveRun: boolean;
  activeRunCheckPending: boolean;
  importStatus: string;
  onImportFile: (file: File) => Promise<void>;
};

export default function AgendaImportPanel({
  agendaMode,
  activeEvent,
  importBusy,
  hasActiveRun,
  activeRunCheckPending,
  importStatus,
  onImportFile,
}: Props) {
  if (agendaMode !== "import") {
    return null;
  }

  return (
    <PageSection title="Import Agenda" titleStyle={{ margin: 0 }}>
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <p className="app-subtle-text" style={{ margin: 0 }}>
          Import CSV or XLSX agenda rows into the selected admin working event.
        </p>

        <Alert tone="neutral">
          Admin working event: {activeEvent?.name || "No selected event"} --
          agenda imports go into this event only.
        </Alert>

        <div>
          <div style={{ fontWeight: "var(--font-weight-semibold)" as unknown as number, marginBottom: 8 }}>
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

          <p className="app-subtle-text" style={{ marginTop: 12 }}>
            <strong>Preferred columns:</strong> Title, Description, Location,
            Speaker, Agenda Date, Start Time, End Time, Category, Color,
            Published, Sort Order.
          </p>

          <p className="app-subtle-text" style={{ marginTop: 12 }}>
            <strong>Date and time entry:</strong> Use ordinary US dates such as
            11/4/26, 11/04/2026, or 11/4 (the selected Event supplies the year).
            Times may be entered as 9 AM, 1:00 PM, 900, 1300, or HH:MM.
            EpicentraX normalizes accepted values before staging.
          </p>
        </div>

        <Field label="Upload File" help="Accepted formats: CSV and XLSX.">
          {(controlProps) => (
            <Input
              {...controlProps}
              type="file"
              accept=".csv,.xlsx,.xls"
              disabled={
                importBusy || hasActiveRun || activeRunCheckPending || !activeEvent
              }
              onChange={(e) => {
                const file = e.target.files?.[0];

                if (file) {
                  void onImportFile(file);
                }
              }}
            />
          )}
        </Field>

        {hasActiveRun ? (
          <Alert tone="info">
            An Agenda import run is already open for this Event. Resume and complete it before uploading another file.
          </Alert>
        ) : activeRunCheckPending ? (
          <Alert tone="neutral">
            Checking this Event for an existing Agenda import run before enabling upload.
          </Alert>
        ) : null}

        <Alert tone="neutral">{importStatus}</Alert>
      </div>
    </PageSection>
  );
}
