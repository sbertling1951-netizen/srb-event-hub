"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import {
  addOrganizerEventInputError,
  createEventInMyOrganization,
  createMyPrivateEventDraft,
  type CreateOrganizerDraftResult,
  listMyPrivateEventDrafts,
  listMyPrivateOrganizations,
  type OrganizerDraft,
  organizerDraftInputError,
  type OrganizerPrivateOrganization,
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
    return `${draft.start_date} · ${draft.timezone}`;
  }
  return `${draft.start_date} to ${draft.end_date} · ${draft.timezone}`;
}

function EventFields({
  form,
  onChange,
  idPrefix,
}: {
  form: EventForm;
  onChange: (next: EventForm) => void;
  idPrefix: string;
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
          {STARTER_TEMPLATES.map((template) => <option key={`${idPrefix}-${template.key}`} value={template.key}>{template.label}</option>)}
        </select>
      </label>
      <p style={{ margin: 0, color: "var(--color-text-muted, #475569)" }}>
        {STARTER_TEMPLATES.find((template) => template.key === form.starterTemplate)?.detail}
      </p>
    </>
  );
}

export default function OrganizePage() {
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [email, setEmail] = useState<string | null>(null);

  const [organizations, setOrganizations] = useState<OrganizerPrivateOrganization[]>([]);
  const [drafts, setDrafts] = useState<OrganizerDraft[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The two creation actions route uncertain identity outcomes to the same
  // existing /member/activate flow, so one page-level notice is enough.
  const [identityNotice, setIdentityNotice] = useState<"confirm" | "review" | null>(null);

  // "Create a new event space" -- reuses the existing governed command.
  const [newSpaceForm, setNewSpaceForm] = useState<{ organizationName: string } & EventForm>({
    organizationName: "",
    ...emptyEventForm(),
  });
  const [newSpaceKey, setNewSpaceKey] = useState("");
  const [newSpaceError, setNewSpaceError] = useState<string | null>(null);
  const [creatingSpace, setCreatingSpace] = useState(false);

  // "Add an event" to one existing event space.
  const [addOpenFor, setAddOpenFor] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<EventForm>(emptyEventForm());
  const [addKey, setAddKey] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addingEvent, setAddingEvent] = useState(false);

  const loadSpaces = useCallback(async () => {
    setLoadingSpaces(true);
    setLoadError(null);
    try {
      const [orgs, myDrafts] = await Promise.all([
        listMyPrivateOrganizations(supabase),
        listMyPrivateEventDrafts(supabase),
      ]);
      setOrganizations(orgs);
      setDrafts(myDrafts);
    } catch {
      setLoadError("We could not load your event spaces. Please try again.");
    } finally {
      setLoadingSpaces(false);
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
      setNewSpaceKey(newIdempotencyKey());
      setAccessState("ready");
      void loadSpaces();
    }
    void establishAccess();
    return () => {
      cancelled = true;
    };
  }, [loadSpaces]);

  const newSpaceFormError = useMemo(
    () => organizerDraftInputError({ ...newSpaceForm, idempotencyKey: newSpaceKey }),
    [newSpaceForm, newSpaceKey],
  );
  const addFormError = useMemo(
    () =>
      addOpenFor
        ? addOrganizerEventInputError({
            ...addForm,
            organizationTenantId: addOpenFor,
            idempotencyKey: addKey,
          })
        : "Choose one of your event spaces.",
    [addForm, addOpenFor, addKey],
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

  async function createSpace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newSpaceFormError || creatingSpace) {
      setNewSpaceError(newSpaceFormError);
      return;
    }
    setCreatingSpace(true);
    setNewSpaceError(null);
    setIdentityNotice(null);
    try {
      const result = await createMyPrivateEventDraft(supabase, {
        ...newSpaceForm,
        idempotencyKey: newSpaceKey,
      });
      // The server freezes an uncertain outcome to the current key, so a
      // deliberate post-verification retry must use a fresh key.
      setNewSpaceKey(newIdempotencyKey());
      if (applyIdentityOutcome(result)) {
        return;
      }
      if (result.status === "created") {
        window.location.assign(`/organize/${encodeURIComponent(result.draft.event_id)}`);
      }
    } catch (error) {
      setNewSpaceError(
        error instanceof Error ? error.message : "We could not create your event space. Please try again.",
      );
    } finally {
      setCreatingSpace(false);
    }
  }

  function openAddEvent(tenantId: string) {
    setAddOpenFor(tenantId);
    setAddForm(emptyEventForm());
    setAddKey(newIdempotencyKey());
    setAddError(null);
    setIdentityNotice(null);
  }

  async function addEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!addOpenFor || addFormError || addingEvent) {
      setAddError(addFormError);
      return;
    }
    setAddingEvent(true);
    setAddError(null);
    setIdentityNotice(null);
    try {
      const result = await createEventInMyOrganization(supabase, {
        ...addForm,
        organizationTenantId: addOpenFor,
        idempotencyKey: addKey,
      });
      setAddKey(newIdempotencyKey());
      if (applyIdentityOutcome(result)) {
        return;
      }
      if (result.status === "created") {
        window.location.assign(`/organize/${encodeURIComponent(result.draft.event_id)}`);
      }
    } catch (error) {
      setAddError(
        error instanceof Error ? error.message : "We could not add that event. Please try again.",
      );
    } finally {
      setAddingEvent(false);
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

  const secureDraftUnavailable = accessState === "ready" && !newSpaceKey;

  return (
    <Page style={{ maxWidth: 940, margin: "0 auto", display: "grid", gap: 16 }}>
      <PageHeader title="Your event spaces" headingLevel="h1" description="Resume a private draft, add another event to one of your spaces, or start a new space." />
      <Alert tone="info">Every event you create here starts as a private draft — not live. It will not create guest access, invitations, public registration, payment, or a launch.</Alert>
      {secureDraftUnavailable ? (
        <Alert tone="danger">
          Your browser could not start a secure draft. Use an up-to-date browser over a secure (https) connection, then try again.
        </Alert>
      ) : null}
      {identityNotice === "confirm" ? (
        <Alert tone="warning">
          We need to confirm your existing EpicentraX identity before creating this event.
          Nothing has been created yet.{" "}
          <Link href="/member/activate">Confirm your identity</Link>, then return here to finish.
        </Alert>
      ) : null}
      {identityNotice === "review" ? (
        <Alert tone="warning">
          We could not confirm your EpicentraX identity automatically, so nothing has been created.
          Please contact EpicentraX identity support to continue.
        </Alert>
      ) : null}

      <PageSection title="Your event spaces" variant="section">
        {loadingSpaces ? <Alert tone="info">Loading your event spaces…</Alert> : null}
        {loadError ? <Alert tone="danger" action={<AppButton onClick={() => void loadSpaces()}>Try again</AppButton>}>{loadError}</Alert> : null}
        {!loadingSpaces && !loadError && organizations.length === 0 ? (
          <Alert tone="neutral">You do not have an event space yet. Create your first one below.</Alert>
        ) : null}
        {!loadingSpaces && organizations.length > 0 ? (
          <ul style={{ display: "grid", gap: 12, listStyle: "none", margin: 0, padding: 0 }}>
            {organizations.map((organization) => (
              <li key={organization.tenant_id} className="card" style={{ display: "grid", gap: 10 }}>
                <div>
                  <strong>{organization.organization_name}</strong><br />
                  <span>{organization.draft_event_count} draft {organization.draft_event_count === 1 ? "event" : "events"}</span>
                </div>
                {addOpenFor === organization.tenant_id ? (
                  <form onSubmit={addEvent} style={{ display: "grid", gap: 14 }}>
                    <EventFields form={addForm} onChange={setAddForm} idPrefix={`add-${organization.tenant_id}`} />
                    {addError ? <Alert tone="danger">{addError}</Alert> : null}
                    <div style={{ display: "flex", gap: 10 }}>
                      <AppButton type="submit" variant="primary" loading={addingEvent} disabled={secureDraftUnavailable || !addKey}>Add event to this space</AppButton>
                      <AppButton type="button" onClick={() => setAddOpenFor(null)}>Cancel</AppButton>
                    </div>
                  </form>
                ) : (
                  <div>
                    <AppButton onClick={() => openAddEvent(organization.tenant_id)}>Add an event</AppButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </PageSection>

      <PageSection title="Your private drafts" variant="section">
        {!loadingSpaces && !loadError && drafts.length === 0 ? <Alert tone="neutral">You have not created a private draft yet.</Alert> : null}
        {!loadingSpaces && drafts.length > 0 ? (
          <ul style={{ display: "grid", gap: 10, listStyle: "none", margin: 0, padding: 0 }}>
            {drafts.map((draft) => <li key={draft.event_id} className="card"><strong>{draft.event_name}</strong><br /><span>{draft.organization_name} · {formatSchedule(draft)}</span><br /><Link href={`/organize/${encodeURIComponent(draft.event_id)}`}>Open private draft</Link></li>)}
          </ul>
        ) : null}
      </PageSection>

      <PageSection title="Create a new event space" variant="card">
        <p style={{ marginTop: 0, color: "var(--color-text-muted, #475569)" }}>
          Choose this only when you want a separate space. To add another event to a space you already have, use “Add an event” above.
        </p>
        <form onSubmit={createSpace} style={{ display: "grid", gap: 14 }}>
          <label>
            Event space name
            <input className="app-form-input" value={newSpaceForm.organizationName} onChange={(event) => setNewSpaceForm((current) => ({ ...current, organizationName: event.target.value }))} required />
          </label>
          <EventFields
            form={newSpaceForm}
            onChange={(next) => setNewSpaceForm((current) => ({ ...current, ...next }))}
            idPrefix="new-space"
          />
          {newSpaceError ? <Alert tone="danger">{newSpaceError}</Alert> : null}
          <div><AppButton type="submit" variant="primary" loading={creatingSpace} disabled={secureDraftUnavailable}>Create a new event space</AppButton></div>
        </form>
      </PageSection>
    </Page>
  );
}
