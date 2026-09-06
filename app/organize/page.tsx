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
  type CreateOrganizerDraftInput,
  listMyPrivateEventDrafts,
  type OrganizerDraft,
  organizerDraftInputError,
} from "@/lib/organizerDrafts";
import { supabase } from "@/lib/supabase";

type AccessState = "checking" | "signed_out" | "unverified" | "ready";

type DraftForm = Omit<CreateOrganizerDraftInput, "idempotencyKey">;

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

function formatSchedule(draft: OrganizerDraft) {
  if (!draft.start_date || draft.start_date === draft.end_date) {
    return `${draft.start_date} · ${draft.timezone}`;
  }
  return `${draft.start_date} to ${draft.end_date} · ${draft.timezone}`;
}

export default function OrganizePage() {
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<OrganizerDraft[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [identityNotice, setIdentityNotice] = useState<"confirm" | "review" | null>(null);
  const [creating, setCreating] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [form, setForm] = useState<DraftForm>({
    organizationName: "",
    eventName: "",
    startDate: "",
    endDate: "",
    timezone: browserTimezone(),
    locationMode: "no_location",
    location: "",
    starterTemplate: "casual",
  });

  const loadDrafts = useCallback(async () => {
    setLoadingDrafts(true);
    setLoadError(null);
    try {
      setDrafts(await listMyPrivateEventDrafts(supabase));
    } catch {
      setLoadError("We could not load your private drafts. Please try again.");
    } finally {
      setLoadingDrafts(false);
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
      setIdempotencyKey(newIdempotencyKey());
      setAccessState("ready");
      void loadDrafts();
    }
    void establishAccess();
    return () => {
      cancelled = true;
    };
  }, [loadDrafts]);

  const formError = useMemo(
    () => organizerDraftInputError({ ...form, idempotencyKey }),
    [form, idempotencyKey],
  );

  function updateForm<Key extends keyof DraftForm>(key: Key, value: DraftForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateLocationMode(value: DraftForm["locationMode"]) {
    setForm((current) => ({
      ...current,
      locationMode: value,
      location: value === "location" ? current.location : "",
    }));
  }

  async function createDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formError || creating) {
      setCreateError(formError);
      return;
    }
    setCreating(true);
    setCreateError(null);
    setIdentityNotice(null);
    try {
      const result = await createMyPrivateEventDraft(supabase, {
        ...form,
        idempotencyKey,
      });
      if (
        result.status === "identity_confirmation_required" ||
        result.status === "identity_review_required"
      ) {
        setIdentityNotice(
          result.status === "identity_confirmation_required" ? "confirm" : "review",
        );
        // The server has frozen this uncertain outcome to the current key.
        // A deliberate retry after identity verification must be a NEW
        // request, so mint a fresh key for the next submit.
        setIdempotencyKey(newIdempotencyKey());
        return;
      }
      window.location.assign(
        `/organize/${encodeURIComponent(result.draft.event_id)}`,
      );
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : "We could not create your private draft. Please try again.",
      );
    } finally {
      setCreating(false);
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

  const secureDraftUnavailable = accessState === "ready" && !idempotencyKey;

  return (
    <Page style={{ maxWidth: 940, margin: "0 auto", display: "grid", gap: 16 }}>
      <PageHeader title="Create an Event" headingLevel="h1" description="Start privately. You can plan before anyone else can see it." />
      <Alert tone="info">Your Event will be a private draft — not live. It will not create guest access, invitations, public registration, payment, or a launch.</Alert>
      {secureDraftUnavailable ? (
        <Alert tone="danger">
          Your browser could not start a secure draft. Use an up-to-date browser over a secure (https) connection, then try again.
        </Alert>
      ) : null}

      <PageSection title="New private draft" variant="card">
        <form onSubmit={createDraft} style={{ display: "grid", gap: 14 }}>
          <label>
            Organization name
            <input className="app-form-input" value={form.organizationName} onChange={(event) => updateForm("organizationName", event.target.value)} required />
          </label>
          <label>
            Event name
            <input className="app-form-input" value={form.eventName} onChange={(event) => updateForm("eventName", event.target.value)} required />
          </label>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label>
              Start date <span style={{ fontWeight: 400 }}>(optional)</span>
              <input className="app-form-input" type="date" value={form.startDate} onChange={(event) => updateForm("startDate", event.target.value)} />
            </label>
            <label>
              End date
              <input className="app-form-input" type="date" min={form.startDate || undefined} value={form.endDate} onChange={(event) => updateForm("endDate", event.target.value)} required />
            </label>
            <label>
              Time zone
              <input className="app-form-input" value={form.timezone} onChange={(event) => updateForm("timezone", event.target.value)} placeholder="America/Los_Angeles" required />
            </label>
          </div>
          <label>
            Event place
            <select className="app-form-input" value={form.locationMode} onChange={(event) => updateLocationMode(event.target.value as DraftForm["locationMode"])}>
              <option value="no_location">No location yet</option>
              <option value="online">Online</option>
              <option value="location">A physical location</option>
            </select>
          </label>
          {form.locationMode === "location" ? <label>
            Location
            <input className="app-form-input" value={form.location} onChange={(event) => updateForm("location", event.target.value)} required />
          </label> : null}
          <label>
            Starter template
            <select className="app-form-input" value={form.starterTemplate} onChange={(event) => updateForm("starterTemplate", event.target.value)}>
              {STARTER_TEMPLATES.map((template) => <option key={template.key} value={template.key}>{template.label}</option>)}
            </select>
          </label>
          <p style={{ margin: 0, color: "var(--color-text-muted, #475569)" }}>
            {STARTER_TEMPLATES.find((template) => template.key === form.starterTemplate)?.detail}
          </p>
          {createError ? <Alert tone="danger">{createError}</Alert> : null}
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
          <div><AppButton type="submit" variant="primary" loading={creating} disabled={secureDraftUnavailable}>Create private draft</AppButton></div>
        </form>
      </PageSection>

      <PageSection title="Your private drafts" variant="section">
        {loadingDrafts ? <Alert tone="info">Loading your drafts…</Alert> : null}
        {loadError ? <Alert tone="danger" action={<AppButton onClick={() => void loadDrafts()}>Try again</AppButton>}>{loadError}</Alert> : null}
        {!loadingDrafts && !loadError && drafts.length === 0 ? <Alert tone="neutral">You have not created a private draft yet.</Alert> : null}
        {!loadingDrafts && drafts.length > 0 ? (
          <ul style={{ display: "grid", gap: 10, listStyle: "none", margin: 0, padding: 0 }}>
            {drafts.map((draft) => <li key={draft.event_id} className="card"><strong>{draft.event_name}</strong><br /><span>{draft.organization_name} · {formatSchedule(draft)}</span><br /><Link href={`/organize/${encodeURIComponent(draft.event_id)}`}>Open private draft</Link></li>)}
          </ul>
        ) : null}
      </PageSection>
    </Page>
  );
}
