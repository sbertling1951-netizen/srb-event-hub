// Shared legacy Event status/presentation helpers (ADR-013 §12 stage 5:
// consolidation of the seven independent isActiveEventStatus /
// normalizeEventStatus / isMemberVisibleEvent(Status) implementations
// identified by the Lifecycle audit, previously duplicated across
// app/admin/events/page.tsx, app/admin/dashboard/page.tsx,
// app/admin/attendees/page.tsx, app/member/activate/page.tsx,
// app/member/login/page.tsx, and
// app/api/member/identity-claim/evaluate/route.ts).
//
// These govern the legacy `status`/`is_active`/`visible_to_members`
// columns only -- presentation and discovery logic per ADR-006 §4. They
// are NOT Event Lifecycle (ADR-013): do not call
// event_effective_lifecycle_state() from here, and do not read
// lifecycle_state here. The two concepts stay separate; this module only
// removes duplication within the legacy one.
//
// Two distinct, non-interchangeable predicates existed before this
// consolidation and remain distinct here -- merging them would be a real
// behavior change, not a duplication removal:
//   - isActiveEventStatus: an admin-side POSITIVE allowlist (a status must
//     match an active-sounding keyword to count as active; an unrecognized
//     custom status is NOT active).
//   - isMemberVisibleEvent(Status): a member-side NEGATIVE denylist (a
//     status is visible unless it matches a known excluded keyword; an
//     unrecognized custom status IS visible).

export function normalizeEventStatus(status?: string | null): string {
  return String(status || "")
    .trim()
    .toLowerCase();
}

// Admin-side "is this the active/current status" check. Canonicalized on
// the version already shared, byte-for-byte, by app/admin/events/page.tsx
// and app/admin/attendees/page.tsx -- both excluded "draft" from the
// negative list. app/admin/dashboard/page.tsx's copy omitted "draft"
// (ADR-013 §2's "confirmed behavioral divergence," contrasted there
// against "the other three admin/member pairs," all of which exclude it);
// that omission is treated as the proven-erroneous outlier and corrected
// here, not preserved as a third variant.
export function isActiveEventStatus(status?: string | null): boolean {
  const normalized = normalizeEventStatus(status);

  if (!normalized) {
    return false;
  }

  if (
    normalized === "inactive" ||
    normalized === "complete" ||
    normalized === "completed" ||
    normalized === "closed" ||
    normalized === "archived" ||
    normalized === "draft"
  ) {
    return false;
  }

  return (
    normalized === "active" ||
    normalized === "live" ||
    normalized === "open" ||
    normalized === "current" ||
    normalized.includes("active")
  );
}

// Member-side "is this status one that hides the Event" check -- the
// status-only core shared by isMemberVisibleEvent below and by
// app/api/member/identity-claim/evaluate/route.ts, which only ever has a
// bare status string available at its call site (it composes this with
// its own inline visible_to_members/is_active checks, unchanged here).
export function isMemberVisibleEventStatus(status?: string | null): boolean {
  const normalized = normalizeEventStatus(status);

  return ![
    "inactive",
    "archived",
    "complete",
    "completed",
    "closed",
    "draft",
  ].includes(normalized);
}

export type MemberVisibilityEventFields = {
  status?: string | null;
  is_active?: boolean | null;
  visible_to_members?: boolean | null;
};

// Member-side full visibility check for callers holding a full Event row:
// app/member/activate/page.tsx and app/member/login/page.tsx previously
// each defined this identically (same exclusion set, same
// visible_to_members/is_active gating, different code style only).
export function isMemberVisibleEvent(event: MemberVisibilityEventFields): boolean {
  if (event.visible_to_members === false) {
    return false;
  }

  if (event.is_active === false) {
    return false;
  }

  return isMemberVisibleEventStatus(event.status);
}
