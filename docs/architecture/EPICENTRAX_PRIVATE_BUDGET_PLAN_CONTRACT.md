# EpicentraX Private Budget Plan Contract

**Status:** Accepted architecture contract; implementation not yet authorized.
Amended 2026-09-08 to record the approved currency decision (§D).

**Date:** 2026-09-08 (amended 2026-09-08)

**Purpose:** Define a private workspace where the owner of an unfinished Draft
can record their own prospective and actual costs for that event — before any
payment, billing, invoicing, accounting, vendor contracting, or event
readiness attaches to it.

## Relationship to governing architecture

- `EPICENTRAX_PERSONAL_EVENT_PLANNING_LIFECYCLE.md` — the person-owned plan,
  the private Draft, "delete means delete," and the Passport/launch rules.
  This adds content inside that lifecycle and changes none of it. In
  particular, nothing here becomes a payment amount or a launch condition
  (§D, §F).
- `EPICENTRAX_SHARED_PLANNING_CATALOG_CONTRACT.md` — the shared/private split
  and the rule against a generic polymorphic planning table. A Budget Plan
  line item is private event content and is never a catalog asset, never a
  catalog reference, and never priced, benchmarked, or pre-filled from the
  catalog (§F).
- `EPICENTRAX_PRIVATE_VENDOR_PLAN_CONTRACT.md`,
  `EPICENTRAX_PRIVATE_VENUE_PLAN_CONTRACT.md`,
  `EPICENTRAX_PRIVATE_REGISTRY_PLAN_CONTRACT.md`, and
  `EPICENTRAX_PRIVATE_PLANNING_CHECKLIST_CONTRACT.md` — the sibling private
  planning tools. This one reuses their owner-only authority rule, privacy
  guarantees, deletion requirement, and additive-change discipline rather
  than inventing parallel ones. It does not read, link to, aggregate, or
  reconcile against any of them (§F).
- `EPICENTRAX_DOMAIN_MODEL.md` — authority is resolved server-side, never
  assumed from a screen or a role label.

## A. Purpose and non-goals

### Purpose

An organizer planning a private Draft usually has a rough number in mind for
almost everything — what the hall might cost, what they think catering will
run, what they actually paid for flowers once that was settled — and today
there is nowhere on this platform to write any of it down next to the event
it belongs to.

A **Budget Plan line item** is private, event-owned planning data belonging
to one self-service organizer Draft: a cost the organizer is tracking for
themselves, estimated, actual, or both.

Recording a cost is not paying it, billing it, invoicing it, contracting for
it, or making the event any more or less ready to launch.

### Non-goals

This contract does not define or authorize:

- schema, tables, migrations, RPCs, API routes, or UI code;
- payment processing, Passport purchase, checkout, or any commerce state;
- invoices, receipts, contracts, tax treatment, or reimbursements;
- contribution collection, bank or card information, or payment credentials
  of any kind;
- automatic import of any amount from a vendor, venue, registry, or catalog
  record, or from any other event's data;
- price lookup, benchmarking, or suggested amounts of any kind;
- totals or subtotals computed from any planning record other than the
  organizer's own Budget Plan line items (and, in this first capability, no
  totals or subtotals at all — see §D);
- provider or vendor contact, invitation, notification, or identity
  resolution;
- public, member, or guest-facing display of any budget content;
- readiness evaluation, launch gating, or any input to the Event's own
  readiness rules;
- exchange-rate lookup, currency conversion, currency normalization, or
  any live price feed of any kind (§D);
- a combined total across a USD line and a BTC line, or any other
  mixed-currency aggregate (§D);
- cryptocurrency wallets, addresses, private keys, or any crypto payment
  processing — BTC here is a private unit of account only, never a payment
  method or a transfer (§D, §F);
- currencies beyond USD and BTC, export, collaboration, or budget
  templates — each is recorded as an open decision (§I), not assumed.

## B. Lifecycle

```
organizer writes a line item   ─→   private Budget Plan line item   ─→   organizer edits,
(name, optional category,               (this capability)                re-estimates, records
 currency — USD by default,                                              an actual amount,
 switchable to BTC —,                                                    switches currency, or
 optional estimated amount,                                              deletes it
 optional actual amount,                                                       │
 optional private note)                                          (nothing else happens —
                                                                    no promotion, no payment,
                                                                    no catalog connection,
                                                                    ever)
```

