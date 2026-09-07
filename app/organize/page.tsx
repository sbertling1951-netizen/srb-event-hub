"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import {
  createMyPrivateEventDraft,
  type CreateOrganizerDraftResult,
  deleteMyUnfinishedEvent,
  getMyOrganizerCapacity,
  listMyPrivateEventDrafts,
  type OrganizerCapacity,
  type OrganizerDraft,
  organizerDraftInputError,
} from "@/lib/organizerDrafts";
import { supabase } from "@/lib/supabase";

type AccessState = "checking" | "signed_out" | "unverified" | "ready";

type EventForm = {
  eventName: string;
  startDate: string;
  endDate: string;
  timezone: string;
  locationMode: "location" | "online" | "no_location";
  location: string;
  starterTemplate: string;
};

const STARTER_TEMPLATES = [
  { key: "casual", label: "Casual gathering", detail: "A simple starting point for a get-together." },
  { key: "birthday_family", label: "Birthday or family", detail: "A welcoming plan for family and friends." },
  { key: "club_rv", label: "Club or RV group", detail: "A familiar starting point for a club gathering." },
  { key: "conference_corporate", label: "Conference or organization", detail: "A starting point for a larger organized event." },
  { key: "dinner", label: "Dinner", detail: "A focused starting point for a meal together." },
  { key: "sports_activity", label: "Sports or activity", detail: "A starting point for an activity-centered event." },
] as const;

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function newIdempotencyKey() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "";
}

function emptyEventForm(): EventForm {
  return {
    eventName: "",
    startDate: "",
    endDate: "",
    timezone: browserTimezone(),
    locationMode: "no_location",
    location: "",
    starterTemplate: "casual",
  };
}

function formatSchedule(draft: OrganizerDraft) {
  if (!draft.start_date || draft.start_date === draft.end_date) {
    return `${draft.end_date} · ${draft.timezone}`;
  }
  return `${draft.start_date} to ${draft.end_date} · ${draft.timezone}`;
}

function EventFields({
  form,
  onChange,
}: {
  form: EventForm;
  onChange: (next: EventForm) => void;
}) {
  function update<Key extends keyof EventForm>(key: Key, value: EventForm[Key]) {
    onChange({ ...form, [key]: value });
  }
  function updateLocationMode(value: EventForm["locationMode"]) {
    onChange({ ...form, locationMode: value, location: value === "location" ? form.location : "" });
  }
  return (
    <>
      <label>
        Event name
        <input className="app-form-input" value={form.eventName} onChange={(event) => update("eventName", event.target.value)} required />
      </label>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label>
          Start date <span style={{ fontWeight: 400 }}>(optional)</span>
          <input className="app-form-input" type="date" value={form.startDate} onChange={(event) => update("startDate", event.target.value)} />
        </label>
        <label>
          End date
          <input className="app-form-input" type="date" min={form.startDate || undefined} value={form.endDate} onChange={(event) => update("endDate", event.target.value)} required />
        </label>
        <label>
          Time zone
          <input className="app-form-input" value={form.timezone} onChange={(event) => update("timezone", event.target.value)} placeholder="America/Los_Angeles" required />
        </label>
      </div>
      <label>
        Event place
        <select className="app-form-input" value={form.locationMode} onChange={(event) => updateLocationMode(event.target.value as EventForm["locationMode"])}>
          <option value="no_location">No location yet</option>
          <option value="online">Online</option>
          <option value="location">A physical location</option>
        </select>
      </label>
      {form.locationMode === "location" ? (
        <label>
          Location
          <input className="app-form-input" value={form.location} onChange={(event) => update("location", event.target.value)} required />
        </label>
      ) : null}
      <label>
        Starter template
        <select className="app-form-input" value={form.starterTemplate} onChange={(event) => update("starterTemplate", event.target.value)}>
          {STARTER_TEMPLATES.map((template) => <option key={template.key} value={template.key}>{template.label}</option>)}
        </select>
      </label>
      <p style={{ margin: 0, color: "var(--color-text-muted, #475569)" }}>
        {STARTER_TEMPLATES.find((template) => template.key === form.starterTemplate)?.detail}
      </p>
    </>
  );
}

const SUBSCRIPTION_NOTE =
  "For now you can plan one event at a time. A future subscription will let you plan more than one at once.";

