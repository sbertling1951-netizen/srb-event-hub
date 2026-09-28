"use client";

import { useRef, useState } from "react";

import { AppButton } from "@/components/ui/AppButton";
import { Field, Input } from "@/components/ui/Field";
import { supabase } from "@/lib/supabase";

import type { AttendeeRow } from "./attendeesWorkflow";
import { cancellationDateInput, parseCancellationDate } from "./cancellationDate";

export function AttendeeCancellationDate({ attendee, canEdit, onSaved }: {
  attendee: AttendeeRow;
  canEdit: boolean;
  onSaved: (attendeeId: string, cancelledAt: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => cancellationDateInput(attendee.cancelled_at));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  async function save() {
    if (!canEdit || busy.current) {return;}
    setError(null);
    try {
      const date = parseCancellationDate(value);
      busy.current = true;
      setSaving(true);
      const { data, error: rpcError } = await supabase.rpc("correct_attendee_cancellation_date", {
        p_attendee_id: attendee.id,
        p_expected_cancelled_at: attendee.cancelled_at ?? null,
        p_cancelled_at: date,
      });
      if (rpcError) {throw rpcError;}
      const result = Array.isArray(data) ? data[0] : data;
      if (result?.attendee_id !== attendee.id || !result?.cancelled_at ||
          !Number.isFinite(new Date(result.cancelled_at).getTime())) {
        throw new Error("invalid_result");
      }
      onSaved(attendee.id, result.cancelled_at);
      setEditing(false);
    } catch (cause) {
      const message = cause && typeof cause === "object" && "message" in cause
        ? String(cause.message) : "";
      setError(message.startsWith("Enter ") || message.startsWith("The cancellation date")
        ? message
        : message.includes("cancellation_date_conflict")
          ? "This cancellation changed elsewhere. Close this record and refresh the attendee list before editing again."
          : message.includes("registration_not_cancelled")
            ? "This registration is no longer cancelled. Refresh the attendee list."
            : "Could not save the cancellation date. Check your access and try again.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  if (attendee.registration_status !== "cancelled") {return null;}
  return <section aria-label="Cancellation details" style={{ marginTop: 12 }}>
    <strong>Cancellation date</strong>
    <div>{attendee.cancelled_at ? new Date(attendee.cancelled_at).toLocaleString() : "Not recorded"}</div>
    {attendee.cancellation_reason ? <div>{attendee.cancellation_reason}</div> : null}
    {editing ? <>
      <Field label="Cancellation date and time" required disabled={saving}
        help="Shown in this browser’s local time. This corrects the date only; the registration stays cancelled.">
        {(inputProps) => <Input {...inputProps} type="datetime-local" value={value}
          onChange={(event) => setValue(event.target.value)} />}
      </Field>
      <AppButton onClick={() => void save()} disabled={saving || !canEdit ||
        value === cancellationDateInput(attendee.cancelled_at)}>
        {saving ? "Saving…" : "Save cancellation date"}
      </AppButton>
      <AppButton disabled={saving} onClick={() => { setEditing(false); setError(null); }}>Cancel</AppButton>
    </> : canEdit ? <AppButton onClick={() => {
      setValue(cancellationDateInput(attendee.cancelled_at));
      setError(null);
      setEditing(true);
    }}>Edit cancellation date</AppButton> : null}
    {error ? <div role="alert">{error}</div> : null}
  </section>;
}