**Entry.** The organizer types a line item. There is no other way one
appears, and there is no second way to enter one. Unlike the Vendor, Venue,
and Registry Plans, a Budget Plan line item has **no placeholder-versus-
catalog-asset duality** — it does not reference anything, now or later. This
is a permanent property of this capability, not a first-capability
limitation awaiting a catalog projection: a budget line item is always,
only, organizer-entered (§F).

**Life.** The item can be edited — name, category, either amount, the note
— by the owner alone, at any time, in any order. There is no required
sequence between entering an estimate and entering an actual amount; either
may exist alone, both may exist together, and neither implies the other
happened, was paid, or was committed to (§C).

**Exit.** The organizer deletes the item, or the Draft is deleted and the
item goes with it (§G). **There is no promotion path.** As with the
Checklist, no later governed step turns a Budget Plan line item into a
payment, an invoice, a Passport charge, a vendor commitment, or any other
operational record. It is a number the organizer wrote down so they could
read it back, and it ends when they are done with it.

## C. First field set and privacy treatment

| Field | Required | Privacy treatment |
| --- | --- | --- |
| Line-item name | Yes | Private event data. Free text as the organizer typed it — "Hall deposit," "DJ," "Aunt Ruth's cake." Never parsed, matched, or resolved against any vendor, venue, registry, or catalog record. |
| Category | No | Private, free text in this first capability. Deliberately **not** drawn from the Shared Planning Catalog's category list and not validated against any vendor, venue, or registry category — a Budget Plan has no catalog connection at all (§F). Whether a small, budget-specific fixed list ever replaces free text is an open decision (§I.9), and any such list would still not be the catalog's. |
| Currency | Yes | Private. Exactly one of **USD** or **BTC**, per line. Defaults to USD; the organizer may explicitly switch a given line to BTC. Governs the precision of that line's two amount fields (§D). Never inferred from the tenant, the organizer's location, or any other source, and never used to convert, benchmark, or aggregate across lines (§D). |
| Estimated amount | No | Private and commercially sensitive. A number the organizer entered for what they expect something to cost, in the line's own currency. Up to 2 fractional decimal places for a USD line, up to 8 for a BTC line (§D). Never aggregated, benchmarked, reported, or surfaced outside the owning Draft. |
| Actual amount | No | Private and commercially sensitive. A number the organizer entered for what something turned out to cost, by their own reckoning, in the line's own currency. **Its presence is not a payment record, a receipt, or proof that money moved through this platform** — the platform processes no payment here and has no way to know whether, how, or to whom anything was paid (§F). It is the organizer's own note to themselves, exactly like the estimate, and it always shares the same currency as the estimate on that line (§D). |
| Private note | No | Private, unstructured, and the most sensitive field. Never rendered anywhere but the owner's own view; never copied into audit, analytics, telemetry, error payloads, or the catalog. |

**Treatment rules for every field.** All of it is private event data with one
audience: the verified organizer-owner (§E). None of it is member-visible,
tenant-visible, provider-visible, or publicly visible. None of it flows into
the shared catalog, any operational table, any other planning record's
totals, or any deletion audit (§G). No route, URL, log line, telemetry
event, or error message may carry a line-item name, category, amount, or
note as identifying or content-bearing data; records are addressed only by
an opaque identifier.

**Deliberately absent from the first field set**, each recorded as a future
decision in §I rather than assumed: any currency beyond USD and BTC, an
ordering or rank, a due date or payment date, a paid/unpaid status, an
attachment or receipt image, and any link to a Vendor Plan, Venue Plan, or
Registry Plan record.

## D. Money, currency, rounding, and negative values — deliberate decisions

Nothing resembling currency, price, or a monetary minor unit exists anywhere
else in this platform's schema today. This capability is the first to
introduce a number meant to represent money, and every choice below is
deliberate rather than inherited from precedent.

