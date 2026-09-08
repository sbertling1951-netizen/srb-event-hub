"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { OrganizerBudgetFields } from "@/components/organize/OrganizerBudgetFields";
import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import {
  addMyPrivateDraftBudgetLine,
  type BudgetLine,
  budgetLineError,
  type BudgetLineInput,
  budgetLineValues,
  deleteMyPrivateDraftBudgetLine,
  emptyBudgetLine,
  listMyPrivateDraftBudgetLines,
  updateMyPrivateDraftBudgetLine,
} from "@/lib/organizerBudget";
import { getMyPrivateEventDraft, type OrganizerDraft } from "@/lib/organizerDrafts";
import { supabase } from "@/lib/supabase";

type BudgetPageProps = { params: Promise<{ eventId: string }> };
type LoadState = "checking" | "denied" | "missing" | "error" | "ready";

// The privacy / no-payment notice the contract requires. It says plainly what
// this is and, just as plainly, what it is not.
const PRIVACY_COPY =
  "This budget is yours alone. Nobody else can see it — not your guests, not a vendor, not a venue, not EpicentraX staff. " +
  "Writing an amount down here does not pay it, charge you, send an invoice, or commit you to anything, and nothing here " +
  "affects whether this Event is ready or when it can launch.";

// Deliberately warm and neutral: an empty budget is a perfectly fine state,
// not a warning, a nag, or an incomplete step. EpicentraX suggests nothing.
const EMPTY_COPY =
  "Nothing here yet — this is a blank page for costs you want to keep track of. Add a line below whenever you like.";

/**
 * Renders one amount beside its own line's currency, exactly as the database
 * returned it. There is deliberately no total, subtotal, count, chart,
 * progress bar, or comparison between the estimate and the actual: each number
 * is shown on its own, in its own currency, and nothing is added up.
 */
function Amount({ label, value, currency }: { label: string; value: string | null; currency: string }) {
  if (!value) {
    return null;
  }
  return (
    <span style={{ color: "var(--color-text-muted, #475569)" }}>
      {label}: {value} {currency}
    </span>
  );
}