export default function OrganizePage() {
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [email, setEmail] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<OrganizerDraft[]>([]);
  const [capacity, setCapacity] = useState<OrganizerCapacity | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The create action routes uncertain identity outcomes to the existing
  // /member/activate flow, so one page-level notice is enough.
  const [identityNotice, setIdentityNotice] = useState<"confirm" | "review" | null>(null);

  const [form, setForm] = useState<EventForm>(emptyEventForm());
  const [createKey, setCreateKey] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // "Start over" -- permanently delete the current unfinished event, then show
  // a clean new-event form.
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);
  const [deleteKey, setDeleteKey] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [startedOver, setStartedOver] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [myDrafts, myCapacity] = await Promise.all([
        listMyPrivateEventDrafts(supabase),
        getMyOrganizerCapacity(supabase),
      ]);
      setDrafts(myDrafts);
      setCapacity(myCapacity);
    } catch {
      setLoadError("We could not load your events. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function establishAccess() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) {
        return;
      }
      const user = data.session?.user;
      if (!user) {
        setAccessState("signed_out");
        return;
      }
      setEmail(user.email ?? null);
      if (!user.email_confirmed_at) {
        setAccessState("unverified");
        return;
      }
      setCreateKey(newIdempotencyKey());
      setAccessState("ready");
      void load();
    }
    void establishAccess();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const formError = useMemo(
    () => organizerDraftInputError({ ...form, organizationName: form.eventName, idempotencyKey: createKey }),
    [form, createKey],
  );

  function applyIdentityOutcome(result: CreateOrganizerDraftResult): boolean {
    if (
      result.status === "identity_confirmation_required" ||
      result.status === "identity_review_required"
    ) {
      setIdentityNotice(result.status === "identity_confirmation_required" ? "confirm" : "review");
      return true;
    }
    return false;
  }

  async function createEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formError || creating) {
      setCreateError(formError);
      return;
    }
    setCreating(true);
    setCreateError(null);
    setIdentityNotice(null);
    try {
      // The organizer only ever names an "event". The internal container reuses
      // that same name -- "event space" is never shown to the organizer.
      const result = await createMyPrivateEventDraft(supabase, {
        ...form,
        organizationName: form.eventName,
        idempotencyKey: createKey,
      });
      setCreateKey(newIdempotencyKey());
      if (applyIdentityOutcome(result)) {
        return;
      }
      if (result.status === "created") {
        window.location.assign(`/organize/${encodeURIComponent(result.draft.event_id)}`);
      }
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "We could not create your event. Please try again.",
      );
    } finally {
      setCreating(false);
    }
  }

  function openStartOver() {
    setConfirmingStartOver(true);
    setDeleteKey(newIdempotencyKey());
    setDeleteError(null);
  }

  async function confirmStartOver() {
    const target = drafts[0];
    if (!target || deleting) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMyUnfinishedEvent(supabase, {
        eventId: target.event_id,
        idempotencyKey: deleteKey,
      });
      setDrafts([]);
      setCapacity(null);
      setConfirmingStartOver(false);
      setForm(emptyEventForm());
      setCreateKey(newIdempotencyKey());
      setStartedOver(true);
      void load();
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "We could not delete that event. Please try again.",
      );
    } finally {
      setDeleting(false);
    }
  }

  if (accessState === "checking") {
    return <Page><Alert tone="info">Checking your EpicentraX account…</Alert></Page>;
  }

  if (accessState === "signed_out") {
    return (
      <Page style={{ maxWidth: 720, margin: "0 auto" }}>
        <PageHeader title="Create an Event" headingLevel="h1" description="Start a private Event draft for your organization." />
        <PageSection variant="card">
          <p>Sign in or create a free EpicentraX account to begin. Your account email must be verified before you can create a private draft.</p>
          <p><Link href="/organize/account">Sign in or create a free account</Link></p>
        </PageSection>
      </Page>
    );
  }

  if (accessState === "unverified") {
    return (
      <Page style={{ maxWidth: 720, margin: "0 auto" }}>
        <PageHeader title="Verify your email to create an Event" headingLevel="h1" />
        <Alert tone="warning">{email ? `We need to verify ${email} before creating a private draft.` : "We need to verify your account email before creating a private draft."}</Alert>
        <p>Use the verification email from EpicentraX, then return here. Nothing has been created yet.</p>
      </Page>
    );
  }

  const secureRequestUnavailable = accessState === "ready" && !createKey;
  const atCapacity = capacity ? !capacity.can_start_another_event : drafts.length > 0;
  const grandfatheredExtra = drafts.length > 1;
  const showCreateForm = startedOver || (!loading && drafts.length === 0);

  const identityNoticeBlock =
    identityNotice === "confirm" ? (
      <Alert tone="warning">
        We need to confirm your existing EpicentraX identity before creating this event.
        Nothing has been created yet.{" "}
        <Link href="/member/activate">Confirm your identity</Link>, then return here to finish.
      </Alert>
    ) : identityNotice === "review" ? (
      <Alert tone="warning">
        We could not confirm your EpicentraX identity automatically, so nothing has been created.
        Please contact EpicentraX identity support to continue.
      </Alert>
    ) : null;

  return (
    <Page style={{ maxWidth: 820, margin: "0 auto", display: "grid", gap: 16 }}>
      <PageHeader
        title="Your events"
        headingLevel="h1"
        description="Every event you start here is a private draft — not live. It will not create guest access, invitations, public registration, payment, or a launch."
      />

      {secureRequestUnavailable ? (
        <Alert tone="danger">
          Your browser could not start a secure request. Use an up-to-date browser over a secure (https) connection, then try again.
        </Alert>
      ) : null}

      {identityNoticeBlock}

      {loading ? <Alert tone="info">Loading your events…</Alert> : null}
      {loadError ? (
        <Alert tone="danger" action={<AppButton onClick={() => void load()}>Try again</AppButton>}>{loadError}</Alert>
      ) : null}

      {!loading && !startedOver && drafts.length > 0 ? (
        <PageSection title="Your events" variant="section">
          <ul style={{ display: "grid", gap: 10, listStyle: "none", margin: 0, padding: 0 }}>
            {drafts.map((draft) => (
              <li key={draft.event_id} className="card" style={{ display: "grid", gap: 6 }}>
                <strong>{draft.event_name}</strong>
                <span style={{ color: "var(--color-text-muted, #475569)" }}>{formatSchedule(draft)}</span>
                <Link href={`/organize/${encodeURIComponent(draft.event_id)}`}>Continue planning</Link>
              </li>
            ))}
          </ul>

          {grandfatheredExtra ? (
            <div style={{ marginTop: 12 }}>
              <Alert tone="neutral">
                {SUBSCRIPTION_NOTE} You can keep planning any of the events above.
              </Alert>
            </div>
          ) : atCapacity ? (
            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <p style={{ margin: 0, color: "var(--color-text-muted, #475569)" }}>{SUBSCRIPTION_NOTE}</p>
              {confirmingStartOver ? (
                <Alert tone="danger">
                  <p style={{ marginTop: 0 }}>
                    <strong>This permanently deletes your current unfinished event.</strong> Its private
                    draft and workspace are removed for good — this cannot be undone and it cannot be
                    resumed. Then you can start a new event.
                  </p>
                  {deleteError ? <p style={{ color: "#991b1b", fontWeight: 600 }}>{deleteError}</p> : null}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <AppButton
                      variant="danger"
                      loading={deleting}
                      disabled={secureRequestUnavailable || !deleteKey}
                      onClick={() => void confirmStartOver()}
                    >
                      Permanently delete and start over
                    </AppButton>
                    <AppButton onClick={() => setConfirmingStartOver(false)} disabled={deleting}>
                      Keep my current event
                    </AppButton>
                  </div>
                </Alert>
              ) : (
                <div>
                  <AppButton onClick={openStartOver}>Start over with a new event</AppButton>
                </div>
              )}
            </div>
          ) : null}
        </PageSection>
      ) : null}

      {showCreateForm ? (
        <PageSection
          title={startedOver ? "Start your new event" : "Create your event"}
          variant="card"
        >
          {startedOver ? (
            <Alert tone="success">Your previous unfinished event was permanently deleted. Nothing was kept.</Alert>
          ) : null}
          <p style={{ marginTop: 0, color: "var(--color-text-muted, #475569)" }}>{SUBSCRIPTION_NOTE}</p>
          <form onSubmit={createEvent} style={{ display: "grid", gap: 14 }}>
            <EventFields form={form} onChange={setForm} />
            {createError ? <Alert tone="danger">{createError}</Alert> : null}
            <div>
              <AppButton type="submit" variant="primary" loading={creating} disabled={secureRequestUnavailable}>
                Create my event
              </AppButton>
            </div>
          </form>
        </PageSection>
      ) : null}
    </Page>
  );
}
