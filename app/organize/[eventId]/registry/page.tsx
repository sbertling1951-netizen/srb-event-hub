"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { OrganizerRegistryCatalogSelector } from "@/components/organize/OrganizerRegistryCatalogSelector";
import { OrganizerRegistryPlanFields } from "@/components/organize/OrganizerRegistryPlanFields";
import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { getMyPrivateEventDraft, type OrganizerDraft } from "@/lib/organizerDrafts";
import {
  addMyPrivateDraftRegistryPlan,
  attachMyPrivateDraftRegistryPlanCatalogSelection,
  deleteMyPrivateDraftRegistryPlan,
  detachMyPrivateDraftRegistryPlanCatalogSelection,
  emptyRegistryPlan,
  listMyPrivateDraftRegistryPlans,
  listMyPrivateDraftRegistryPlansWithCatalog,
  REGISTRY_PLAN_STATUS_LABELS,
  RegistryCatalogIdentityResolutionRequiredError,
  type RegistryPlanEntryWithCatalog,
  registryPlanError,
  type RegistryPlanInput,
  registryPlanValues,
  updateMyPrivateDraftRegistryPlan,
} from "@/lib/organizerRegistryPlan";
import { supabase } from "@/lib/supabase";

type RegistryPageProps = { params: Promise<{ eventId: string }> };
type LoadState = "checking" | "denied" | "missing" | "error" | "ready";

const PRIVACY_COPY =
  "This registry plan is visible only to you. Nothing here is shared with guests, sent to a registry, or connected to an account.";

const LINK_COPY =
  "A link you save is kept as plain text for your own reference. EpicentraX never opens it, checks it, or shows a preview of it.";