**Currency — approved 2026-09-08.** This replaces the earlier position that
no currency field existed and that amounts were bare, unit-less numbers.
Every Budget Plan line item now carries a **Currency** field with exactly
two allowed values: **USD** and **BTC**. A new line defaults to USD. The
organizer may explicitly switch a given line to BTC at any time; there is no
other currency, no free-text currency, and no organizer-defined currency
list. Nothing infers the currency from the tenant, the organizer's account,
their location, or any other source — the default is a fixed platform
default, not a locale guess, and the switch to BTC is always a deliberate,
explicit act by the owner on that one line.

**One currency per line.** The Estimated amount and the Actual amount on a
single line item always share that line's one Currency value. There is no
way to estimate a cost in USD and record the actual cost of the same line
in BTC, or vice versa; changing a line's currency governs both amounts on
it together. An organizer who genuinely tracks the same real-world cost in
both units records it as two separate line items, each with its own
currency, name, and amounts — never as one line with a mixed currency.

**Precision.** A USD line supports up to **2 fractional decimal places** on
each amount field, matching the currency's ordinary minor unit. A BTC line
supports up to **8 fractional decimal places** on each amount field,
matching BTC's conventional precision (one satoshi = 0.00000001 BTC).
Precision is fixed per currency, not organizer-configurable, and a value
entered with more decimal places than its line's currency allows is
rejected rather than silently rounded.

**Negative values are rejected.** Both amount fields must be zero or
positive, in either currency. A Budget Plan line item is a prospective or
actual cost, not a ledger entry, and this capability does not model
credits, refunds, discounts represented as negative lines, or double-entry
bookkeeping of any kind. An organizer who overestimated simply edits the
number.

**No exchange-rate lookup, conversion, or normalization — none, ever,
without a separate contract.** This capability does not look up, store,
apply, cache, or estimate an exchange rate between USD and BTC or between
any other pair of units. It never converts an amount from the currency the
organizer entered into any other currency, never normalizes USD and BTC
line items into one implied unit for display or storage, and never calls
any external price feed, exchange, or market-data service. A BTC amount is
never silently treated as, compared to, or blended with a USD amount.

**No mixed-currency total.** This capability computes and displays no
total, subtotal, sum, average, or any other aggregate that combines a USD
line with a BTC line. If a total or subtotal is authorized later (§I.3), it
must be **exactly** this: private arithmetic performed only over the
organizer's own entered values, within their own Draft, kept **strictly
separate by currency** — a USD subtotal and a BTC subtotal, never combined
into one number, unless a wholly separate conversion contract is proposed,
reviewed, and approved on its own to authorize that combination. Absent
that future contract, "total" means "total per currency," full stop. No
future total, of any shape, may be presented, computed, or documented as a
readiness signal, an affordability judgment, financial advice, a payment
amount, a balance, an invoice total, or a launch/publish condition. A total
is a sum the organizer's own calculator would also produce; it must never
be given meaning the organizer did not put there themselves.

## E. Authority and event-state rules

**Owner.** A Budget Plan line item is readable and writable by exactly one
subject: the canonical organizer Person who owns the Draft, resolved
server-side through the existing self-service organizer path — the event's
private-draft record, its organizer appointment, and that appointment's
canonical person. The authenticated account proves access to that Person; it
is never itself the authority subject. This is the same predicate the
Agenda, Guest List, Vendor Plan, Venue Plan, Registry Plan, and Checklist
already use, and it should be reused rather than restated.

**Platform Administration has no routine read access.** Self-service private
drafts are already deliberately excluded from ordinary Platform Admin tenant
and event read policies; private budget planning inherits that exclusion
rather than reopening it. An organizer's prospective and actual spending is
household-financial content; it is not administrative reading material, and
an aggregate view across organizers of "who is spending what" is exactly the
kind of product this contract refuses to build.

**No tenant, vendor, venue, registry, or payment authority applies.**
Nothing here consults Event task authority, tenant admin authority, vendor
or venue catalog authority, registry authority, or any payment or Passport
authority, and nothing here grants any.

**Event state.** The capability applies to a self-service private Draft — an
event in `Draft` status, inactive, not visible to members, inside a tenant
flagged as a self-service private draft. This is the **exact, unfinished
Draft** the line item was created under; it is not shared across a person's
other Drafts (whether an organizer's own notes could ever follow them
between their own Drafts is an open decision, §I.10, and defaults to no
until decided). If the event is not in that Draft state, this surface does
not apply to it, and nothing here may change an event's state.

