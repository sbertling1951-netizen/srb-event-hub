"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { getMyPrivateEventDraft, type OrganizerDraft } from "@/lib/organizerDrafts";
import { supabase } from "@/lib/supabase";

type WorkspacePageProps = { params: Promise<{ eventId: string }> };

function formatSchedule(draft: OrganizerDraft) {
  return !draft.start_date || draft.start_date === draft.end_date
    ? `${draft.start_date} · ${draft.timezone}`
    : `${draft.start_date} to ${draft.end_date} · ${draft.timezone}`;
}

export default function OrganizerDraftWorkspacePage({ params }: WorkspacePageProps) {
  const [draft, setDraft] = useState<OrganizerDraft | null>(null);
  const [state, setState] = useState<"checking" | "denied" | "ready" | "missing" | "error">("checking");

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

  if (state === "checking") {
    return <Page><Alert tone="info">Opening your private draft…</Alert></Page>;
  }
  if (state === "denied") {
    return <Page><Alert tone="warning">Sign in with a verified EpicentraX account to open an organizer draft.</Alert><p><Link href="/organize">Return to organizer setup</Link></p></Page>;
  }
  if (state === "error") {
    return <Page><Alert tone="danger">We could not open this private draft. Please return to organizer setup and try again.</Alert><p><Link href="/organize">Return to organizer setup</Link></p></Page>;
  }
  if (state === "missing" || !draft) {
    return <Page><Alert tone="warning">This private draft is unavailable. It may belong to a different organizer account.</Alert><p><Link href="/organize">Return to your drafts</Link></p></Page>;
  }

  return (
    <Page style={{ maxWidth: 860, margin: "0 auto", display: "grid", gap: 16 }}>
      <PageHeader title={draft.event_name} headingLevel="h1" description={draft.organization_name} />
      <Alert tone="warning">Private draft — not live. Guests cannot access, discover, join, share, register for, or be invited to this Event yet.</Alert>
      <PageSection title="Event details" variant="card">
        <dl style={{ display: "grid", gap: 10, margin: 0 }}>
          <div><dt>Schedule</dt><dd>{formatSchedule(draft)}</dd></div>
          <div><dt>Location</dt><dd>{draft.location_mode === "online" ? "Online" : draft.location || "No location yet"}</dd></div>
          <div><dt>Starter template</dt><dd>{draft.starter_template}</dd></div>
        </dl>
      </PageSection>
      <PageSection title="Launch readiness" variant="section">
        <p>This private workspace is the safe beginning. Later stages will add Event planning, guest access choices, invitations, and launch checkout. None of those actions are available from this draft yet.</p>
      </PageSection>
      <p><Link href="/organize">Back to your private drafts</Link></p>
    </Page>
  );
}
