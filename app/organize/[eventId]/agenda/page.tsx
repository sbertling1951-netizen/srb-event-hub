"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  emptyOrganizerAgendaItem,
  OrganizerAgendaItemFields,
  organizerAgendaItemValues,
} from "@/components/organize/OrganizerAgendaItemFields";
import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import {
  createMyPrivateDraftAgendaItem,
  deleteMyPrivateDraftAgendaItem,
  getMyPrivateDraftAgenda,
  type OrganizerAgendaItem,
  organizerAgendaItemError,
  type OrganizerAgendaItemInput,
  updateMyPrivateDraftAgendaItem,
} from "@/lib/organizerAgenda";
import { getMyPrivateEventDraft, type OrganizerDraft } from "@/lib/organizerDrafts";
import { supabase } from "@/lib/supabase";

type AgendaPageProps = { params: Promise<{ eventId: string }> };
type LoadState = "checking" | "denied" | "missing" | "error" | "ready";

function itemSchedule(item: OrganizerAgendaItem) {
  const time = [item.startTime, item.endTime]
    .filter(Boolean)
    .map((value) => (value ?? "").slice(0, 5))
    .join("–");
  return [item.agendaDate, time].filter(Boolean).join(" · ") || "No date set";
}

const STALE_MESSAGE =
  "This agenda changed somewhere else since you opened it. Your change was not saved. Refresh this page to load the latest agenda, then try again.";

