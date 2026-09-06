# EpicentraX Self-Service Onboarding P-2A Implementation Specification

**Status:** Accepted and authorized for implementation

**Date:** 2026-09-05

## 1. Purpose

P-2A delivers the smallest safe self-service beginning for a new organizer:

> verified account -> private organization and Event draft -> Organizer
> workspace

It implements no guest-facing access, payment, invitation, hostname,
commercial entitlement, media upload, or broad Event-module configuration.
FCOC and every existing Platform, Tenant, and Event administration flow are
preserved and are not a P-2A migration target.

## 2. Authority model

P-2A/P-2B introduces a narrowly scoped Organizer appointment for a verified
EpicentraX account's own self-service Tenant and private draft Event. The
appointment references the organizer's **resolved canonical Person**
(`public.people.id`); it retains `auth_user_id` only as the authenticated-
account linkage and idempotency fact. It is distinct from Platform
Administrator, Tenant Administrator, Event Administrator, and a Person-Tenant
administrator appointment, and it grants no access to FCOC or any other
Tenant.

Identity resolution precedes appointment and draft creation. A returning
verified person reuses her existing canonical Person; a genuinely new verified
person may receive exactly one newly created canonical Person only through the
established governed, audited identity-resolution pattern. P-2B must not
silently match, merge, or infer a Person from a matching email address: an
uncertain prior identity halts the command and routes the organizer through
the existing controlled identity-claim verification first.

The Organizer appointment is the sole P-2A authority fact. It allows only the
new P-2A private-draft read and workspace surfaces. A later, separately
designed promotion may connect an Organizer to broader administrative
authority after the necessary identity and appointment facts are established.

## 3. Governed creation command

One authenticated, server-governed, idempotent command creates the required
records atomically. Its actor is derived only from `auth.uid()` and verified
server-side account evidence. It accepts no caller-supplied Tenant, Event,
Person, administrator, status, visibility, hostname, Event-code, payment, or
authority value.

The command requires a verified account email, validates the limited private
draft inputs, then resolves the actor's canonical Person (§2), and either
completes all of the following or persists nothing:

1. creates a new Tenant inactive-first, with system-generated internal aliases
   and no hostname;
2. records the Organizer appointment for the authenticated account's resolved
   canonical Person;
3. activates the new Tenant through a distinct audited onboarding action; and
4. creates exactly one explicitly Tenant-owned Event with `Draft` status,
   `is_active = false`, and `visible_to_members = false`.

The command records immutable, non-PII onboarding and idempotency evidence.
An identical retry returns the original outcome; reuse of an idempotency key
with different input fails closed. Browser roles receive no direct table-write
permission.

## 4. Organizer experience

P-2A adds a dedicated `/organize` route family rather than reusing `/admin` or
the Member workspace. A visitor is directed to sign in or create a free
EpicentraX account. An authenticated account with an unverified email cannot
create a draft. A verified organizer may enter only the basic private draft
facts: organization name, Event name, scheduled date/range, IANA time zone,
location or online/no-location, and a starter template.

New-account verification email returns through the one fixed organizer-aware
auth callback (`/auth/callback?purpose=organizer`), which establishes the
session through the existing safe callback mechanism and lands at `/organize`.
No caller-supplied redirect URL is accepted. This depends on external Supabase
Auth configuration: the callback base URL must be present in the project's
Redirect URL allow-list (the same base the member recovery and identity-claim
flows already use).

The resulting workspace clearly says **Private draft - not live**. It shows
the Event's basic details and a launch-readiness guide, but it provides no
guest access, sharing, public registration, invitation, payment, or launch
operation in P-2A.

P-2A initially requires a real scheduled end date and IANA time zone. The
accepted product option for a TBA Event remains valid, but needs its own
explicit schedule/lifecycle design before it can be stored without inventing
a date or weakening the lifecycle fail-closed rule.

## 5. Non-negotiable safety rules

- FCOC is neither read nor changed by P-2A and remains commercially exempt.
- No Platform Administrator, `admin_users` record, Tenant Administrator,
  Event Administrator, Person-Tenant administrator appointment, attendee,
  Event code, hostname, payment, media, or invitation is created by
  P-2A/P-2B.
- Canonical Person identity is not account-only. A returning verified person
  reuses her existing `public.people.id` and account link unchanged. A
  genuinely new verified person may have exactly one canonical Person and one
  active-primary `person_auth_accounts` link created for them, through the
  existing governed, audited resolver (`public.person_resolution_audit`,
  `created_new` / no-prior-evidence outcome) -- and ONLY when the
  server-verified contact touches **none** of the canonical evidence sources
  the identity-claim engine uses: no `person_identifiers` row, no
  `person_role_instances` (attendee pilot/copilot or household-member
  contact), no unresolved attendee or household-member row, and no disputed
  identifier. Any single hit is a possible prior identity: the command creates
  no Person, account link, Tenant, appointment, or Event, and returns a
  non-enumerating explicit outcome (`identity_confirmation_required` /
  `identity_review_required`) that routes the organizer through the existing
  identity-claim verification.
- An uncertain safe outcome is bound durably to (authenticated actor,
  idempotency key, request fingerprint) in an append-only ledger
  (`self_service_onboarding_safe_outcome_ledger`, one row, linked to the one
  retained `person_resolution_audit` row). A retry with the same key + same
  input replays that outcome with no second resolution, audit, or downstream
  write; a retry with the same key + changed input conflicts exactly as a
  draft does. Creating the draft after external identity verification is a
  deliberate new attempt with a fresh idempotency key.
- No email, name, IP address, browser state, or existing participation is used
  to *infer* canonical Person identity, and no Person is silently matched or
  merged. Only the server-verified Auth email/phone is used as correlation
  evidence, and only through the existing controlled resolution/verification
  process.
- A private P-2A Event is not discoverable or accessible through existing
  member, public, Temporary Event Access, or Admin pathways.
- A P-2A private self-service organization and its private Draft Event are
  excluded from **every** ordinary existing Platform / Tenant Administration
  surface -- the governed admin RPCs (tenant list/detail, owned-Event list,
  hostname-mapping list, admin-assignment list, administration-audit list,
  metadata-update, active-status) each return the same non-disclosing
  `Tenant not found.` as for a missing tenant id (non-enumerating), **and**
  the direct authenticated RLS read/write surfaces (the tenants
  Platform-recovery SELECT policy; the events authenticated-SELECT and
  admin-UPDATE policies) each exclude private-draft rows. Only an explicit
  P-2A Organizer appointment may see or change them, through the P-2A
  workspace's own `SECURITY DEFINER`, `auth.uid()`-scoped RPCs. An
  exceptional platform support path for these organizations is deferred to its
  own separate governed design; P-2A does not weaken any global Platform /
  Tenant / Event authority predicate to achieve this exclusion -- only the row
  set each RPC / policy exposes.
- All privileged creation and authority facts are server-side, auditable, and
  fail closed when identity, authorization, input, or retry evidence is
  uncertain.

## 6. Acceptance evidence

Implementation must prove at minimum: anonymous and unverified attempts are
denied; a verified organizer gets exactly one active Tenant, Organizer
appointment, and hidden Draft Event; retries are idempotent; failures leave no
partial records; an Organizer can read only their own draft; no regular
browser role gains raw writes; and existing FCOC/Platform/Tenant/Event
administrative authority remains unchanged.
