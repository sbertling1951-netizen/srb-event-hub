"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { OrganizerVendorPlanFields } from "@/components/organize/OrganizerVendorPlanFields";
import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { getMyPrivateEventDraft, type OrganizerDraft } from "@/lib/organizerDrafts";
import {
  addMyPrivateDraftVendorPlan,
  deleteMyPrivateDraftVendorPlan,
  emptyVendorPlan,
  listMyPrivateDraftVendorPlans,
  updateMyPrivateDraftVendorPlan,
  VENDOR_PLAN_STATUS_LABELS,
  type VendorPlanEntry,
  vendorPlanError,
  type VendorPlanInput,
  vendorPlanValues,
} from "@/lib/organizerVendorPlan";
import { supabase } from "@/lib/supabase";

type VendorsPageProps = { params: Promise<{ eventId: string }> };
type LoadState = "checking" | "denied" | "missing" | "error" | "ready";

const PRIVACY_COPY =
  "This private vendor plan is visible only to you. Adding a vendor here does not notify them, create an account, invite them, or make them part of this Event.";

function planDetails(entry: VendorPlanEntry) {
  return [entry.serviceCategory, entry.website].filter(Boolean).join(" · ") || "No other details yet";
}

/**
 * The contact line for a saved card. Contact name and phone are labelled for
 * what they are; a pre-20261002000000 free-text value is shown separately and
 * explicitly as saved-earlier text, never relabelled as a name or a number.
 */
function planContact(entry: VendorPlanEntry) {
  return [
    entry.contactName ? `Contact: ${entry.contactName}` : null,
    entry.contactPhone ? `Phone: ${entry.contactPhone}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function OrganizerVendorPlanPage({ params }: VendorsPageProps) {
  const [eventId, setEventId] = useState<string>("");
  const [draft, setDraft] = useState<OrganizerDraft | null>(null);
  const [state, setState] = useState<LoadState>("checking");

  const [entries, setEntries] = useState<VendorPlanEntry[]>([]);

  const [addForm, setAddForm] = useState<VendorPlanInput>(emptyVendorPlan());
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<VendorPlanInput | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const loadEntries = useCallback(async (id: string) => {
    setEntries(await listMyPrivateDraftVendorPlans(supabase, id));
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
    const validationError = vendorPlanError(addForm);
    if (validationError || adding) {
      setAddError(validationError);
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const entry = await addMyPrivateDraftVendorPlan(supabase, { eventId, values: addForm });
      setEntries((current) => [...current, entry]);
      setAddForm(emptyVendorPlan());
      setAddOpen(false);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "We could not add that vendor.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(entry: VendorPlanEntry) {
    setEditingId(entry.id);
    setEditForm(vendorPlanValues(entry));
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
    const validationError = vendorPlanError(editForm);
    if (validationError || savingId) {
      setEditError(validationError);
      return;
    }
    setSavingId(editingId);
    setEditError(null);
    try {
      const entry = await updateMyPrivateDraftVendorPlan(supabase, {
        eventId,
        vendorPlanId: editingId,
        values: editForm,
      });
      setEntries((current) => current.map((existing) => (existing.id === entry.id ? entry : existing)));
      cancelEdit();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "We could not save that vendor.");
    } finally {
      setSavingId(null);
    }
  }

  async function removeEntry(entry: VendorPlanEntry) {
    if (deletingId) {
      return;
    }
    setDeletingId(entry.id);
    setRowError(null);
    try {
      await deleteMyPrivateDraftVendorPlan(supabase, { eventId, vendorPlanId: entry.id });
      setEntries((current) => current.filter((existing) => existing.id !== entry.id));
    } catch (error) {
      setRowError(error instanceof Error ? error.message : "We could not remove that vendor.");
    } finally {
      setDeletingId(null);
    }
  }

  if (state === "checking") {
    return <Page><Alert tone="info">Opening your private vendor plan…</Alert></Page>;
  }
  if (state === "denied") {
    return <Page><Alert tone="warning">Sign in with a verified EpicentraX account to plan vendors.</Alert><p><Link href="/organize">Return to your events</Link></p></Page>;
  }
  if (state === "missing" || !draft) {
    return <Page><Alert tone="warning">This private draft is unavailable. It may belong to a different organizer account.</Alert><p><Link href="/organize">Return to your events</Link></p></Page>;
  }
  if (state === "error") {
    return <Page><Alert tone="danger">We could not open this vendor plan. Please return to your event and try again.</Alert><p><Link href={`/organize/${encodeURIComponent(eventId)}`}>Back to this event</Link></p></Page>;
  }

  return (
    <Page style={{ maxWidth: 860, margin: "0 auto", display: "grid", gap: 16 }}>
      <PageHeader
        title="Vendor plan"
        headingLevel="h1"
        description={`Planning for “${draft.event_name}” — a private draft.`}
      />
      <Alert tone="warning">{PRIVACY_COPY}</Alert>

      {rowError ? <Alert tone="danger">{rowError}</Alert> : null}

      <PageSection title="Vendors you are planning" variant="section">
        {entries.length === 0 ? (
          <Alert tone="neutral">Nothing here yet. Add the first vendor below.</Alert>
        ) : (
          <ul style={{ display: "grid", gap: 10, listStyle: "none", margin: 0, padding: 0 }}>
            {entries.map((entry) => (
              <li key={entry.id} className="card" style={{ display: "grid", gap: 8 }}>
                {editingId === entry.id && editForm ? (
                  <form onSubmit={submitEdit} style={{ display: "grid", gap: 12 }}>
                    {editError ? <Alert tone="danger">{editError}</Alert> : null}
                    <OrganizerVendorPlanFields values={editForm} onChange={setEditForm} />
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <AppButton type="submit" variant="primary" loading={savingId === entry.id}>Save changes</AppButton>
                      <AppButton type="button" onClick={cancelEdit} disabled={savingId === entry.id}>Cancel</AppButton>
                    </div>
                  </form>
                ) : (
                  <>
                    <strong>{entry.vendorName}</strong>
                    <span style={{ color: "var(--color-text-muted, #475569)" }}>
                      {VENDOR_PLAN_STATUS_LABELS[entry.planningStatus]} — {planDetails(entry)}
                    </span>
                    {planContact(entry) ? (
                      <span style={{ color: "var(--color-text-muted, #475569)" }}>{planContact(entry)}</span>
                    ) : null}
                    {entry.legacyContactDetail ? (
                      <span style={{ color: "var(--color-text-muted, #475569)" }}>
                        Contact information saved earlier: {entry.legacyContactDetail}
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
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection title="Add a vendor" variant="card">
        {addOpen ? (
          <form onSubmit={submitAdd} style={{ display: "grid", gap: 12 }}>
            {addError ? <Alert tone="danger">{addError}</Alert> : null}
            <OrganizerVendorPlanFields values={addForm} onChange={setAddForm} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <AppButton type="submit" variant="primary" loading={adding}>Add vendor</AppButton>
              <AppButton
                type="button"
                onClick={() => {
                  setAddOpen(false);
                  setAddForm(emptyVendorPlan());
                  setAddError(null);
                }}
                disabled={adding}
              >
                Cancel
              </AppButton>
            </div>
          </form>
        ) : (
          <AppButton onClick={() => setAddOpen(true)}>Add a vendor</AppButton>
        )}
      </PageSection>

      <p><Link href={`/organize/${encodeURIComponent(eventId)}`}>Back to this event</Link></p>
    </Page>
  );
}
