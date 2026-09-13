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
 *
 * The Super-Admin refund control below follows the same discipline: its
 * visibility is driven ENTIRELY by the server-derived `refundEligible`
 * boolean the existing GET /api/passport/checkout status read now carries
 * alongside `confirmed` -- itself sourced from the governed, owner-scoped
 * get_my_self_service_event_passport_refund_eligibility reader
 * (20261019000000), which is eligible=true only for a genuine Platform
 * Administrator against a Passport that is EXACTLY 'reserved'. No client
 * table/RPC read of any kind decides this. Platform Administrator authority
 * is independently re-asserted server-side again, inside
 * prepare_self_service_event_passport_refund_request and
 * assert_self_service_event_passport_refund_request_authority, every time --
 * this flag is a visibility hint only, never a substitute for either.
 */

type RefundStage = "idle" | "confirming" | "working" | "requested";

type CheckoutStatus =
  | { state: "loading" }
  | { state: "error" }
  | { state: "no_open_attempt" }
  | { state: "preparing" }
  | { state: "open"; url?: string }
  | { state: "confirmed"; refundEligible: boolean };

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
    return { state: "confirmed", refundEligible: body.refundEligible === true };
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
  const [refundStage, setRefundStage] = useState<RefundStage>("idle");
  const [refundError, setRefundError] = useState<string | null>(null);

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

  async function requestPassportRefund() {
    if (refundStage === "working") {
      return;
    }
    setRefundStage("working");
    setRefundError(null);
    try {
      // Step 1: create or idempotently recover the opaque refund-request
      // identity through the existing governed request authority. Retrying
      // this whole flow after any ambiguous outcome below re-runs this same
      // step, which always recovers the SAME request id for this Event's
      // one original receipt -- never a second, competing request.
      const prepareResponse = await authorizedFetch(
        "/api/admin/passport/refunds/prepare",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId }),
        },
      );
      const prepareBody = await prepareResponse.json().catch(() => null);
      const requestId =
        prepareBody && typeof prepareBody === "object"
          ? (prepareBody as { requestId?: unknown }).requestId
          : undefined;

      if (!prepareResponse.ok || typeof requestId !== "string") {
        setRefundError("We could not start this refund. Please try again.");
        setRefundStage("confirming");
        return;
      }

      // Step 2: invoke the existing authenticated refund-execution route
      // with only that opaque request id -- never an amount, Stripe
      // identifier, or Passport state.
      const executeResponse = await authorizedFetch(
        "/api/admin/passport/refunds",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId }),
        },
      );
      const executeBody = await executeResponse.json().catch(() => null);
      const executeStatus =
        executeBody && typeof executeBody === "object"
          ? (executeBody as { status?: unknown }).status
          : undefined;

      if (!executeResponse.ok || executeStatus !== "refund_pending") {
        setRefundError("We could not start this refund. Please try again.");
        setRefundStage("confirming");
        return;
      }

      // The route accepting the request is not the same as the refund
      // completing -- only the signed webhook and its governed confirmation
      // command may ever write refund evidence or change Passport state.
      setRefundStage("requested");
    } catch {
      setRefundError("We could not start this refund. Please try again.");
      setRefundStage("confirming");
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
        <div style={{ display: "grid", gap: 10 }}>
          <Alert tone="success">
            Passport confirmed. This Event is preserved, and you may begin
            another private Event.
          </Alert>
          {status.refundEligible ? (
            refundStage === "requested" ? (
              <Alert tone="info">
                Refund requested; awaiting confirmation.
              </Alert>
            ) : refundStage === "confirming" || refundStage === "working" ? (
              <div style={{ display: "grid", gap: 10 }}>
                {refundError ? <Alert tone="danger">{refundError}</Alert> : null}
                <Alert tone="warning">
                  This requests the one-time full $24 Passport refund. The
                  Event returns to the ordinary unpaid Delete/Replace cycle
                  only after the refund is confirmed.
                </Alert>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <AppButton
                    variant="danger"
                    loading={refundStage === "working"}
                    onClick={() => void requestPassportRefund()}
                  >
                    Confirm Passport refund
                  </AppButton>
                  <AppButton
                    disabled={refundStage === "working"}
                    onClick={() => {
                      setRefundStage("idle");
                      setRefundError(null);
                    }}
                  >
                    Cancel
                  </AppButton>
                </div>
              </div>
            ) : (
              <div>
                <AppButton variant="danger" onClick={() => setRefundStage("confirming")}>
                  Refund Passport (Super Admin)
                </AppButton>
              </div>
            )
          ) : null}
        </div>
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
