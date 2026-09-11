"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  emptyOrganizerEventForm,
  OrganizerEventFields,
  type OrganizerEventFormValues,
} from "@/components/organize/OrganizerEventFields";
import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import {
  createMyPrivateEventDraft,
  type CreateOrganizerDraftResult,
  getMyOrganizerCapacity,
  listMyPrivateEventDrafts,
  type OrganizerBlockingEvent,
  type OrganizerCapacity,
  type OrganizerDraft,
  organizerDraftInputError,
  replaceMyUnfinishedEvent,
} from "@/lib/organizerDrafts";
import { supabase } from "@/lib/supabase";

type AccessState = "checking" | "signed_out" | "unverified" | "ready";

type EventForm = OrganizerEventFormValues;

type ReplaceStep = "idle" | "collecting" | "confirming";

function newIdempotencyKey() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "";
}

const emptyEventForm = emptyOrganizerEventForm;

function formatSchedule(schedule: { start_date: string | null; end_date: string; timezone: string }) {
  if (!schedule.start_date || schedule.start_date === schedule.end_date) {
    return `${schedule.end_date} · ${schedule.timezone}`;
  }
  return `${schedule.start_date} to ${schedule.end_date} · ${schedule.timezone}`;
}

function formatBlockingSchedule(blockingEvent: OrganizerBlockingEvent) {
  return formatSchedule({
    start_date: blockingEvent.startDate,
    end_date: blockingEvent.endDate,
    timezone: blockingEvent.timezone,
  });
}

