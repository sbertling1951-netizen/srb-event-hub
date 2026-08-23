"use client";

// Stage: Import Run Lifecycle + History UI hookup. Import-type-agnostic
// controls over the governed 20260822170000 lifecycle RPCs
// (lib/importLifecycleOrchestration.ts), shared by the governed import
// doors rather than duplicated. This module owns no lifecycle
// rule of its own -- every transition is decided server-side; a denial
// surfaces through the caller's own error presentation via `onError`,
// using describeLifecycleError so the raw PostgrestError never reaches
// the page.
import { useState } from "react";

import { AppButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select } from "@/components/ui/Field";
import {
  abandonImportRunOpenRows,
  abandonImportRunRow,
  ABANDONMENT_REASON_OPTIONS,
  type AbandonmentReasonCode,
  closeImportRunStaging,
  describeLifecycleError,
  finalizeImportRun,
  type ImportRunLifecycleStatus,
} from "@/lib/importLifecycleOrchestration";

/**
 * The minimal shape RunLifecycleActions/AbandonRowButton need from either
 * door's own row-result type (Attendee, Vendor, or Agenda -- each already
 * carries these fields). Deliberately not importing a door-specific type
 * here, so this module stays import-type-agnostic.
 */
export type LifecycleRowLike = {
  rowId: string;
  rowState: string;
  abandonedAt: string | null;
};

/**
 * A row is eligible for abandonment client-side exactly when it is not
 * already terminal by the two ways a row becomes terminal: a committed/
 * validation_failed rowState, or a set abandonedAt overlay. This mirrors
 * (never replaces) the server's own import_row_terminal_or_retry_owned /
 * import_row_already_abandoned checks -- it only decides whether to show
 * the control, not whether the action is allowed.
 */
export function isRowAbandonEligible(row: LifecycleRowLike): boolean {
  if (row.abandonedAt) {
    return false;
  }
  return row.rowState !== "committed" && row.rowState !== "validation_failed";
}

type AbandonReasonDialogProps = {
  open: boolean;
  title: string;
  description: string;
  busy?: boolean;
  onConfirm: (reasonCode: AbandonmentReasonCode) => void | Promise<void>;
  onCancel: () => void;
};

/**
 * The shared reason-picker dialog for both a single-row abandon and a
 * run-wide abandon-open-rows. Built on the low-level `Dialog` (not
 * `ConfirmDialog`) because its body must hold a `Select`, and
 * `ConfirmDialog`'s `message` prop is a plain string.
 */
