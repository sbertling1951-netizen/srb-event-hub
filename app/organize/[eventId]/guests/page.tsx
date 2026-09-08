"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { OrganizerGuestFields } from "@/components/organize/OrganizerGuestFields";
import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { getMyPrivateEventDraft, type OrganizerDraft } from "@/lib/organizerDrafts";
import {
  addMyPrivateDraftPlannedGuest,
  deleteMyPrivateDraftPlannedGuest,
  emptyPlannedGuest,
  listMyPrivateDraftPlannedGuests,
  type PlannedGuest,
  plannedGuestError,
  type PlannedGuestInput,
  plannedGuestValues,
  updateMyPrivateDraftPlannedGuest,
} from "@/lib/organizerGuestList";
import { supabase } from "@/lib/supabase";

type GuestsPageProps = { params: Promise<{ eventId: string }> };
type LoadState = "checking" | "denied" | "missing" | "error" | "ready";

const PRIVACY_COPY =
  "This private guest list is visible only to you. Adding someone here does not invite them, create an account, give access, or register them.";

function guestContact(guest: PlannedGuest) {
  return [guest.email, guest.phone].filter(Boolean).join(" · ") || "No contact details";
}

export default function OrganizerGuestListPage({ params }: GuestsPageProps) {
  const [eventId, setEventId] = useState<string>("");
  const [draft, setDraft] = useState<OrganizerDraft | null>(null);
  const [state, setState] = useState<LoadState>("checking");

  const [guests, setGuests] = useState<PlannedGuest[]>([]);

  const [addForm, setAddForm] = useState<PlannedGuestInput>(emptyPlannedGuest());
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PlannedGuestInput | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const loadGuests = useCallback(async (id: string) => {
    setGuests(await listMyPrivateDraftPlannedGuests(supabase, id));
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
        await loadGuests(id);
        setState("ready");
      } catch {
        setState("error");
      }
    },
    [loadGuests],
  );

  useEffect(() => {
    void params.then(({ eventId: resolved }) => {
      setEventId(resolved);
      void load(resolved);
    });
  }, [load, params]);

  async function submitAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = plannedGuestError(addForm);
    if (validationError || adding) {
      setAddError(validationError);
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const guest = await addMyPrivateDraftPlannedGuest(supabase, { eventId, values: addForm });
      setGuests((current) => [...current, guest]);
      setAddForm(emptyPlannedGuest());
      setAddOpen(false);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "We could not add that guest.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(guest: PlannedGuest) {
    setEditingId(guest.id);
    setEditForm(plannedGuestValues(guest));
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
    const validationError = plannedGuestError(editForm);
    if (validationError || savingId) {
      setEditError(validationError);
      return;
    }
    setSavingId(editingId);
    setEditError(null);
    try {
      const guest = await updateMyPrivateDraftPlannedGuest(supabase, {
        eventId,
        guestId: editingId,
        values: editForm,
      });
      setGuests((current) => current.map((existing) => (existing.id === guest.id ? guest : existing)));
      cancelEdit();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "We could not save that guest.");
    } finally {
      setSavingId(null);
    }
  }

  async function removeGuest(guest: PlannedGuest) {
    if (deletingId) {
      return;
    }
    setDeletingId(guest.id);
    setRowError(null);
    try {
      await deleteMyPrivateDraftPlannedGuest(supabase, { eventId, guestId: guest.id });
      setGuests((current) => current.filter((existing) => existing.id !== guest.id));
    } catch (error) {
      setRowError(error instanceof Error ? error.message : "We could not remove that guest.");
    } finally {
      setDeletingId(null);
    }
  }

  if (state === "checking") {
    return <Page><Alert tone="info">Opening your private guest list…</Alert></Page>;
  }
  if (state === "denied") {
    return <Page><Alert tone="warning">Sign in with a verified EpicentraX account to plan a guest list.</Alert><p><Link href="/organize">Return to your events</Link></p></Page>;
  }
  if (state === "missing" || !draft) {
    return <Page><Alert tone="warning">This private draft is unavailable. It may belong to a different organizer account.</Alert><p><Link href="/organize">Return to your events</Link></p></Page>;
  }
  if (state === "error") {
    return <Page><Alert tone="danger">We could not open this guest list. Please return to your event and try again.</Alert><p><Link href={`/organize/${encodeURIComponent(eventId)}`}>Back to this event</Link></p></Page>;
  }

  return (
    <Page style={{ maxWidth: 860, margin: "0 auto", display: "grid", gap: 16 }}>
      <PageHeader
        title="Guest list"
        headingLevel="h1"
        description={`Planning for “${draft.event_name}” — a private draft.`}
      />
      <Alert tone="warning">{PRIVACY_COPY}</Alert>

      {rowError ? <Alert tone="danger">{rowError}</Alert> : null}

      <PageSection title="Planned guests" variant="section">
        {guests.length === 0 ? (
          <Alert tone="neutral">No planned guests yet. Add the first one below.</Alert>
        ) : (
          <ul style={{ display: "grid", gap: 10, listStyle: "none", margin: 0, padding: 0 }}>
            {guests.map((guest) => (
              <li key={guest.id} className="card" style={{ display: "grid", gap: 8 }}>
                {editingId === guest.id && editForm ? (
                  <form onSubmit={submitEdit} style={{ display: "grid", gap: 12 }}>
                    {editError ? <Alert tone="danger">{editError}</Alert> : null}
                    <OrganizerGuestFields values={editForm} onChange={setEditForm} />
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <AppButton type="submit" variant="primary" loading={savingId === guest.id}>Save changes</AppButton>
                      <AppButton type="button" onClick={cancelEdit} disabled={savingId === guest.id}>Cancel</AppButton>
                    </div>
                  </form>
                ) : (
                  <>
                    <strong>{guest.displayName}</strong>
                    <span style={{ color: "var(--color-text-muted, #475569)" }}>{guestContact(guest)}</span>
                    {guest.organizerNote ? <p style={{ margin: 0 }}>Note: {guest.organizerNote}</p> : null}
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <AppButton onClick={() => startEdit(guest)}>Edit</AppButton>
                      <AppButton
                        variant="danger"
                        loading={deletingId === guest.id}
                        onClick={() => void removeGuest(guest)}
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

      <PageSection title="Add a guest" variant="card">
        {addOpen ? (
          <form onSubmit={submitAdd} style={{ display: "grid", gap: 12 }}>
            {addError ? <Alert tone="danger">{addError}</Alert> : null}
            <OrganizerGuestFields values={addForm} onChange={setAddForm} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <AppButton type="submit" variant="primary" loading={adding}>Add guest</AppButton>
              <AppButton
                type="button"
                onClick={() => {
                  setAddOpen(false);
                  setAddForm(emptyPlannedGuest());
                  setAddError(null);
                }}
                disabled={adding}
              >
                Cancel
              </AppButton>
            </div>
          </form>
        ) : (
          <AppButton onClick={() => setAddOpen(true)}>Add a guest</AppButton>
        )}
      </PageSection>

      <p><Link href={`/organize/${encodeURIComponent(eventId)}`}>Back to this event</Link></p>
    </Page>
  );
}
