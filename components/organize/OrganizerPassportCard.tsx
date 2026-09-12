"use client";

import { useCallback, useEffect, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { PageSection } from "@/components/ui/PageSection";
import { supabase } from "@/lib/supabase";

/**
 * The compact Passport card for the private Draft workspace. It never talks
 * to Stripe, never reads a Passport/attempt/receipt table directly, and
 * never claims payment succeeded on its own -- every state shown here comes
 * from the server's own safe status, and a hosted checkout redirect always
 * goes to the exact URL the server returned, never a client-constructed one.
 */

type CheckoutStatus =
  | { state: "loading" }
  | { state: "error" }
  | { state: "no_open_attempt" }
  | { state: "preparing" }
  | { state: "open"; url?: string }
  | { state: "confirmed" };

async function authorizedFetch(path: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (!accessToken) {
    throw new Error("Your session has expired. Please sign in again.");
  }

  return fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

async function fetchStatus(eventId: string): Promise<CheckoutStatus> {
  const response = await authorizedFetch(
    `/api/passport/checkout?eventId=${encodeURIComponent(eventId)}`,
  );

  if (!response.ok) {
    return { state: "error" };
  }

  const body = await response.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return { state: "error" };
  }

  if (body.status === "confirmed") {
    return { state: "confirmed" };
  }

  if (body.status === "no_open_attempt") {
    return { state: "no_open_attempt" };
  }

  if (body.status === "open_attempt") {
    if (body.state === "open" && typeof body.url === "string") {
      return { state: "open", url: body.url };
    }
    return { state: "preparing" };
  }

  return { state: "error" };
}

export function OrganizerPassportCard({
  eventId,
  justReturnedFromCheckout,
}: {
  eventId: string;
  justReturnedFromCheckout: boolean;
}) {
  const [status, setStatus] = useState<CheckoutStatus>({ state: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [expiring, setExpiring] = useState(false);

  const refresh = useCallback(async () => {
    setStatus({ state: "loading" });
    try {
      setStatus(await fetchStatus(eventId));
    } catch {
      setStatus({ state: "error" });
    }
  }, [eventId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function beginOrResumeCheckout() {
    if (purchasing) {
      return;
    }
    setPurchasing(true);
    setActionError(null);
    try {
      const response = await authorizedFetch("/api/passport/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.url) {
        setActionError(
          "We could not start Passport checkout. Please refresh and try again.",
        );
        setPurchasing(false);
        return;
      }

      window.location.assign(body.url);
    } catch {
      setActionError(
        "We could not start Passport checkout. Please refresh and try again.",
      );
      setPurchasing(false);
    }
  }

  async function expireCheckout() {
    if (expiring) {
      return;
    }
    setExpiring(true);
    setActionError(null);
    try {
      const response = await authorizedFetch(
        `/api/passport/checkout?eventId=${encodeURIComponent(eventId)}`,
        { method: "DELETE" },
      );
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setActionError("We could not expire this checkout. Please try again.");
        setExpiring(false);
        return;
      }

      if (body?.status === "payment_completing") {
        setActionError(null);
        await refresh();
        setExpiring(false);
        return;
      }

      await refresh();
    } catch {
      setActionError("We could not expire this checkout. Please try again.");
    } finally {
      setExpiring(false);
    }
  }

  return (
    <PageSection title="Passport" variant="card">
      <p style={{ marginTop: 0, color: "var(--color-text-muted, #475569)" }}>
        One-time $24 Passport for this private Event. Purchasing preserves this
        Event and lets you begin another one while this one stays private and
        unlaunched.
      </p>

      {justReturnedFromCheckout && status.state !== "confirmed" ? (
        <Alert tone="info">
          Payment received; confirming your Passport. This can take a
          moment — refresh if it does not update.
        </Alert>
      ) : null}

      {actionError ? <Alert tone="danger">{actionError}</Alert> : null}

      {status.state === "loading" ? (
        <Alert tone="info">Checking Passport status…</Alert>
      ) : status.state === "error" ? (
        <Alert tone="danger" action={<AppButton onClick={() => void refresh()}>Try again</AppButton>}>
          We could not load Passport status.
        </Alert>
      ) : status.state === "confirmed" ? (
        <Alert tone="success">
          Passport confirmed. This Event is preserved, and you may begin
          another private Event.
        </Alert>
      ) : status.state === "no_open_attempt" ? (
        <AppButton variant="primary" loading={purchasing} onClick={() => void beginOrResumeCheckout()}>
          Purchase Passport — $24
        </AppButton>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <Alert tone="info">
            A Passport checkout is in progress for this Event.
          </Alert>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <AppButton variant="primary" loading={purchasing} onClick={() => void beginOrResumeCheckout()}>
              Resume checkout
            </AppButton>
            <AppButton loading={expiring} onClick={() => void expireCheckout()}>
              Expire checkout
            </AppButton>
          </div>
        </div>
      )}
    </PageSection>
  );
}
