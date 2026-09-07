"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  OrganizerEventFields,
  type OrganizerEventFormValues,
  organizerEventValuesFromDraft,
  starterTemplateLabel,
} from "@/components/organize/OrganizerEventFields";
import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import {
  deleteMyUnfinishedEvent,
  getMyPrivateEventDraft,
  type OrganizerDraft,
  saveMyPrivateDraftDetails,
} from "@/lib/organizerDrafts";
import { supabase } from "@/lib/supabase";

type WorkspacePageProps = { params: Promise<{ eventId: string }> };

function formatSchedule(draft: OrganizerDraft) {
  return !draft.start_date || draft.start_date === draft.end_date
    ? `${draft.end_date} · ${draft.timezone}`
    : `${draft.start_date} to ${draft.end_date} · ${draft.timezone}`;
}

function newIdempotencyKey() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "";
}

export default function OrganizerDraftWorkspacePage({ params }: WorkspacePageProps) {
  const [draft, setDraft] = useState<OrganizerDraft | null>(null);
  const [state, setState] = useState<"checking" | "denied" | "ready" | "missing" | "error">("checking");

  // Edit-in-place of the Event details.
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<OrganizerEventFormValues | null>(null);
  const [baseline, setBaseline] = useState<OrganizerEventFormValues | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStale, setSaveStale] = useState(false);
  const [saving, setSaving] = useState(false);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteKey, setDeleteKey] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (requestedEventId: string) => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user || !user.email_confirmed_at) {
      setState("denied");
      return;
    }
    try {
      const ownedDraft = await getMyPrivateEventDraft(supabase, requestedEventId);
      setDraft(ownedDraft);
      setState(ownedDraft ? "ready" : "missing");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void params.then(({ eventId: resolvedEventId }) => {
      void load(resolvedEventId);
    });
  }, [load, params]);

  function startEditing() {
    if (!draft) {
      return;
    }
    const current = organizerEventValuesFromDraft(draft);
    setForm(current);
    setBaseline(current);
    setSaveError(null);
    setSaveStale(false);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setForm(null);
    setBaseline(null);
    setSaveError(null);
    setSaveStale(false);
  }

  async function saveDetails() {
    if (!draft || !form || !baseline || saving) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveStale(false);
    try {
      const result = await saveMyPrivateDraftDetails(supabase, {
        eventId: draft.event_id,
        values: form,
        expected: baseline,
      });
      if (result.status === "stale") {
        setSaveStale(true);
        return;
      }
      setDraft(result.draft);
      setEditing(false);
      setForm(null);
      setBaseline(null);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "We could not save your changes. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!draft || deleting) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMyUnfinishedEvent(supabase, {
        eventId: draft.event_id,
        idempotencyKey: deleteKey,
      });
      window.location.assign("/organize");
    } catch (error) {
      setDeleting(false);
      setDeleteError(
        error instanceof Error ? error.message : "We could not delete this event. Please try again.",
      );
    }
  }

  if (state === "checking") {
    return <Page><Alert tone="info">Opening your private draft…</Alert></Page>;
  }
  if (state === "denied") {
    return <Page><Alert tone="warning">Sign in with a verified EpicentraX account to open an organizer draft.</Alert><p><Link href="/organize">Return to your events</Link></p></Page>;
  }
  if (state === "error") {
    return <Page><Alert tone="danger">We could not open this private draft. Please return to your events and try again.</Alert><p><Link href="/organize">Return to your events</Link></p></Page>;
  }
  if (state === "missing" || !draft) {
    return <Page><Alert tone="warning">This private draft is unavailable. It may belong to a different organizer account.</Alert><p><Link href="/organize">Return to your events</Link></p></Page>;
  }

  return (
    <Page style={{ maxWidth: 860, margin: "0 auto", display: "grid", gap: 16 }}>
      <PageHeader title={draft.event_name} headingLevel="h1" />
      <Alert tone="warning">Private draft — not live. Guests cannot access, discover, join, share, register for, or be invited to this Event yet.</Alert>

      <PageSection title="Event details" variant="card">
        {editing && form ? (
          <div style={{ display: "grid", gap: 14 }}>
            {saveStale ? (
              <Alert tone="warning">
                This event changed somewhere else since you opened it. Your changes were not saved.
                Refresh this page to load the latest details, then edit again.
              </Alert>
            ) : null}
            {saveError ? <Alert tone="danger">{saveError}</Alert> : null}
            <OrganizerEventFields values={form} onChange={setForm} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <AppButton variant="primary" loading={saving} onClick={() => void saveDetails()}>
                Save changes
              </AppButton>
              <AppButton onClick={cancelEditing} disabled={saving}>Cancel</AppButton>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <dl style={{ display: "grid", gap: 10, margin: 0 }}>
              <div><dt>Event name</dt><dd>{draft.event_name}</dd></div>
              <div><dt>Schedule</dt><dd>{formatSchedule(draft)}</dd></div>
              <div><dt>Location</dt><dd>{draft.location_mode === "online" ? "Online" : draft.location || "No location yet"}</dd></div>
              <div><dt>Starter template</dt><dd>{starterTemplateLabel(draft.starter_template)}</dd></div>
            </dl>
            <div>
              <AppButton onClick={startEditing}>Edit event details</AppButton>
            </div>
          </div>
        )}
      </PageSection>

      <PageSection title="Agenda" variant="card">
        <p style={{ marginTop: 0, color: "var(--color-text-muted, #475569)" }}>
          Plan the schedule for this private draft. It stays private to you — nothing here is published.
        </p>
        <Link href={`/organize/${encodeURIComponent(draft.event_id)}/agenda`} className="app-button">
          Open the agenda
        </Link>
      </PageSection>

      <PageSection title="Launch readiness" variant="section">
        <p>This private workspace is the safe beginning. Later stages will add Event planning, guest access choices, invitations, and launch checkout. None of those actions are available from this draft yet.</p>
      </PageSection>

      <PageSection title="Delete this event" variant="section">
        {confirmingDelete ? (
          <Alert tone="danger">
            <p style={{ marginTop: 0 }}>
              <strong>This permanently deletes this unfinished event.</strong> Its private draft and
              workspace are removed for good — this cannot be undone and it cannot be resumed.
            </p>
            {deleteError ? <p style={{ color: "#991b1b", fontWeight: 600 }}>{deleteError}</p> : null}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <AppButton variant="danger" loading={deleting} disabled={!deleteKey} onClick={() => void confirmDelete()}>
                Permanently delete this event
              </AppButton>
              <AppButton onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                Keep this event
              </AppButton>
            </div>
          </Alert>
        ) : (
          <div>
            <p style={{ marginTop: 0, color: "var(--color-text-muted, #475569)" }}>
              Deleting removes this unfinished event permanently. It is not archived and cannot be resumed.
            </p>
            <AppButton
              onClick={() => {
                setConfirmingDelete(true);
                setDeleteKey(newIdempotencyKey());
                setDeleteError(null);
              }}
            >
              Delete unfinished event
            </AppButton>
          </div>
        )}
      </PageSection>

      <p><Link href="/organize">Back to your events</Link></p>
    </Page>
  );
}
