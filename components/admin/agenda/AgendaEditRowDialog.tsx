"use client";

// Agenda governed row correction: Edit Row dialog. Recomputes the corrected
// candidate with the exact same, unchanged Stage A interpreter used for
// original ingestion (lib/agendaImportContract.ts#interpretAgendaImportRow
// via lib/agendaImportOrchestration.ts#interpretAgendaCorrection) on every
// keystroke, for live friendly validation feedback, then submits the
// resulting candidate through the governed correct_agenda_import_run_row
// RPC on Save. Database governance remains authoritative -- this dialog's
// own live validation is a UX convenience, never a substitute for the
// server's own re-check.

import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { Dialog } from "@/components/ui/Dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/Field";
import type { AgendaImportEventDateContext } from "@/lib/agendaImportContract";
import { describeAgendaValidationIssue } from "@/lib/agendaImportMessages";
import {
  AGENDA_CORRECTION_REASON_OPTIONS,
  type AgendaImportCorrectionReasonCode,
  type AgendaImportRowResult,
  correctAgendaImportRow,
  getEffectiveAgendaImportCandidate,
  interpretAgendaCorrection,
} from "@/lib/agendaImportOrchestration";
import { describeLifecycleError } from "@/lib/importLifecycleOrchestration";

export type AgendaEditRowFields = {
  Title: string;
  Description: string;
  Location: string;
  Speaker: string;
  "Agenda Date": string;
  "Start Time": string;
  "End Time": string;
  Category: string;
  Color: string;
  Published: boolean;
  "Sort Order": string;
};

export type AgendaImportCategoryOption = {
  name: string;
  color: string;
};

export function resolveAgendaImportCategorySelection(
  selectedCategory: string,
  categoryOptions: readonly AgendaImportCategoryOption[],
) {
  const configuredCategory = categoryOptions.find(
    (category) => category.name === selectedCategory,
  );
  return {
    category: selectedCategory,
    color: configuredCategory?.color ?? "",
  };
}

function fieldsFromCandidate(
  candidate: AgendaImportRowResult["candidate"],
): AgendaEditRowFields {
  return {
    Title: candidate.title ?? "",
    Description: candidate.description ?? "",
    Location: candidate.location ?? "",
    Speaker: candidate.speaker ?? "",
    "Agenda Date": candidate.agenda_date ?? "",
    "Start Time": candidate.start_time ?? "",
    "End Time": candidate.end_time ?? "",
    Category: candidate.category ?? "",
    Color: candidate.color ?? "",
    Published: candidate.is_published,
    "Sort Order": candidate.sort_order === null ? "" : String(candidate.sort_order),
  };
}

export function getAgendaEditRowFields(
  row: AgendaImportRowResult,
): AgendaEditRowFields {
  return fieldsFromCandidate(getEffectiveAgendaImportCandidate(row));
}

export type AgendaEditRowDialogProps = {
  open: boolean;
  row: AgendaImportRowResult;
  eventDateContext: AgendaImportEventDateContext;
  categoryOptions: readonly AgendaImportCategoryOption[];
  onCancel: () => void;
  onSaved: (message: string) => void | Promise<void>;
  onError: (message: string) => void;
};

