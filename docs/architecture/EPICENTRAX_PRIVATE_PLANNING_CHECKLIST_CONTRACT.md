# EpicentraX Private Planning Checklist Contract

**Status:** Accepted architecture contract; implementation not yet authorized

**Date:** 2026-09-08

**Purpose:** Define a private, blank, organizer-authored checklist for an
unfinished Draft — a place to keep one's own reminders, and nothing more.

## Relationship to governing architecture

- `EPICENTRAX_PERSONAL_EVENT_PLANNING_LIFECYCLE.md` — the person-owned plan,
  the private Draft, "delete means delete," and the Passport/launch rules
  including the Event's own **readiness rules**. This adds content inside that
  lifecycle and changes none of it. In particular it does not become, feed,
  or approximate those readiness rules (§F).
- `EPICENTRAX_SHARED_PLANNING_CATALOG_CONTRACT.md` — the shared/private split.
  A checklist item is private event content and is **never** a catalog asset:
  nobody else's checklist is knowledge this platform shares.
- `EPICENTRAX_PRIVATE_VENDOR_PLAN_CONTRACT.md`,
  `EPICENTRAX_PRIVATE_VENUE_PLAN_CONTRACT.md`, and
  `EPICENTRAX_PRIVATE_REGISTRY_PLAN_CONTRACT.md` — the sibling private
  planning tools. This one reuses their owner-only authority rule, privacy
  guarantees, deletion requirement, and additive-change discipline rather than
  inventing parallel ones.

## A. Purpose and non-goals

### Purpose

Every organizer keeps a list somewhere — on paper, in a phone note, in their
head. "Call the hall back." "Ask Mum about the cake." "Count chairs." None of
it is EpicentraX's business to define, and all of it is worth keeping in one
place next to the event it belongs to.

A **checklist item** is private, event-owned planning data belonging to one
self-service organizer Draft: something the organizer wrote down for
themselves, with a box they can tick.

### Non-goals

This contract does not define or authorize:

- schema, tables, migrations, RPCs, API routes, or UI code;
- seeded, canned, suggested, templated, generated, or AI-authored items;
- any prescribed sequence, phase, milestone, or "recommended next step";
- progress bars, percentages, scores, grades, or completion signals shown
  anywhere outside the owner's own list;
- readiness evaluation, launch gating, or any input to the Event's own
  readiness rules;
- notifications, reminders, emails, push, digests, or nudges;
- calendar sync, iCal export, or any external service call;
- assignment, delegation, sharing, comments, or collaboration;
- public, member, guest, vendor, tenant, or admin visibility;
- a general workflow engine, approval flow, or task-authority system.

## B. The three statements that govern this feature

These are the rules an implementer should re-read before adding anything.

**1. It is a blank notebook with checkboxes, not a plan imposed by
EpicentraX.** The list starts empty and stays empty until the organizer writes
in it. EpicentraX contributes no items, suggests none, orders none by
importance, and never says what a "birthday" or a "wedding" ought to involve.
The organizer knows their event; this platform does not.

**2. An empty checklist says nothing about whether the event is ready.** An
organizer who keeps their list on paper, or in their head, or nowhere, is not
behind. Emptiness must never be rendered as a warning, a nag, an incomplete
state, or a lower score.

**3. Marking every item complete says nothing about whether the event is
ready.** All-ticked is not a green light, a readiness signal, or an
eligibility condition for anything. The Event's readiness rules are defined
elsewhere and do not consult this list (§F).

Any feature that would make one of these three statements false is a different
feature, requiring its own contract.

## C. Lifecycle

```
organizer writes an item  ─→  private checklist item  ─→  organizer ticks it
                                (this capability)          or deletes it
                                                                │
                                                   (nothing else happens)
```

**Entry.** The organizer types an item. There is no other way one appears.

**Life.** The item can be edited, ticked, un-ticked, and deleted, all by the
owner alone. Ticking is a personal marker and is fully reversible; nothing
observes the transition and nothing is recorded about it beyond the state
itself.

**Exit.** The organizer deletes the item, or the Draft is deleted and the item
goes with it (§G). **There is no promotion path.** Unlike the Vendor, Venue,
and Registry Plans, a checklist item never becomes anything operational — no
later governed step turns it into a task, an assignment, an agenda entry, or a
readiness condition. It is a note that ends when the organizer is done with it.

## D. First field set and privacy treatment