export default function OrganizerAgendaPage({ params }: AgendaPageProps) {
  const [eventId, setEventId] = useState<string>("");
  const [draft, setDraft] = useState<OrganizerDraft | null>(null);
  const [state, setState] = useState<LoadState>("checking");

  const [version, setVersion] = useState(0);
  const [items, setItems] = useState<OrganizerAgendaItem[]>([]);
  const [stale, setStale] = useState(false);

  const [addForm, setAddForm] = useState<OrganizerAgendaItemInput>(emptyOrganizerAgendaItem());
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<OrganizerAgendaItemInput | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const loadAgenda = useCallback(async (id: string) => {
    const agenda = await getMyPrivateDraftAgenda(supabase, id);
    setVersion(agenda.version);
    setItems(agenda.items);
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
        await loadAgenda(id);
        setState("ready");
      } catch {
        setState("error");
      }
    },
    [loadAgenda],
  );

  useEffect(() => {
    void params.then(({ eventId: resolved }) => {
      setEventId(resolved);
      void load(resolved);
    });
  }, [load, params]);

  async function refresh() {
    setStale(false);
    setRowError(null);
    try {
      await loadAgenda(eventId);
    } catch {
      setState("error");
    }
  }

  async function submitAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = organizerAgendaItemError(addForm);
    if (validationError || adding) {
      setAddError(validationError);
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const result = await createMyPrivateDraftAgendaItem(supabase, { eventId, values: addForm });
      setVersion(result.version);
      setItems((current) => [...current, result.item]);
      setAddForm(emptyOrganizerAgendaItem());
      setAddOpen(false);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "We could not add that agenda item.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(item: OrganizerAgendaItem) {
    setEditingId(item.id);
    setEditForm(organizerAgendaItemValues(item));
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
    const validationError = organizerAgendaItemError(editForm);
    if (validationError || savingId) {
      setEditError(validationError);
      return;
    }
    setSavingId(editingId);
    setEditError(null);
    try {
      const result = await updateMyPrivateDraftAgendaItem(supabase, {
        eventId,
        itemId: editingId,
        expectedVersion: version,
        values: editForm,
      });
      if (result.status === "stale") {
        setStale(true);
        return;
      }
      setVersion(result.version);
      setItems((current) => current.map((item) => (item.id === result.item.id ? result.item : item)));
      cancelEdit();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "We could not save that agenda item.");
    } finally {
      setSavingId(null);
    }
  }

  async function removeItem(item: OrganizerAgendaItem) {
    if (deletingId) {
      return;
    }
    setDeletingId(item.id);
    setRowError(null);
    try {
      const result = await deleteMyPrivateDraftAgendaItem(supabase, {
        eventId,
        itemId: item.id,
        expectedVersion: version,
      });
      if (result.status === "stale") {
        setStale(true);
        return;
      }
      setVersion(result.version);
      setItems((current) => current.filter((existing) => existing.id !== item.id));
    } catch (error) {
      setRowError(error instanceof Error ? error.message : "We could not delete that agenda item.");
    } finally {
      setDeletingId(null);
    }
  }

  if (state === "checking") {
    return <Page><Alert tone="info">Opening your private draft agenda…</Alert></Page>;
  }
  if (state === "denied") {
    return <Page><Alert tone="warning">Sign in with a verified EpicentraX account to plan an agenda.</Alert><p><Link href="/organize">Return to your events</Link></p></Page>;
  }
  if (state === "missing" || !draft) {
    return <Page><Alert tone="warning">This private draft is unavailable. It may belong to a different organizer account.</Alert><p><Link href="/organize">Return to your events</Link></p></Page>;
  }
  if (state === "error") {
    return <Page><Alert tone="danger">We could not open this agenda. Please return to your event and try again.</Alert><p><Link href={`/organize/${encodeURIComponent(eventId)}`}>Back to this event</Link></p></Page>;
  }

  return (
    <Page style={{ maxWidth: 860, margin: "0 auto", display: "grid", gap: 16 }}>
      <PageHeader
        title="Agenda"
        headingLevel="h1"
        description={`Planning for “${draft.event_name}” — a private draft.`}
      />
      <Alert tone="warning">
        Private draft — not live. This agenda is only visible to you. Guests cannot see, join, or be invited to this Event, and nothing here is published.
      </Alert>

      {stale ? (
        <Alert tone="warning" action={<AppButton onClick={() => void refresh()}>Refresh agenda</AppButton>}>
          {STALE_MESSAGE}
        </Alert>
      ) : null}
      {rowError ? <Alert tone="danger">{rowError}</Alert> : null}

      <PageSection title="Agenda items" variant="section">
        {items.length === 0 ? (
          <Alert tone="neutral">No agenda items yet. Add the first one below.</Alert>
        ) : (
          <ul style={{ display: "grid", gap: 10, listStyle: "none", margin: 0, padding: 0 }}>
            {items.map((item) => (
              <li key={item.id} className="card" style={{ display: "grid", gap: 8 }}>
                {editingId === item.id && editForm ? (
                  <form onSubmit={submitEdit} style={{ display: "grid", gap: 12 }}>
                    {editError ? <Alert tone="danger">{editError}</Alert> : null}
                    <OrganizerAgendaItemFields values={editForm} onChange={setEditForm} />
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <AppButton type="submit" variant="primary" loading={savingId === item.id}>Save changes</AppButton>
                      <AppButton type="button" onClick={cancelEdit} disabled={savingId === item.id}>Cancel</AppButton>
                    </div>
                  </form>
                ) : (
                  <>
                    <strong>{item.title}</strong>
                    <span style={{ color: "var(--color-text-muted, #475569)" }}>{itemSchedule(item)}</span>
                    {item.location ? <span>Location: {item.location}</span> : null}
                    {item.speaker ? <span>Speaker: {item.speaker}</span> : null}
                    {item.description ? <p style={{ margin: 0 }}>{item.description}</p> : null}
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <AppButton onClick={() => startEdit(item)}>Edit</AppButton>
                      <AppButton
                        variant="danger"
                        loading={deletingId === item.id}
                        onClick={() => void removeItem(item)}
                      >
                        Delete
                      </AppButton>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection title="Add an agenda item" variant="card">
        {addOpen ? (
          <form onSubmit={submitAdd} style={{ display: "grid", gap: 12 }}>
            {addError ? <Alert tone="danger">{addError}</Alert> : null}
            <OrganizerAgendaItemFields values={addForm} onChange={setAddForm} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <AppButton type="submit" variant="primary" loading={adding}>Add agenda item</AppButton>
              <AppButton
                type="button"
                onClick={() => {
                  setAddOpen(false);
                  setAddForm(emptyOrganizerAgendaItem());
                  setAddError(null);
                }}
                disabled={adding}
              >
                Cancel
              </AppButton>
            </div>
          </form>
        ) : (
          <AppButton onClick={() => setAddOpen(true)}>Add an agenda item</AppButton>
        )}
      </PageSection>

      <p><Link href={`/organize/${encodeURIComponent(eventId)}`}>Back to this event</Link></p>
    </Page>
  );
}