export default function OrganizerRegistryPlanPage({ params }: RegistryPageProps) {
  const [eventId, setEventId] = useState<string>("");
  const [draft, setDraft] = useState<OrganizerDraft | null>(null);
  const [state, setState] = useState<LoadState>("checking");

  const [entries, setEntries] = useState<RegistryPlanEntryWithCatalog[]>([]);
  // Catalog P2 search/attach/detach requires an exactly resolved canonical
  // Person. When that has not completed, the page falls back to the
  // ordinary (untouched) plain read so the organizer's typed entries still
  // show, and shows a neutral identity notice instead of the catalog
  // controls -- never a match detail.
  const [catalogAvailable, setCatalogAvailable] = useState(false);
  const [identityNotice, setIdentityNotice] = useState<string | null>(null);

  const [addForm, setAddForm] = useState<RegistryPlanInput>(emptyRegistryPlan());
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RegistryPlanInput | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const loadEntries = useCallback(async (id: string) => {
    try {
      const rows = await listMyPrivateDraftRegistryPlansWithCatalog(supabase, id);
      setEntries(rows);
      setCatalogAvailable(true);
      setIdentityNotice(null);
    } catch (error) {
      if (error instanceof RegistryCatalogIdentityResolutionRequiredError) {
        // The organizer's ordinary Registry Plan (untouched by Catalog P2)
        // still loads and works fully -- only the catalog controls are held
        // back.
        const plain = await listMyPrivateDraftRegistryPlans(supabase, id);
        setEntries(plain.map((entry) => ({ ...entry, catalog: null })));
        setCatalogAvailable(false);
        setIdentityNotice(error.message);
        return;
      }
      throw error;
    }
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
    const validationError = registryPlanError(addForm);
    if (validationError || adding) {
      setAddError(validationError);
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const entry = await addMyPrivateDraftRegistryPlan(supabase, { eventId, values: addForm });
      setEntries((current) => [...current, { ...entry, catalog: null }]);
      setAddForm(emptyRegistryPlan());
      setAddOpen(false);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "We could not add that registry.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(entry: RegistryPlanEntryWithCatalog) {
    setEditingId(entry.id);
    setEditForm(registryPlanValues(entry));
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
    const validationError = registryPlanError(editForm);
    if (validationError || savingId) {
      setEditError(validationError);
      return;
    }
    setSavingId(editingId);
    setEditError(null);
    try {
      const entry = await updateMyPrivateDraftRegistryPlan(supabase, {
        eventId,
        registryPlanId: editingId,
        values: editForm,
      });
      // An ordinary edit never touches the catalog attachment (Catalog P2
      // §5) -- the untouched update RPC does not return catalog fields at
      // all, so the existing local snapshot is carried over explicitly
      // rather than dropped.
      setEntries((current) =>
        current.map((existing) => (existing.id === entry.id ? { ...entry, catalog: existing.catalog } : existing)),
      );
      cancelEdit();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "We could not save that registry.");
    } finally {
      setSavingId(null);
    }
  }

  async function removeEntry(entry: RegistryPlanEntryWithCatalog) {
    if (deletingId) {
      return;
    }
    setDeletingId(entry.id);
    setRowError(null);
    try {
      await deleteMyPrivateDraftRegistryPlan(supabase, { eventId, registryPlanId: entry.id });
      setEntries((current) => current.filter((existing) => existing.id !== entry.id));
    } catch (error) {
      setRowError(error instanceof Error ? error.message : "We could not remove that registry.");
    } finally {
      setDeletingId(null);
    }
  }

  /** Attaches (or replaces) a catalog selection on one entry. Errors are
   *  handled by OrganizerRegistryCatalogSelector itself. */
  async function attachCatalog(registryPlanId: string, catalogAssetId: string) {
    const updated = await attachMyPrivateDraftRegistryPlanCatalogSelection(supabase, {
      eventId, registryPlanId, catalogAssetId,
    });
    setEntries((current) => current.map((existing) => (existing.id === updated.id ? updated : existing)));
  }

  /** Clears a catalog selection from one entry. */
  async function detachCatalog(registryPlanId: string) {
    const updated = await detachMyPrivateDraftRegistryPlanCatalogSelection(supabase, { eventId, registryPlanId });
    setEntries((current) => current.map((existing) => (existing.id === updated.id ? updated : existing)));
  }

  if (state === "checking") {
    return <Page><Alert tone="info">Opening your registry plan…</Alert></Page>;
  }
  if (state === "denied") {
    return <Page><Alert tone="warning">Sign in with a verified EpicentraX account to plan a registry.</Alert><p><Link href="/organize">Return to your events</Link></p></Page>;
  }
  if (state === "missing" || !draft) {
    return <Page><Alert tone="warning">This private draft is unavailable. It may belong to a different organizer account.</Alert><p><Link href="/organize">Return to your events</Link></p></Page>;
  }
  if (state === "error") {
    return <Page><Alert tone="danger">We could not open this registry plan. Please return to your event and try again.</Alert><p><Link href={`/organize/${encodeURIComponent(eventId)}`}>Back to this event</Link></p></Page>;
  }

  return (
    <Page style={{ maxWidth: 860, margin: "0 auto", display: "grid", gap: 16 }}>
      <PageHeader
        title="Registry plan"
        headingLevel="h1"
        description={`Planning for “${draft.event_name}” — a private draft.`}
      />
      <Alert tone="warning">{PRIVACY_COPY}</Alert>
      <Alert tone="info">{LINK_COPY}</Alert>

      {rowError ? <Alert tone="danger">{rowError}</Alert> : null}
      {identityNotice ? <Alert tone="info">{identityNotice}</Alert> : null}

      <PageSection title="Registries you are planning" variant="section">
        {entries.length === 0 ? (
          <Alert tone="neutral">Nothing here yet. Add the first registry below.</Alert>
        ) : (
          <ul style={{ display: "grid", gap: 10, listStyle: "none", margin: 0, padding: 0 }}>
            {entries.map((entry) => (
              <li key={entry.id} className="card" style={{ display: "grid", gap: 8 }}>
                {editingId === entry.id && editForm ? (
                  <form onSubmit={submitEdit} style={{ display: "grid", gap: 12 }}>
                    {editError ? <Alert tone="danger">{editError}</Alert> : null}
                    <OrganizerRegistryPlanFields values={editForm} onChange={setEditForm} />
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <AppButton type="submit" variant="primary" loading={savingId === entry.id}>Save changes</AppButton>
                      <AppButton type="button" onClick={cancelEdit} disabled={savingId === entry.id}>Cancel</AppButton>
                    </div>
                  </form>
                ) : (
                  <>
                    <strong>{entry.providerName}</strong>
                    <span style={{ color: "var(--color-text-muted, #475569)" }}>
                      {REGISTRY_PLAN_STATUS_LABELS[entry.planningStatus]}
                    </span>
                    {/*
                      Rendered as PLAIN TEXT inside a <span>, never an <a>.
                      The value is inert: it is not navigable, not previewed,
                      and not contacted.
                    */}
                    {entry.registryUrl ? (
                      <span style={{ color: "var(--color-text-muted, #475569)", wordBreak: "break-all" }}>
                        Saved link: {entry.registryUrl}
                      </span>
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
                    {catalogAvailable ? (
                      <OrganizerRegistryCatalogSelector
                        eventId={eventId}
                        attached={entry.catalog}
                        onAttach={(catalogAssetId) => attachCatalog(entry.id, catalogAssetId)}
                        onDetach={() => detachCatalog(entry.id)}
                      />
                    ) : null}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection title="Add a registry" variant="card">
        {addOpen ? (
          <form onSubmit={submitAdd} style={{ display: "grid", gap: 12 }}>
            {addError ? <Alert tone="danger">{addError}</Alert> : null}
            <OrganizerRegistryPlanFields values={addForm} onChange={setAddForm} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <AppButton type="submit" variant="primary" loading={adding}>Add registry</AppButton>
              <AppButton
                type="button"
                onClick={() => {
                  setAddOpen(false);
                  setAddForm(emptyRegistryPlan());
                  setAddError(null);
                }}
                disabled={adding}
              >
                Cancel
              </AppButton>
            </div>
          </form>
        ) : (
          <AppButton onClick={() => setAddOpen(true)}>Add a registry</AppButton>
        )}
      </PageSection>

      <p><Link href={`/organize/${encodeURIComponent(eventId)}`}>Back to this event</Link></p>
    </Page>
  );
}