export function AbandonReasonDialog({
  open,
  title,
  description,
  busy = false,
  onConfirm,
  onCancel,
}: AbandonReasonDialogProps) {
  const [reasonCode, setReasonCode] = useState<AbandonmentReasonCode>("operator_declined");

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      footer={
        <>
          <AppButton onClick={onCancel} disabled={busy}>
            Cancel
          </AppButton>
          <AppButton variant="stop" loading={busy} onClick={() => void onConfirm(reasonCode)}>
            Abandon
          </AppButton>
        </>
      }
    >
      <Field label="Reason" required>
        {(controlProps) => (
          <Select
            {...controlProps}
            value={reasonCode}
            disabled={busy}
            onChange={(e) => setReasonCode(e.target.value as AbandonmentReasonCode)}
          >
            {ABANDONMENT_REASON_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Dialog>
  );
}

type AbandonRowButtonProps = {
  row: LifecycleRowLike;
  triggerLabel?: string;
  triggerAriaLabel?: string;
  dialogTitle?: string;
  dialogDescription?: string;
  onAbandoned: (
    rowId: string,
    overlay: { abandonedAt: string; abandonedByAuthUserId: string; abandonmentReasonCode: string },
  ) => void | Promise<void>;
  onError: (message: string) => void;
};

/**
 * Drop-in row action for a governed door's results table Action cell. Renders
 * nothing once the row is no longer eligible (the caller does not need to
 * branch on rowState itself to decide whether to render this).
 */
export function AbandonRowButton({
  row,
  triggerLabel = "Abandon",
  triggerAriaLabel,
  dialogTitle = "Abandon This Row",
  dialogDescription = "This marks the row as abandoned and it will no longer be eligible for retry or commit. This cannot be undone.",
  onAbandoned,
  onError,
}: AbandonRowButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!isRowAbandonEligible(row)) {
    return null;
  }

  async function handleConfirm(reasonCode: AbandonmentReasonCode) {
    setBusy(true);
    try {
      const result = await abandonImportRunRow(row.rowId, reasonCode);
      await onAbandoned(row.rowId, {
        abandonedAt: result.abandonedAt,
        abandonedByAuthUserId: result.abandonedByAuthUserId,
        abandonmentReasonCode: result.abandonmentReasonCode,
      });
      setOpen(false);
    } catch (err) {
      onError(describeLifecycleError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppButton
        variant="danger"
        aria-label={triggerAriaLabel}
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </AppButton>
      <AbandonReasonDialog
        open={open}
        title={dialogTitle}
        description={dialogDescription}
        busy={busy}
        onConfirm={handleConfirm}
        onCancel={() => (busy ? null : setOpen(false))}
      />
    </>
  );
}

export type RunLifecycleActionsProps = {
  runId: string;
  status: ImportRunLifecycleStatus;
  rows: LifecycleRowLike[];
  abandonAllLabel?: string;
  abandonAllDialogTitle?: string;
  abandonAllDialogDescription?: string;
  onStagingClosed: (status: ImportRunLifecycleStatus) => void | Promise<void>;
  onOpenRowsAbandoned: (
    count: number,
    reasonCode: AbandonmentReasonCode,
  ) => void | Promise<void>;
  onFinalized: (result: {
    status: ImportRunLifecycleStatus;
    finalizedAt: string | null;
    finalizedByAuthUserId: string | null;
  }) => void | Promise<void>;
  onError: (message: string) => void;
};

/**
 * The run-level lifecycle control strip: close source staging, abandon
 * every remaining open row at once, and finalize -- placed above each
 * door's own results table. Each control is only shown when the run's
 * current status makes it a legal next step; the server remains the
 * final authority regardless (a stale `status`/`rows` snapshot only
 * risks showing a control that the RPC will then deny with a bounded,
 * admin-readable error via `onError`).
 */
export function RunLifecycleActions({
  runId,
  status,
  rows,
  abandonAllLabel = "Abandon Remaining Open Rows",
  abandonAllDialogTitle = "Abandon Remaining Open Rows",
  abandonAllDialogDescription = "This marks every remaining open row in this run as abandoned. Committed and validation-failed rows are unaffected. This cannot be undone.",
  onStagingClosed,
  onOpenRowsAbandoned,
  onFinalized,
  onError,
}: RunLifecycleActionsProps) {
  const [closingStaging, setClosingStaging] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const [abandonAllOpen, setAbandonAllOpen] = useState(false);
  const [abandoningAll, setAbandoningAll] = useState(false);

  const [finalizing, setFinalizing] = useState(false);
  const [confirmFinalizeOpen, setConfirmFinalizeOpen] = useState(false);

  const hasOpenRows = rows.some(isRowAbandonEligible);
  const allRowsTerminal = !hasOpenRows;

  async function handleCloseStaging() {
    setClosingStaging(true);
    try {
      const result = await closeImportRunStaging(runId);
      await onStagingClosed(result.status);
      setConfirmCloseOpen(false);
    } catch (err) {
      onError(describeLifecycleError(err));
    } finally {
      setClosingStaging(false);
    }
  }

  async function handleAbandonAllOpenRows(reasonCode: AbandonmentReasonCode) {
    setAbandoningAll(true);
    try {
      const count = await abandonImportRunOpenRows(runId, reasonCode);
      await onOpenRowsAbandoned(count, reasonCode);
      setAbandonAllOpen(false);
    } catch (err) {
      onError(describeLifecycleError(err));
    } finally {
      setAbandoningAll(false);
    }
  }

  async function handleFinalize() {
    setFinalizing(true);
    try {
      const result = await finalizeImportRun(runId);
      await onFinalized(result);
      setConfirmFinalizeOpen(false);
    } catch (err) {
      onError(describeLifecycleError(err));
    } finally {
      setFinalizing(false);
    }
  }

  if (status === "finalized") {
    return null;
  }

  return (
    <div className="app-button-row" style={{ marginBottom: 12 }}>
      {status === "staging" ? (
        <AppButton variant="secondary" onClick={() => setConfirmCloseOpen(true)}>
          Close Source Staging
        </AppButton>
      ) : null}

      {status === "ready_for_review" && hasOpenRows ? (
        <AppButton variant="danger" onClick={() => setAbandonAllOpen(true)}>
          {abandonAllLabel}
        </AppButton>
      ) : null}

      {status === "ready_for_review" ? (
        <AppButton
          variant="primary"
          disabled={!allRowsTerminal}
          onClick={() => setConfirmFinalizeOpen(true)}
        >
          Finalize Run
        </AppButton>
      ) : null}

      <ConfirmDialog
        open={confirmCloseOpen}
        title="Close Source Staging"
        message="Close source staging for this run? No further rows may be staged from the source file after this. Rows already needing review remain reviewable."
        confirmLabel="Close Staging"
        busy={closingStaging}
        onConfirm={handleCloseStaging}
        onCancel={() => (closingStaging ? null : setConfirmCloseOpen(false))}
      />

      <AbandonReasonDialog
        open={abandonAllOpen}
        title={abandonAllDialogTitle}
        description={abandonAllDialogDescription}
        busy={abandoningAll}
        onConfirm={handleAbandonAllOpenRows}
        onCancel={() => (abandoningAll ? null : setAbandonAllOpen(false))}
      />

      <ConfirmDialog
        open={confirmFinalizeOpen}
        title="Finalize Run"
        message="Finalize this run? Every row is committed, failed validation, or abandoned. Finalizing is final -- the run becomes read-only and moves to Import History."
        confirmLabel="Finalize"
        busy={finalizing}
        onConfirm={handleFinalize}
        onCancel={() => (finalizing ? null : setConfirmFinalizeOpen(false))}
      />
    </div>
  );
}
