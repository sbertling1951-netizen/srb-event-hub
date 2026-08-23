// Bounded, admin-readable Agenda import message vocabulary, shared by
// AgendaImportReviewWorkspace and AgendaEditRowDialog (kept in lib/ rather
// than either component so neither has to import from the other).

import type { AgendaImportIssueCode } from "@/lib/agendaImportContract";

const VALIDATION_MESSAGES: Record<AgendaImportIssueCode, string> = {
  missing_agenda_title:
    "Title is missing. Add it to the source row, then upload a new import run.",
  missing_agenda_date:
    "Agenda Date is missing. Add it to the source row, then upload a new import run.",
  invalid_agenda_date:
    "Agenda Date is not a valid calendar date. Correct the source row, then upload a new import run.",
  missing_agenda_start_time:
    "Start Time is missing. Add it to the source row, then upload a new import run.",
  invalid_agenda_start_time:
    "Start Time is not valid. Correct the source row, then upload a new import run.",
  invalid_agenda_end_time:
    "End Time is not valid. Correct the source row, then upload a new import run.",
  invalid_agenda_sort_order:
    "Sort Order must be a whole number of zero or greater. Correct the source row, then upload a new import run.",
  duplicate_agenda_external_id_in_file:
    "All rows with this same title, date, and start time are blocked. No duplicate was selected as a winner. Correct or remove every duplicate in the source file, then upload a new import run.",
};

const COMMIT_FAILURE_MESSAGES: Record<string, string> = {
  agenda_commit_failed:
    "The Agenda import did not complete. Review the run and retry when the underlying issue is resolved.",
  agenda_commit_denied:
    "The Agenda import was denied by its authority or Event lifecycle boundary.",
  agenda_commit_conflict:
    "The Agenda import encountered a governed data conflict. Review the current Agenda before retrying.",
  agenda_commit_unavailable:
    "The Agenda import service was unavailable. The batch was rolled back and can be retried.",
  agenda_commit_stale_version:
    "The Agenda changed after this import was staged. This run cannot overwrite newer Agenda data; skip its remaining open rows and start a new import from the current Agenda version.",
};

export function describeAgendaValidationIssue(code: string): string {
  return (
    VALIDATION_MESSAGES[code as AgendaImportIssueCode] ||
    "This row did not pass Agenda import validation. Correct the source row, then upload a new import run."
  );
}

export function describeAgendaCommitFailure(code: string | null): string {
  if (!code) {
    return "The Agenda import did not complete. Review the run before retrying.";
  }
  return (
    COMMIT_FAILURE_MESSAGES[code] ||
    "The Agenda import did not complete. The batch was rolled back; review the run before retrying."
  );
}
