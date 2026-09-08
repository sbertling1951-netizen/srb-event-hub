"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { OrganizerVenuePlanFields } from "@/components/organize/OrganizerVenuePlanFields";
import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { getMyPrivateEventDraft, type OrganizerDraft } from "@/lib/organizerDrafts";
import {
  addMyPrivateDraftVenuePlan,
  deleteMyPrivateDraftVenuePlan,
  emptyVenuePlan,
  listMyPrivateDraftVenuePlans,
  updateMyPrivateDraftVenuePlan,
  VENUE_PLAN_STATUS_LABELS,
  type VenuePlanEntry,
  venuePlanError,
  type VenuePlanInput,
  venuePlanValues,
} from "@/lib/organizerVenuePlan";
import { supabase } from "@/lib/supabase";

type VenuesPageProps = { params: Promise<{ eventId: string }> };
type LoadState = "checking" | "denied" | "missing" | "error" | "ready";

const PRIVACY_COPY =
  "This place plan is visible only to you. Nothing here contacts a place, holds a date, or books anything.";

const LOCATION_COPY =
  "Marking a place “Selected” is just a note to yourself. It does not set this Event’s location — you do that on the event details screen when you are ready.";

function planContact(entry: VenuePlanEntry) {
  return [
    entry.contactName ? `Contact: ${entry.contactName}` : null,
    entry.contactPhone ? `Phone: ${entry.contactPhone}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function OrganizerVenuePlanPage({ params }: VenuesPageProps) {
  const [eventId, setEventId] = useState<string>("");
  const [draft, setDraft] = useState<OrganizerDraft | null>(null);
  const [state, setState] = useState<LoadState>("checking");

  const [entries, setEntries] = useState<VenuePlanEntry[]>([]);

  const [addForm, setAddForm] = useState<VenuePlanInput>(emptyVenuePlan());
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<VenuePlanInput | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const loadEntries = useCallback(async (id: string) => {
    setEntries(await listMyPrivateDraftVenuePlans(supabase, id));
  }, []);

  const load = useCallback(
    async (id: string) => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user || !user.email_confirmed_at) {
        setState("denied");
        return;
      }
      try {
        const ownedDraft = await getMyPrivateEventDraft(supabase, id);
        if (!ownedDraft) {
          setState("missing");
          return;
        }
        setDraft(ownedDraft);
        await loadEntries(id);
        setState("ready");
      } catch {
        setState("error");
      }
    },
    [loadEntries],
  );

  useEffect(() => {
    void params.then(({ eventId: resolved }) => {
      setEventId(resolved);
      void load(resolved);
    });
  }, [load, params]);

  async function submitAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = venuePlanError(addForm);
    if (validationError || adding) {
      setAddError(validationError);
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const entry = await addMyPrivateDraftVenuePlan(supabase, { eventId, values: addForm });
      setEntries((current) => [...current, entry]);
      setAddForm(emptyVenuePlan());
      setAddOpen(false);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "We could not add that place.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(entry: VenuePlanEntry) {
    setEditingId(entry.id);
    setEditForm(venuePlanValues(entry));
    setEditError(null);
    setRowError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
    setEditError(null);
  }

  async function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId || !editForm) {
      return;
    }
    const validationError = venuePlanError(editForm);
    if (validationError || savingId) {
      setEditError(validationError);
      return;
    }
    setSavingId(editingId);
    setEditError(null);
    try {
      const entry = await updateMyPrivateDraftVenuePlan(supabase, {
        eventId,
        venuePlanId: editingId,
        values: editForm,
      });
      setEntries((current) => current.map((existing) => (existing.id === entry.id ? entry : existing)));
      cancelEdit();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "We could not save that place.");
    } finally {
      setSavingId(null);
    }
  }

  async function removeEntry(entry: VenuePlanEntry) {
    if (deletingId) {
      return;
    }
    setDeletingId(entry.id);
    setRowError(null);
    try {
      await deleteMyPrivateDraftVenuePlan(supabase, { eventId, venuePlanId: entry.id });
      setEntries((current) => current.filter((existing) => existing.id !== entry.id));
    } catch (error) {
      setRowError(error instanceof Error ? error.message : "We could not remove that place.");
    } finally {
      setDeletingId(null);
    }
  }

  if (state === "checking") {
    return <Page><Alert tone="info">Opening your place plan…</Alert></Page>;
  }
  if (state === "denied") {
    return <Page><Alert tone="warning">Sign in with a verified EpicentraX account to plan places.</Alert><p><Link href="/organize">Return to your events</Link></p></Page>;
  }
  if (state === "missing" || !draft) {
    return <Page><Alert tone="warning">This private draft is unavailable. It may belong to a different organizer account.</Alert><p><Link href="/organize">Return to your events</Link></p></Page>;
  }
  if (state === "error") {
    return <Page><Alert tone="danger">We could not open this place plan. Please return to your event and try again.</Alert><p><Link href={`/organize/${encodeURIComponent(eventId)}`}>Back to this event</Link></p></Page>;
  }

  return (
    <Page style={{ maxWidth: 860, margin: "0 auto", display: "grid", gap: 16 }}>
      <PageHeader
        title="Place plan"
        headingLevel="h1"
        description={`Planning for “${draft.event_name}” — a private draft.`}
      />
      <Alert tone="warning">{PRIVACY_COPY}</Alert>
      <Alert tone="info">{LOCATION_COPY}</Alert>

      {rowError ? <Alert tone="danger">{rowError}</Alert> : null}

      <PageSection title="Places you are considering" variant="section">
        {entries.length === 0 ? (
          <Alert tone="neutral">Nothing here yet. Add the first place below.</Alert>
        ) : (
          <ul style={{ display: "grid", gap: 10, listStyle: "none", margin: 0, padding: 0 }}>
            {entries.map((entry) => (
              <li key={entry.id} className="card" style={{ display: "grid", gap: 8 }}>
                {editingId === entry.id && editForm ? (
                  <form onSubmit={submitEdit} style={{ display: "grid", gap: 12 }}>
                    {editError ? <Alert tone="danger">{editError}</Alert> : null}
                    <OrganizerVenuePlanFields values={editForm} onChange={setEditForm} />
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <AppButton type="submit" variant="primary" loading={savingId === entry.id}>Save changes</AppButton>
                      <AppButton type="button" onClick={cancelEdit} disabled={savingId === entry.id}>Cancel</AppButton>
                    </div>
                  </form>
                ) : (
                  <>
                    <strong>{entry.placeName}</strong>
                    <span style={{ color: "var(--color-text-muted, #475569)" }}>
                      {VENUE_PLAN_STATUS_LABELS[entry.planningStatus]}
                      {entry.website ? ` · ${entry.website}` : ""}
                    </span>
                    {entry.locationDescription ? (
                      <span style={{ color: "var(--color-text-muted, #475569)" }}>{entry.locationDescription}</span>
                    ) : null}
                    {planContact(entry) ? (
                      <span style={{ color: "var(--color-text-muted, #475569)" }}>{planContact(entry)}</span>
                    ) : null}
                    {entry.organizerNote ? <p style={{ margin: 0 }}>Note: {entry.organizerNote}</p> : null}
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <AppButton onClick={() => startEdit(entry)}>Edit</AppButton>
                      <AppButton
                        variant="danger"
                        loading={deletingId === entry.id}
                        onClick={() => void removeEntry(entry)}
                      >
                        Remove
                      </AppButton>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection title="Add a place" variant="card">
        {addOpen ? (
          <form onSubmit={submitAdd} style={{ display: "grid", gap: 12 }}>
            {addError ? <Alert tone="danger">{addError}</Alert> : null}
            <OrganizerVenuePlanFields values={addForm} onChange={setAddForm} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <AppButton type="submit" variant="primary" loading={adding}>Add place</AppButton>
              <AppButton
                type="button"
                onClick={() => {
                  setAddOpen(false);
                  setAddForm(emptyVenuePlan());
                  setAddError(null);
                }}
                disabled={adding}
              >
                Cancel
              </AppButton>
            </div>
          </form>
        ) : (
          <AppButton onClick={() => setAddOpen(true)}>Add a place</AppButton>
        )}
      </PageSection>

      <p><Link href={`/organize/${encodeURIComponent(eventId)}`}>Back to this event</Link></p>
    </Page>
  );
}