| Field | Required | Privacy treatment |
| --- | --- | --- |
| Title | Yes | Private event data. Free text as the organizer typed it. Never parsed for intent, keywords, dates, entities, or categories; never matched to a suggestion list or a template. |
| Private note | No | Private and unstructured. Never rendered anywhere but the owner's own view; never copied into audit, analytics, telemetry, error payloads, or any shared surface. |
| Target date | No | Private. **A date the organizer wrote down, not a scheduled event.** Nothing acts on it: no reminder, no notification, no calendar entry, no overdue state, no sorting obligation, no escalation. A date in the past is simply a date in the past. |
| Completion | Yes | Private boolean marker, defaulting to not-done and freely reversible. It is a tick in the owner's own notebook — it changes nothing else, anywhere (§B.3, §F). |

**Treatment rules for every field.** All of it is private event data with one
audience: the verified organizer-owner (§E). None of it is member-visible,
guest-visible, tenant-visible, vendor-visible, or publicly visible. None of it
flows into the shared catalog, any operational table, any readiness
calculation, or any deletion audit (§G).

**The target date deserves its own line**, because it is the field most likely
to attract an "obvious" addition: a reminder, an overdue badge, a daily digest,
a calendar push. Every one of those turns a private note into an outbound
action the organizer never asked for, and §A forbids them all. If reminders
are ever wanted, that is a separate capability with a separate consent
question (§I.5).

**Deliberately absent from the first field set**, each recorded as a future
decision in §I: explicit ordering or rank, a time-of-day component, recurrence,
category or tag, assignee, and any link to another planning record.

## E. Authority and event-state rules

**Owner.** A checklist item is readable and writable by exactly one subject:
the canonical organizer Person who owns the Draft, resolved server-side
through the existing self-service organizer path — the event's private-draft
record, its organizer appointment, and that appointment's canonical person.
The authenticated account proves access to that Person; it is never itself the
authority subject. This is the same predicate the Agenda, Guest List, Vendor
Plan, Venue Plan, and Registry Plan already use, and it should be reused
rather than restated.

**Platform Administration has no routine read access.** Self-service private
drafts are already deliberately excluded from ordinary Platform Admin tenant
and event read policies; a private checklist inherits that exclusion rather
than reopening it. Someone's private reminders are not administrative reading
material, and an aggregate view of "how far along organizers are" is exactly
the product this contract refuses to build.

**No tenant, vendor, member, or task authority applies.** Nothing here
consults Event task authority, tenant admin authority, vendor authority, or
any member-facing read path, and nothing here grants any.

**Event state.** The capability applies to a self-service private Draft — an
event in `Draft` status, inactive, not visible to members, inside a tenant
flagged as a self-service private draft. Draft use is explicitly allowed and
remains entirely non-public. If the event is not in that state, this surface
does not apply to it, and nothing here may change an event's state.

**Server-resolved, never client-asserted.** Ownership and event state are
determined server-side on every read and write; no browser-supplied owner id,
tenant id, or ownership assertion is trusted, and no raw-table browser access
is acceptable.

## F. Separation from existing systems

**The Agenda.** `agenda_items` is the event's **schedule** — what happens at
the event, for the people attending it. It carries times, dates, locations,
speakers, sort order, template linkage, and an `is_published` flag, with its
own versioned `event_agenda_state` and its own governed command path. It is
attendee-facing content that can become visible.

A checklist is the opposite in every respect: what the *organizer* must do
*before* the event, seen by nobody else, never published, never ordered into a
programme. "Call the hall" is a checklist item; "3:00 Welcome" is an agenda
item. An implementation must not store checklist items in `agenda_items`,
must not give them a publish flag, and must not surface them in any agenda
read path.

**Event readiness and launch.** The organizer workspace already carries a
distinct **"Launch readiness"** section, and the personal event planning
lifecycle defines real *readiness rules* that gate the Publish/Launch
transition. Those rules are defined elsewhere and are about the Event record
itself. **The checklist is not an input to them, and they are not a
description of the checklist.** Specifically: launch must never require any
item to be complete; readiness must never be computed from item counts or
completion ratios; and no readiness surface may render checklist progress.
The two sit near each other in the UI, which makes stating this explicitly
worth the words.

**`admin_task_registry`.** The schema already contains a table of that name.
It is the administrative **authority task** catalog — `task_key`, `scope`,
`task_kind`, `platform_inherits`, `tenant_inherits`,
`event_assignment_grantable` — that governs who may do what. It is a
permission system, not a to-do list. A private checklist must not extend,
join to, read, write, or draw naming inspiration from it, and must never be
used as a substitute for it. Any new table here should be named so the two can
never be confused.

**Calendars and reminders.** Nothing here schedules, notifies, syncs,
exports, or emails. A target date is inert text-adjacent data (§D). The
platform has no reminder infrastructure and this capability does not create
one.

**Invitations and collaboration.** Nothing in a checklist reaches another
person. No item can be assigned, shared, delegated, commented on, or made
visible to a co-planner, guest, member, or vendor. There is exactly one
audience.