**Server-resolved, never client-asserted.** Ownership and event state are
determined server-side on every read and write; no browser-supplied owner
id, tenant id, or ownership assertion is trusted, and no raw-table browser
access is acceptable.

## F. Distinction from payment/Passport, sibling Plans, catalog/pricing data, and accounting

**Payment, Passport, checkout, invoices, receipts, contracts, tax,
reimbursements, and commerce state.** None of these exist in this platform
today — as the Registry Plan contract already establishes, there is no
payment, purchase, gift, order, or fulfillment table anywhere in the schema.
A Budget Plan's Estimated amount and Actual amount are numbers the organizer
typed, never a transaction, a payment record, a receipt, an invoice line, a
tax line, a reimbursement claim, or a contribution pledge. No field in this
capability may ever hold a bank account, card number, payment credential, or
any other commerce state; if a future field would need one, that is a
different capability with its own security review, not an addition here.
Passport is a lifecycle and payment concept in the personal event planning
lifecycle; recording a budget line item is free, requires no Passport, and
does not advance the Draft toward launch.

**BTC is a unit of account here, not a payment method.** Allowing a line
item's Currency to be BTC (§D) is a private numbering choice, exactly like
allowing it to be USD — it is not a cryptocurrency payment, a wallet, a
transfer, an on-chain transaction, or any step toward one. This capability
stores no wallet address, no private or public key, no seed phrase, and no
blockchain reference of any kind, and it never calls a blockchain, an
exchange, or any crypto price feed. An organizer recording "0.015 BTC" for
a line item has written down a number in a unit they chose, in exactly the
same sense as writing down "500" for a USD line — nothing more.