function blockingEventFromDraft(draft: OrganizerDraft): OrganizerBlockingEvent {
  return {
    eventId: draft.event_id,
    eventName: draft.event_name,
    startDate: draft.start_date,
    endDate: draft.end_date,
    timezone: draft.timezone,
  };
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

  // The create/replace actions route uncertain identity outcomes to the
  // existing /member/activate flow, so one page-level notice is enough.
  const [identityNotice, setIdentityNotice] = useState<"confirm" | "review" | null>(null);

  const [form, setForm] = useState<EventForm>(emptyEventForm());
  const [createKey, setCreateKey] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // P-2D.1: a capacity conflict discovered mid-submit (the loaded capacity was
  // stale) is handled exactly like the ordinary at-capacity case below --
  // this never happens from stale local state alone, since the server is
  // always the authority, but it must still degrade to the same safe choice
  // instead of a raw error.
  const [raceBlockingEvent, setRaceBlockingEvent] = useState<OrganizerBlockingEvent | null>(null);

  // P-2D.1: Replace current event -- collect the new Event's details FIRST,
  // then one explicit irreversible confirmation, then the one atomic
  // replacement RPC. The old Event is never touched until that RPC succeeds,
  // so it is never lost merely because the browser fails, closes, or the new
  // form was invalid.
  const [replaceStep, setReplaceStep] = useState<ReplaceStep>("idle");
  const [replaceForm, setReplaceForm] = useState<EventForm>(emptyEventForm());
  const [replaceKey, setReplaceKey] = useState("");
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);

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

  const replaceFormError = useMemo(
    () =>
      organizerDraftInputError({
        ...replaceForm,
        organizationName: replaceForm.eventName,
        idempotencyKey: replaceKey,
      }),
    [replaceForm, replaceKey],
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
      if (result.status === "active_event_exists") {
        setRaceBlockingEvent(result.blockingEvent);
        void load();
        return;
      }
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

  function openReplaceFlow() {
    setReplaceForm(emptyEventForm());
    setReplaceError(null);
    setReplaceKey(newIdempotencyKey());
    setReplaceStep("collecting");
  }

  function submitReplaceDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (replaceFormError) {
      setReplaceError(replaceFormError);
      return;
    }
    setReplaceError(null);
    setReplaceStep("confirming");
  }

  function cancelReplace() {
    setReplaceStep("idle");
    setReplaceError(null);
  }

  async function confirmReplace(blockingEvent: OrganizerBlockingEvent) {
    if (replacing) {
      return;
    }
    setReplacing(true);
    setReplaceError(null);
    setIdentityNotice(null);
    try {
      const result = await replaceMyUnfinishedEvent(supabase, {
        ...replaceForm,
        organizationName: replaceForm.eventName,
        oldEventId: blockingEvent.eventId,
        idempotencyKey: replaceKey,
      });
      setReplaceKey(newIdempotencyKey());
      if (result.status === "identity_confirmation_required" || result.status === "identity_review_required") {
        setIdentityNotice(result.status === "identity_confirmation_required" ? "confirm" : "review");
        setReplaceStep("idle");
        return;
      }
      window.location.assign(`/organize/${encodeURIComponent(result.draft.event_id)}`);
    } catch (error) {
      // The replacement RPC is one transaction: an error here means the old
      // Event was never touched. Stay on the confirmation step (keeping the
      // typed new-event details) so the organizer can simply retry.
      setReplaceError(
        error instanceof Error ? error.message : "We could not replace your event. Please try again.",
      );
    } finally {
      setReplacing(false);
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
  const secureReplaceRequestUnavailable = accessState === "ready" && !replaceKey;
  const atCapacity = capacity ? !capacity.can_start_another_event : drafts.length > 0;
  const grandfatheredExtra = drafts.length > 1;
  // The caller's own blocking Event: either discovered from the loaded list,
  // or (a stale-capacity race) returned directly by a create attempt.
  const blockingEvent: OrganizerBlockingEvent | null =
    raceBlockingEvent ?? (atCapacity && !grandfatheredExtra && drafts[0] ? blockingEventFromDraft(drafts[0]) : null);
  const showConflictChoice = !grandfatheredExtra && !!blockingEvent;
  const showCreateForm = !showConflictChoice && !grandfatheredExtra && !loading && drafts.length === 0;

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

      {!loading && drafts.length > 0 ? (
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
          ) : null}
        </PageSection>
      ) : null}

      {showConflictChoice && blockingEvent ? (
        <PageSection title="Create new event" variant="card">
          <p style={{ marginTop: 0, color: "var(--color-text-muted, #475569)" }}>{SUBSCRIPTION_NOTE}</p>

          {replaceStep === "idle" ? (
            <div style={{ display: "grid", gap: 10 }}>
              <p style={{ margin: 0 }}>
                You already have one unfinished event, <strong>{blockingEvent.eventName}</strong> (
                {formatBlockingSchedule(blockingEvent)}).
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link href={`/organize/${encodeURIComponent(blockingEvent.eventId)}`}>
                  <AppButton variant="primary">Continue current event</AppButton>
                </Link>
                <AppButton onClick={openReplaceFlow}>Replace current event</AppButton>
              </div>
            </div>
          ) : replaceStep === "collecting" ? (
            <form onSubmit={submitReplaceDetails} style={{ display: "grid", gap: 14 }}>
              <p style={{ margin: 0 }}>
                Enter the details for your new event. Nothing is deleted yet.
              </p>
              <OrganizerEventFields values={replaceForm} onChange={setReplaceForm} />
              {replaceError ? <Alert tone="danger">{replaceError}</Alert> : null}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <AppButton type="submit" variant="primary" disabled={secureReplaceRequestUnavailable}>
                  Continue
                </AppButton>
                <AppButton onClick={cancelReplace}>Cancel</AppButton>
              </div>
            </form>
          ) : (
            <Alert tone="danger">
              <p style={{ marginTop: 0 }}>
                <strong>
                  This permanently deletes &ldquo;{blockingEvent.eventName}&rdquo;
                </strong>{" "}
                and creates &ldquo;{replaceForm.eventName}&rdquo; instead. The old event&apos;s private
                draft and workspace are removed for good — this cannot be undone and it cannot be
                resumed.
              </p>
              {replaceError ? <p style={{ color: "#991b1b", fontWeight: 600 }}>{replaceError}</p> : null}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <AppButton
                  variant="danger"
                  loading={replacing}
                  disabled={secureReplaceRequestUnavailable}
                  onClick={() => void confirmReplace(blockingEvent)}
                >
                  Replace event
                </AppButton>
                <AppButton onClick={() => setReplaceStep("collecting")} disabled={replacing}>
                  Back
                </AppButton>
              </div>
            </Alert>
          )}
        </PageSection>
      ) : null}

      {showCreateForm ? (
        <PageSection title="Create your event" variant="card">
          <p style={{ marginTop: 0, color: "var(--color-text-muted, #475569)" }}>{SUBSCRIPTION_NOTE}</p>
          <form onSubmit={createEvent} style={{ display: "grid", gap: 14 }}>
            <OrganizerEventFields values={form} onChange={setForm} />
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