export default function OrganizerBudgetPage({ params }: BudgetPageProps) {
  const [eventId, setEventId] = useState<string>("");
  const [draft, setDraft] = useState<OrganizerDraft | null>(null);
  const [state, setState] = useState<LoadState>("checking");

  const [lines, setLines] = useState<BudgetLine[]>([]);

  const [addForm, setAddForm] = useState<BudgetLineInput>(emptyBudgetLine());
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<BudgetLineInput | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const loadLines = useCallback(async (id: string) => {
    setLines(await listMyPrivateDraftBudgetLines(supabase, id));
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
        await loadLines(id);
        setState("ready");
      } catch {
        setState("error");
      }
    },
    [loadLines],
  );

  useEffect(() => {
    void params.then(({ eventId: resolved }) => {
      setEventId(resolved);
      void load(resolved);
    });
  }, [load, params]);

  async function submitAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = budgetLineError(addForm);
    if (validationError || adding) {
      setAddError(validationError);
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const line = await addMyPrivateDraftBudgetLine(supabase, { eventId, values: addForm });
      setLines((current) => [...current, line]);
      setAddForm(emptyBudgetLine());
      setAddOpen(false);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "We could not add that budget line.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(line: BudgetLine) {
    setEditingId(line.id);
    setEditForm(budgetLineValues(line));
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
    const validationError = budgetLineError(editForm);
    if (validationError || savingId) {
      setEditError(validationError);
      return;
    }
    setSavingId(editingId);
    setEditError(null);
    try {
      const line = await updateMyPrivateDraftBudgetLine(supabase, {
        eventId,
        budgetLineId: editingId,
        values: editForm,
      });
      setLines((current) => current.map((existing) => (existing.id === line.id ? line : existing)));
      cancelEdit();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "We could not save that budget line.");
    } finally {
      setSavingId(null);
    }
  }

  async function removeLine(line: BudgetLine) {
    if (busyId) {
      return;
    }
    setBusyId(line.id);
    setRowError(null);
    try {
      await deleteMyPrivateDraftBudgetLine(supabase, { eventId, budgetLineId: line.id });
      setLines((current) => current.filter((existing) => existing.id !== line.id));
    } catch (error) {
      setRowError(error instanceof Error ? error.message : "We could not remove that budget line.");
    } finally {
      setBusyId(null);
    }
  }

  if (state === "checking") {
    return <Page><Alert tone="info">Opening your budget plan…</Alert></Page>;
  }
  if (state === "denied") {
    return <Page><Alert tone="warning">Sign in with a verified EpicentraX account to use a budget plan.</Alert><p><Link href="/organize">Return to your events</Link></p></Page>;
  }
  if (state === "missing" || !draft) {
    return <Page><Alert tone="warning">This private draft is unavailable. It may belong to a different organizer account.</Alert><p><Link href="/organize">Return to your events</Link></p></Page>;
  }
  if (state === "error") {
    return <Page><Alert tone="danger">We could not open this budget plan. Please return to your event and try again.</Alert><p><Link href={`/organize/${encodeURIComponent(eventId)}`}>Back to this event</Link></p></Page>;
  }

  return (
    <Page style={{ maxWidth: 860, margin: "0 auto", display: "grid", gap: 16 }}>
      <PageHeader
        title="Budget plan"
        headingLevel="h1"
        description={`Planning for “${draft.event_name}” — a private draft.`}
      />
      <Alert tone="info">{PRIVACY_COPY}</Alert>

      {rowError ? <Alert tone="danger">{rowError}</Alert> : null}

      <PageSection title="Your budget lines" variant="section">
        {lines.length === 0 ? (
          <Alert tone="neutral">{EMPTY_COPY}</Alert>
        ) : (
          <ul style={{ display: "grid", gap: 10, listStyle: "none", margin: 0, padding: 0 }}>
            {lines.map((line) => (
              <li key={line.id} className="card" style={{ display: "grid", gap: 8 }}>
                {editingId === line.id && editForm ? (
                  <form onSubmit={submitEdit} style={{ display: "grid", gap: 12 }}>
                    {editError ? <Alert tone="danger">{editError}</Alert> : null}
                    <OrganizerBudgetFields values={editForm} onChange={setEditForm} />
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <AppButton type="submit" variant="primary" loading={savingId === line.id}>Save changes</AppButton>
                      <AppButton type="button" onClick={cancelEdit} disabled={savingId === line.id}>Cancel</AppButton>
                    </div>
                  </form>
                ) : (
                  <>
                    <strong>{line.lineName}</strong>
                    {line.category ? (
                      <span style={{ color: "var(--color-text-muted, #475569)" }}>Category: {line.category}</span>
                    ) : null}
                    {/* Each amount stands alone beside its own currency. Nothing is summed. */}
                    <Amount label="Estimated" value={line.estimatedAmount} currency={line.currency} />
                    <Amount label="Actual" value={line.actualAmount} currency={line.currency} />
                    {line.organizerNote ? <p style={{ margin: 0 }}>Note: {line.organizerNote}</p> : null}
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <AppButton onClick={() => startEdit(line)}>Edit</AppButton>
                      <AppButton
                        variant="danger"
                        loading={busyId === line.id}
                        onClick={() => void removeLine(line)}
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

      <PageSection title="Add a budget line" variant="card">
        {addOpen ? (
          <form onSubmit={submitAdd} style={{ display: "grid", gap: 12 }}>
            {addError ? <Alert tone="danger">{addError}</Alert> : null}
            <OrganizerBudgetFields values={addForm} onChange={setAddForm} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <AppButton type="submit" variant="primary" loading={adding}>Add budget line</AppButton>
              <AppButton
                type="button"
                onClick={() => {
                  setAddOpen(false);
                  setAddForm(emptyBudgetLine());
                  setAddError(null);
                }}
                disabled={adding}
              >
                Cancel
              </AppButton>
            </div>
          </form>
        ) : (
          <AppButton onClick={() => setAddOpen(true)}>Add a budget line</AppButton>
        )}
      </PageSection>

      <p><Link href={`/organize/${encodeURIComponent(eventId)}`}>Back to this event</Link></p>
    </Page>
  );
}