export function AgendaEditRowDialog({
  open,
  row,
  eventDateContext,
  categoryOptions,
  onCancel,
  onSaved,
  onError,
}: AgendaEditRowDialogProps) {
  const [fields, setFields] = useState<AgendaEditRowFields>(() =>
    getAgendaEditRowFields(row),
  );
  const [reasonCode, setReasonCode] =
    useState<AgendaImportCorrectionReasonCode>("data_entry_error");
  const [saving, setSaving] = useState(false);

  // Re-preload from the best available candidate every time this dialog is
  // (re)opened for a row -- covers both "opened for the first time" and "the
  // operator cancelled, the run refreshed, and they reopened Edit Row".
  useEffect(() => {
    if (!open) {
      return;
    }
    setFields(getAgendaEditRowFields(row));
    setReasonCode("data_entry_error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row.rowId, row.correctionRevision]);

  const interpretation = interpretAgendaCorrection(
    {
      Title: fields.Title,
      Description: fields.Description,
      Location: fields.Location,
      Speaker: fields.Speaker,
      "Agenda Date": fields["Agenda Date"],
      "Start Time": fields["Start Time"],
      "End Time": fields["End Time"],
      Category: fields.Category,
      Color: fields.Color,
      Published: fields.Published ? "Yes" : "",
      "Sort Order": fields["Sort Order"],
    },
    {
      source_row_number: row.sourceRowNumber,
      default_sort_order: row.sourceRowNumber,
      event_start_date: eventDateContext.event_start_date,
      event_end_date: eventDateContext.event_end_date,
    },
  );
  const willBeValid = interpretation.validation_state === "valid";
  const categoryIsUnresolved =
    fields.Category !== "" &&
    !categoryOptions.some((category) => category.name === fields.Category);

  function update<K extends keyof AgendaEditRowFields>(
    key: K,
    value: AgendaEditRowFields[K],
  ) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await correctAgendaImportRow({
        rowId: row.rowId,
        expectedRevision: row.correctionRevision,
        candidate: interpretation.candidate,
        validationState: interpretation.validation_state,
        issues: interpretation.issues,
        reasonCode,
      });
      await onSaved(
        result.rowState === "approved"
          ? "Correction saved. This row is now Ready to Import."
          : "Correction saved, but this row still needs attention -- see the updated validation messages below.",
      );
    } catch (err) {
      onError(describeLifecycleError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => (saving ? null : onCancel())}
      title={`Edit Source Row ${row.sourceRowNumber}`}
      description="Correct this row's Agenda fields, then save. The same human-friendly date/time input EpicentraX accepts everywhere else works here too."
      className="app-dialog-wide"
      footer={
        <>
          <AppButton onClick={onCancel} disabled={saving}>
            Cancel
          </AppButton>
          <AppButton variant="primary" loading={saving} onClick={() => void handleSave()}>
            Save Correction
          </AppButton>
        </>
      }
    >
      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        {interpretation.issues.length ? (
          <Alert tone="warning">
            <ul style={{ margin: 0, paddingLeft: "var(--space-5)" }}>
              {interpretation.issues.map((issue) => (
                <li key={issue.code}>{describeAgendaValidationIssue(issue.code)}</li>
              ))}
            </ul>
          </Alert>
        ) : (
          <Alert tone="success">
            This correction is valid and will become Ready to Import when saved.
          </Alert>
        )}

        <Field label="Title" required>
          {(controlProps) => (
            <Input
              {...controlProps}
              value={fields.Title}
              disabled={saving}
              onChange={(e) => update("Title", e.target.value)}
            />
          )}
        </Field>

        <Field label="Description">
          {(controlProps) => (
            <Input
              {...controlProps}
              value={fields.Description}
              disabled={saving}
              onChange={(e) => update("Description", e.target.value)}
            />
          )}
        </Field>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))",
            gap: "var(--space-3)",
          }}
        >
          <Field label="Location">
            {(controlProps) => (
              <Input
                {...controlProps}
                value={fields.Location}
                disabled={saving}
                onChange={(e) => update("Location", e.target.value)}
              />
            )}
          </Field>
          <Field label="Speaker">
            {(controlProps) => (
              <Input
                {...controlProps}
                value={fields.Speaker}
                disabled={saving}
                onChange={(e) => update("Speaker", e.target.value)}
              />
            )}
          </Field>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))",
            gap: "var(--space-3)",
          }}
        >
          <Field label="Agenda Date" required help="e.g. 11/4/26, 11/4, or 2026-11-04">
            {(controlProps) => (
              <Input
                {...controlProps}
                value={fields["Agenda Date"]}
                disabled={saving}
                onChange={(e) => update("Agenda Date", e.target.value)}
              />
            )}
          </Field>
          <Field label="Start Time" required help="e.g. 1:30 PM, 1300, or 900">
            {(controlProps) => (
              <Input
                {...controlProps}
                value={fields["Start Time"]}
                disabled={saving}
                onChange={(e) => update("Start Time", e.target.value)}
              />
            )}
          </Field>
          <Field label="End Time" help="Optional">
            {(controlProps) => (
              <Input
                {...controlProps}
                value={fields["End Time"]}
                disabled={saving}
                onChange={(e) => update("End Time", e.target.value)}
              />
            )}
          </Field>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))",
            gap: "var(--space-3)",
          }}
        >
          <Field
            label="Category"
            help={
              categoryIsUnresolved
                ? `Imported category “${fields.Category}” is not configured. Choose a configured category to resolve it, or leave it unchanged.`
                : "Choose from the same configured Agenda categories used by the Agenda editor."
            }
          >
            {(controlProps) => (
              <Select
                {...controlProps}
                value={fields.Category}
                disabled={saving}
                onChange={(e) => {
                  const selection = resolveAgendaImportCategorySelection(
                    e.target.value,
                    categoryOptions,
                  );
                  setFields((previous) => ({
                    ...previous,
                    Category: selection.category,
                    Color: selection.color,
                  }));
                }}
              >
                <option value="">-- Select Category --</option>
                {categoryIsUnresolved ? (
                  <option value={fields.Category}>
                    Imported: {fields.Category} (not configured)
                  </option>
                ) : null}
                {categoryOptions.map((category) => (
                  <option key={category.name} value={category.name}>
                    {category.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Category color"
            help="The selected configured category supplies this value; it is not a separate override."
          >
            {(controlProps) => (
              <Input
                {...controlProps}
                value={fields.Color}
                placeholder="No color set"
                readOnly
                aria-readonly="true"
              />
            )}
          </Field>
          <Field label="Sort Order" help="Blank uses file order">
            {(controlProps) => (
              <Input
                {...controlProps}
                inputMode="numeric"
                value={fields["Sort Order"]}
                disabled={saving}
                onChange={(e) => update("Sort Order", e.target.value)}
              />
            )}
          </Field>
        </div>

        <Checkbox
          label="Published"
          checked={fields.Published}
          disabled={saving}
          onChange={(e) => update("Published", e.target.checked)}
        />

        <Field label="Reason for this correction">
          {(controlProps) => (
            <Select
              {...controlProps}
              value={reasonCode}
              disabled={saving}
              onChange={(e) =>
                setReasonCode(e.target.value as AgendaImportCorrectionReasonCode)
              }
            >
              {AGENDA_CORRECTION_REASON_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {!willBeValid ? (
          <p className="app-subtle-text">
            You can still save this correction. It will remain in Needs Attention with
            the messages above until it passes validation.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