**The Vendor Plan, Venue Plan, and Registry Plan.** Each sibling capability
is a private, event-owned *reference* to a prospective resource — who,
where, or what registry — with its own placeholder/catalog duality and its
own (unspecified) later promotion path. A Budget Plan line item is neither:
it references nothing and promotes to nothing (§B). It also does not read
from its siblings. Entering "$500, DJ" in the Budget Plan does not read,
link to, aggregate, import, or reconcile against a Vendor Plan record for a
DJ, whether by name matching, category matching, or any other inference.
The Vendor Plan contract's own field set lists an optional "Estimated cost
or quote" field; as shipped, that field was deliberately **not** added to
schema, because the contract left financial semantics and currency as an
open decision. This Budget Plan contract does not resolve that field's
fate, does not migrate or backfill it, and is not its replacement. If that
Vendor Plan field is implemented in the future, it remains vendor-record-
scoped private data: a Budget Plan line item never reads, imports, or
totals against it, and it never reads or totals against a Budget Plan line
item. The two lists may describe the same real-world spend and remain
entirely uncoordinated, by design (boundary §C.1 of the shared catalog
contract's non-goals; enforced here explicitly).

**Pricing and catalog data.** The Shared Planning Catalog governs reusable
descriptions of real-world venues, caterers, entertainers, and the like;
nothing in it carries a price, and a Budget Plan line item never connects to
it in any direction. A Budget Plan cannot look up, suggest, benchmark, or
pre-fill an amount from any catalog asset, any other event's spending, any
vendor or venue record, or any external price source. Every number here is
organizer-entered, full stop; a category or name that happens to match a
catalog asset is coincidence, not linkage.

**Accounting.** A Budget Plan is not a ledger, a journal, a chart of
accounts, a balance sheet, or a bookkeeping system. It has no debits,
credits, running balance, reconciliation, closing period, or audit trail
beyond ordinary private note-taking. It produces no financial statement and
satisfies no accounting, tax, or reporting obligation of the organizer's,
the tenant's, or the platform's. It is closer in kind to the Checklist — a
private notebook with numbers in it instead of checkboxes — than to any
financial system this platform might build later.

**Vendor admission, event readiness, and identity.** Nothing here writes
`vendors`, `event_vendors`, candidacies, dispositions, or vendor access.
Nothing here is an input to the Event's own readiness rules, exactly as the
Checklist is not (§F of that contract) — a fully filled-in budget says
nothing about whether the event is ready, and an empty one says nothing
either. Nothing here creates, resolves, merges, or touches a Person; a
line-item name or note is never identity data.

## G. Deletion, retention, and promotion

**Draft deletion removes the budget plan.** Budget Plan line items are
event-owned. When an unlaunched Draft is permanently deleted under "delete
means delete," these rows are deleted with it — really deleted, not hidden
or soft-deleted.

**Same-change requirement.** The governed self-service deletion path
(`delete_self_service_organizer_event`) enumerates a Draft's expected
children explicitly and fails closed on anything unexpected; adding a child
table has already once required a repair to that path. Any implementation
must therefore extend the governed deletion path **in the same migration
that introduces these rows** — never afterwards, and never by relying on
cascade behavior alone. The cleanup belongs with its siblings, before the
fail-closed dependency scan.

**The deletion audit stays minimal, content-free, and — for this capability
— total-free.** The audit records only identifiers and counts of rows
deleted, exactly as it does for the sibling capabilities, with one point
stated more sharply here because money invites the exception: **not even an
aggregate amount, in any currency, or a line-item count may appear** in the
deletion audit row, a route URL, an application log line, a telemetry
event, or a content-bearing error message. "Deleted 4 budget items totaling
$2,300" is precisely the sentence this boundary forbids, and so is "Deleted
2 BTC-denominated items" — the count and the total are both private
financial content regardless of which of the two allowed currencies they
are in, not innocuous metadata, in exactly the way the Checklist contract
already establishes that a count of someone's private reminders is still
information about their private reminders.

**Nothing else is deleted.** Removing a Draft removes that Draft's line
items. It has no effect on any Vendor Plan, Venue Plan, Registry Plan, or
Checklist record, and no effect on any shared catalog asset — there was
never a link to any of them to begin with (§F).

**No promotion.** As §B states, there is deliberately no path out of this
workspace. A Budget Plan line item is never promoted, converted, invoiced,
paid, or reconciled into anything else, now or as a future capability
without its own separate contract and its own separate authorization.

**Archive.** For a launched event the lifecycle word is Archive, not
Delete, per the personal event planning lifecycle. Budget Plan data
retained under archive stays owner-private; archiving does not make it
visible, compute a total from it, or treat it as a financial record of the
launched event.

## H. Scope and exclusions

**In scope for a first capability.** For the owner of one self-service
private Draft: create, read, edit, and delete their own Budget Plan line
items, with the §C fields — including the per-line Currency choice between
USD (default) and BTC, and each currency's own precision (§D). Owner and
event state resolved server-side. Governed deletion path extended in the
same migration.

**Explicitly excluded:**

- automatic import of any amount from a vendor, venue, registry, or catalog
  record, or from any other event;
- price lookup, benchmarking, suggested amounts, or any external financial
  service call;
- exchange-rate lookup, currency conversion, currency normalization, or any
  live price feed between USD and BTC or any other pair of units (§D);
- a combined total or subtotal across a USD line and a BTC line, or any
  other mixed-currency aggregate, unless a separate conversion contract is
  proposed and approved on its own (§D);
- totals, subtotals, or any aggregate computed across records other than
  the organizer's own line items in their own Draft, and — in this first
  capability — no totals or subtotals at all, per-currency or otherwise;
- payment processing, Passport purchase, checkout, invoices, receipts,
  contracts, tax treatment, reimbursements, or contribution collection;
- bank information, card information, payment credentials, cryptocurrency
  wallets, addresses, private keys, or any other commerce or crypto-payment
  state (§D, §F);
- provider or vendor contact, invitation, notification, or identity
  resolution;
- public, member, tenant, or provider-facing display of any budget content;
- any effect on event status, readiness, launch, or Passport;
- linkage, cross-reference, or commercial claim tied to a chosen Vendor,
  Venue/Place, or Registry record;
- any currency beyond USD and BTC, a free-text or organizer-defined
  currency, export, collaboration, or budget templates;
- sharing with co-planners, members, guests, vendors, or tenants;
- applying this surface to launched, public, or ordinary tenant events.

**One record shape, not a generic one.** This capability gets its own model
suited to budget line items. It must not be merged with the Vendor Plan,
Venue Plan, Registry Plan, Checklist, or anything else into a generic
polymorphic planning table — the catalog contract forbids that, and the
field sets already differ (two amount fields and no status vocabulary here;
a three-word status vocabulary and no amounts on the siblings). What is
shared between them is behavior — owner-only authority, privacy, deletion
discipline — not storage.

**Additive change discipline.** As with the sibling capabilities, any later
change to this field set adds nullable columns and appends optional,
defaulted parameters; it never renames, retypes, reorders, or removes what
exists. That is what allows a schema change to land ahead of an application
deploy.

## I. Open decisions

Recorded as future decisions. None is implied or committed, and none may be
resolved in a way that reopens §D's negative-value, one-currency-per-line,
or no-conversion rules without its own review.

1. **Currencies beyond USD and BTC — PARTIALLY RESOLVED 2026-09-08.**
   Decided and no longer open: every line has a currency; it defaults to
   USD; an organizer may explicitly switch a line to BTC; USD supports up
   to 2 decimal places and BTC up to 8; the estimated and actual amounts on
   one line always share that line's currency; amounts are non-negative;
   and no exchange-rate lookup, conversion, normalization, or
   mixed-currency total is authorized (§D). Still open: whether a third or
   further currency is ever added, whether an organizer-defined or
   free-text currency is ever allowed, and what — if anything — changes
   about totals if one is. Any future total remains separate by currency
   unless a wholly separate conversion contract is proposed, reviewed, and
   approved on its own (§D, §I.3). (Kept at this number so earlier
   references to "open decision 1" still resolve.)
2. **Estimate versus actual semantics.** Whether entering an Actual amount
   should ever be treated as implying the estimate was superseded,
   confirmed, or closed out, versus the two remaining two independent
   numbers forever with no relationship enforced between them. Today they
   are independent; nothing infers "paid," "committed," or "final" from
   either being present (§C, §F).
3. **Totals and subtotals.** Whether and how a private sum is ever shown,
   subject in full to the constraints already stated in §D — private
   arithmetic over the organizer's own values only, kept strictly separate
   by currency (a USD subtotal and a BTC subtotal, never combined into one
   number) unless a separate conversion contract is proposed and approved
   on its own, and never presented as readiness, affordability advice, a
   payment amount, or a launch condition.
4. **Export.** Whether an organizer may ever export their own Budget Plan
   (e.g. as a spreadsheet) for their own use outside the platform, and what
   privacy handling that export would need — it would leave the platform's
   own guarantees behind the moment it did.
5. **Collaboration.** Whether a co-planner could ever see or edit line
   items. Out of scope while an event has exactly one owner; revisit only
   if co-organizers arrive, exactly as the Checklist contract holds open.
6. **Budget templates.** Whether an organizer may save and reuse *their
   own* category set or line items across their own events, versus any
   platform-supplied starter budget — which would need its own review, in
   the same spirit as the Checklist's prohibition on seeded items (§B.1 of
   that contract).
7. **Post-launch behavior.** What happens to Budget Plan line items when a
   Draft is published — retained owner-private, archived, or discarded.
8. **Any eventual payment link.** Whether a future, entirely separate
   capability could let an organizer move from a Budget Plan line item
   toward an actual payment (e.g. a Passport-adjacent purchase). Nothing in
   this contract authorizes, designs, or assumes such a link; it would
   require its own product decision, its own security review, and its own
   contract, and would not retroactively change what a Budget Plan line
   item has meant up to that point.
9. **Category list.** Whether free text is replaced by a small,
   budget-specific fixed list, and if so, who curates it. Any such list
   remains independent of the Shared Planning Catalog's categories (§C, §F).
10. **Cross-Draft reuse.** Whether an organizer's own line items may ever be
    copied from one of their Drafts to another, or carried when a Draft is
    deleted and restarted. Undecided; today a line item belongs to the
    exact Draft it was created under and nothing else (§E).
11. **Entry limits.** Whether line items per Draft are capped, and how that
    interacts with the one-active-project quota.
