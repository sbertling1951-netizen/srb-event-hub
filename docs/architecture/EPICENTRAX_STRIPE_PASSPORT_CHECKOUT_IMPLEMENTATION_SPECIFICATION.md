# EpicentraX Stripe Passport Checkout Implementation Specification

**Status:** Approved design. Implementation is not yet authorized.

**Date:** 2026-09-11

## 1. Purpose

This specification defines the smallest safe implementation after the live
provider-independent Passport entitlement foundation. It covers a one-time
Stripe Checkout for a private Event Passport, signature-verified webhook
confirmation, immutable receipt/audit evidence, and safe cancellation of an
open Checkout Session.

It is governed by the
[Private Event Passport Reservation Contract](EPICENTRAX_PRIVATE_EVENT_PASSPORT_RESERVATION_CONTRACT.md).
It does not authorize implementation, secret provisioning, live payment,
launch, invitation, guest access, refund, renewal, tax automation, or a
production Stripe activation.

## 2. Fixed first-release decisions

- One Passport is a one-time **USD $24.00** purchase for one Event.
- It is not a subscription and has no automatic renewal.
- Stripe Checkout is hosted by Stripe; EpicentraX does not collect card data.
- One open Checkout Session is permitted for an Event at a time.
- A later checkout attempt is permitted only after the earlier attempt is
  recorded as expired or cancelled. Attempt history remains durable.
- Stripe's receipt is sufficient for the first release. EpicentraX also keeps
  an immutable, minimal receipt/audit fact.
- Tax calculation, collection, and accounting treatment remain deferred pending
  Pap's accountant advice.
- Self-service refunds do not exist. A future refund/cancellation process is a
  separately governed workflow.

## 3. The authority rule

Stripe is a payment processor, not the Passport authority. The authoritative
commercial state remains `public.self_service_event_passports`:

| State | Meaning | Unpaid Event slot |
| --- | --- | --- |
| no row | ordinary unfinished Event | consumed |
| `payment_pending` | a checkout attempt exists but no verified payment | consumed |
| `reserved` | verified payment, still pre-launch | free |
| `active` | future launched Passport period | free |
| `expired` | future historical entitlement | free |

No browser redirect, URL parameter, client claim, Stripe session identifier, or
Event lifecycle field may transition or imply this state. Only the
server-side, signature-verified provider confirmation path may move an Event
from `payment_pending` to `reserved`.

## 4. End-to-end flow

```text
Organizer requests Passport checkout
  -> owner-scoped EpicentraX preparation creates/locks one pending attempt
  -> server creates or reuses one Stripe Checkout Session
  -> organizer completes Stripe-hosted checkout
  -> Stripe webhook reaches EpicentraX
  -> server verifies the raw-body signature and provider facts
  -> service-only database command writes receipt/audit + reserves Passport
  -> organizer refreshes and may create another Event
```

The browser return page is informational only: for example, “Payment received;
confirming your Passport.” It refreshes Passport state but cannot announce
success as authoritative before the webhook command completes.

## 5. Durable facts and ownership

`self_service_event_passports` remains narrow and unchanged in purpose. New
provider facts belong in separate records:

| Record | Required facts | Owner / writer |
| --- | --- | --- |
| Passport payment attempt | internal attempt id, plain Event reference, provider name, opaque provider Checkout Session id, lifecycle (`open`, `expired`, `cancelled`, `confirmed`), timestamps | governed organizer-start and server cancellation/confirmation commands |
| Passport receipt/audit | immutable internal id, provider event id, provider session id, amount/currency snapshot, confirmation timestamp, plain Event reference, attempt reference | service-only verified webhook confirmation command |

The receipt/audit record must have a uniqueness constraint on the provider event
identifier. It must be append-only: `UPDATE` and `DELETE` are denied by a
trigger, with no browser read or write policy. It is evidence, not an Event
discovery surface.

Provider identifiers are opaque references. They never grant access, identify
an organizer, or replace canonical Person resolution.

## 6. Checkout preparation

The organizer-facing server boundary must:

1. authenticate the Bearer-token caller;
2. resolve the canonical Person under the existing private-Draft owner rules;
3. establish that the caller owns the eligible private Event;
4. ensure the Event is unfinished and has no `reserved`, `active`, or `expired`
   Passport;
5. lock or create the single pending Passport/attempt state using an
   idempotency key;
6. return only caller-safe attempt information needed to continue Checkout.

The browser never supplies an amount, currency, Person id, tenant id, provider
identifier, or entitlement state. Server configuration selects the fixed USD
$24.00 Stripe Price.

The Next.js Checkout route may call Stripe only after the owner-scoped database
preparation succeeds. Its Stripe key is server-only. It must write the created
session id back through a governed command tied to the internal attempt, never
by browser update.

## 7. Webhook confirmation

The webhook route is deliberately separate from organizer authentication:

- it accepts Stripe's raw request body before JSON parsing;
- it verifies Stripe's signature with a server-only webhook secret;
- it validates the expected one-time Passport Price, USD amount, completed
  payment status, and the internal attempt/Event reference recorded at
  checkout preparation;
- it invokes one database confirmation command executable only by `service_role`;
- that command locks the one attempt and Passport, writes the immutable receipt
  first, and then transitions `payment_pending` to `reserved` exactly once;
- replay of the same provider event is a harmless idempotent outcome, based on
  the durable unique provider-event record rather than route-memory.

The webhook receives no authority from a browser session. Conversely, browser
callers receive no ability to invoke the confirmation command.

## 8. Cross-system race and cancellation rule

Postgres and Stripe cannot share one atomic transaction. A database lock cannot
by itself prevent Stripe from completing a payment. The implementation must use
the attempt lifecycle, provider-status checks, durable webhook idempotency, and
row locks together.

Ordinary Delete and Replace are therefore revised only for an Event with an
open provider attempt:

1. They return a caller-safe `checkout_cancellation_required` outcome rather
   than deleting the Event or local pending Passport row.
2. The organizer chooses **Cancel checkout**.
3. A server-only cancellation boundary requests that Stripe expire the recorded
   open Checkout Session and reads the resulting provider state.
4. If Stripe confirms the session is no longer payable, a governed database
   command locks the attempt, records it cancelled/expired, and permits the
   existing pending-entitlement cleanup and ordinary Delete/Replace path.
5. If Stripe reports completed payment, cancellation does not delete. The
   verification/confirmation path is allowed to reserve the Passport, and the
   UI tells the organizer that payment was confirmed and the Event was
   preserved.

There is no path that silently drops an Event after a provider may have accepted
payment. A plain pending Passport with no provider attempt retains the live
foundation's existing ordinary Delete/Replace behavior.

## 9. Organizer experience

The existing private-event capacity/replace screen gains the smallest necessary
Passport controls:

- an eligible Event offers **Keep this event — purchase its Passport**;
- an open attempt offers **Resume checkout** and **Cancel checkout**;
- the return page says confirmation is pending until the owner-scoped Passport
  reader shows `reserved`;
- a reserved Event makes the existing **Create new event** route available;
- Delete/Replace of an Event with an open session presents the cancellation
  choice instead of an irreversible deletion confirmation;
- no card details, raw Stripe errors, foreign Event information, provider
  event id, or secret is rendered.

## 10. Secret and configuration boundary

The implementation may use server-only variables named:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PASSPORT_PRICE_ID`

They belong only in protected server environment configuration. They are never
committed, added to browser bundles, printed in logs, pasted into chat, or read
from a tracked source file. `NEXT_PUBLIC_` is not appropriate for any of them.

The Stripe sandbox already exists. Sandbox configuration and test keys are the
only permitted provider environment for the first implementation/runtime proof.
Live credentials, live webhook endpoint activation, and live payment acceptance
require a later, explicit Pap approval.

## 11. Required proof

Before any sandbox runtime test, the implementation must provide structural
tests and a rollback fixture covering at least:

- caller ownership, canonical-Person uncertainty, and other-Person denial;
- one-open-attempt behavior and safe retry after recorded cancellation/expiry;
- browser direct writes denied on every Passport/attempt/receipt record;
- service-only confirmation grant and durable provider-event idempotency;
- payment confirmation reserves exactly the intended Event and frees one slot;
- event lifecycle/status/visibility fields cannot create entitlement;
- Delete/Replace with no provider attempt remains unchanged;
- Delete/Replace with an open attempt requires governed cancellation;
- completed-payment cancellation race preserves the Event;
- receipt immutability and no reverse Event/payment discovery surface.

Sandbox end-to-end proof must use Stripe test credentials and a signature-valid
test webhook. It must demonstrate Checkout creation, verified confirmation,
replayed provider-event idempotency, cancellation/expiry, and the completed
payment race before any live credential is configured.

## 12. Explicit exclusions

This specification does not implement or authorize:

- live payment acceptance or live Stripe credentials;
- recurring billing, subscriptions, invoices, payment links, or customer
  accounts;
- tax automation or accounting determinations;
- refunds, chargeback handling, cancellation after confirmation, renewal, or
  expiry operations;
- launch, invitations, guest access, public Event publication, or Event
  lifecycle changes;
- browser table writes, browser payment confirmation, or a provider-to-browser
  trust shortcut;
- any sharing of private Event/provider/payment data with catalog, vendor,
  place, map, recommendation, or administrative discovery surfaces.

## 13. Required Pap actions before implementation

1. Authorize a bounded implementation scope for this specification.
2. Create the non-recurring Sandbox Stripe Product/Price for **EpicentraX
   Private Event Passport — USD $24.00** when the implementation is ready for
   a sandbox runtime proof.
3. Provide sandbox secrets only through the protected server-environment path;
   never through source control or chat.
4. Give a separate explicit approval before any switch to live-mode credentials
   or real-money acceptance.