**Operational workflow.** This is not a workflow engine. There are no states
beyond done/not-done, no transitions, no approvals, no gates, no SLAs, no
escalation, and no audit trail of who ticked what when — because there is only
ever one person who could have.

**The shared catalog.** A checklist item is never a catalog asset and never a
reference to one. Someone's private reminders are not shareable platform
knowledge, and no contribution path from a checklist to the catalog exists or
is contemplated.

## G. Deletion, retention, and promotion

**Draft deletion removes the checklist.** Checklist items are event-owned.
When an unlaunched Draft is permanently deleted under "delete means delete,"
these rows are deleted with it — really deleted, not hidden or soft-deleted.

**Same-change requirement.** The governed self-service deletion path
enumerates a Draft's expected children explicitly and fails closed on anything
unexpected; adding a child table has already once required a repair to that
path. Any implementation must therefore extend the governed deletion path **in
the same change that introduces these rows** — never afterwards, and never by
relying on cascade behavior alone. The cleanup belongs with its siblings,
before the fail-closed dependency scan.

**The deletion audit stays minimal and content-free.** It records only
identifiers and counts. It must never gain an item title, note, target date,
completion state, or item count — a count of someone's private reminders is
still information about their private reminders.

**Archive.** For a launched event the lifecycle word is Archive, not Delete.
Checklist data retained under archive stays owner-private; archiving does not
make it visible.

**No promotion.** As §C states, there is deliberately no path out of this
workspace. Nothing here is ever promoted, published, assigned, or converted.

## H. Scope and exclusions

**In scope for a first capability.** For the owner of one self-service private
Draft: create, read, edit, tick/untick, and delete their own checklist items,
with the §D fields. Owner and event state resolved server-side. Governed
deletion path extended in the same change.

**Explicitly excluded:**

- seeded, canned, suggested, templated, generated, or AI-authored items;
- any prescribed order, phase, milestone, or recommended next step;
- progress bars, percentages, scores, or completion signals outside the list;
- any effect on event status, readiness, launch, visibility, location, agenda,
  guest access, vendor status, registry publication, Passport, or payment;
- notifications, reminders, digests, emails, push, or nudges;
- calendar sync, iCal, or any external service call;
- assignment, delegation, sharing, comments, or collaboration;
- public, member, guest, vendor, tenant, or admin read surfaces;
- use as a workflow engine, approval flow, or task-authority system, or as any
  substitute for `admin_task_registry`;
- applying this surface to launched, public, or ordinary tenant events.

**One record shape, not a generic one.** This capability gets its own model.
It must not be merged with the Vendor Plan, Venue Plan, Registry Plan, Guest
List, or Agenda into a generic polymorphic planning table — the catalog
contract forbids that, and the field sets already differ. What is shared
between them is behavior — privacy, authority, deletion — not storage.

**Additive change discipline.** As with the sibling capabilities, any later
change to this field set adds nullable columns and appends optional, defaulted
parameters; it never renames, retypes, reorders, or removes what exists.

## I. Open decisions

Recorded as future decisions. None is implied or committed, and none may be
resolved in a way that falsifies §B.

1. **Ordering.** Whether items carry an explicit rank the organizer controls,
   or simply appear in creation order. Undecided. Any ordering must be the
   organizer's own; EpicentraX must not order by importance, urgency, or a
   suggested sequence.
2. **Time of day.** Whether the target date gains a time component. Undecided,
   and coupled to §I.5 — a time is only meaningful if something acts on it,
   and today nothing may.
3. **Recurrence.** Whether an item can repeat. Undecided; recurrence implies a
   generator, which sits close to the seeded-items prohibition.
4. **Templates.** Whether an organizer may save and reuse *their own* list
   across their own events. Note the sharp line: a personal reusable list is
   plausible; a platform-supplied starter list is forbidden by §B.1 and would
   need that statement changed first.
5. **Reminders.** Whether any notification is ever attached. This is the
   largest open question and would require, at minimum: an explicit per-item
   opt-in, a delivery channel this platform does not yet have, a consent and
   quiet-hours design, and a decision about what a missed reminder means.
   **None of it is authorized by recording a date.**
6. **Collaboration.** Whether a co-planner could ever see or tick items. Out
   of scope while an event has exactly one owner; revisit only if
   co-organizers arrive.
7. **Completion timestamp.** Whether ticking records *when* it happened, and
   whether that is useful to the owner or merely surveillance of their own
   pace. Undecided; the first field set stores state only.
8. **Post-launch behavior.** What happens to checklist items when a Draft is
   published — retained owner-private, archived, or discarded.
9. **Item limits.** Whether items per Draft are capped, and how that interacts
   with the one-active-project quota.
