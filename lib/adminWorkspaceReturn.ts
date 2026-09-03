// Owner-workspace return-navigation contract. When one Admin surface hands
// the operator to a canonical status owner (Attendees -> Check-In / Parking
// via a status pill), it may carry a `returnTo` key naming the originating
// workspace. The destination renders a "← Previous" control that routes
// back to that workspace.
//
// This is NOT browser history/back. `returnTo` is an opaque key resolved
// ONLY against the fixed allow-list below -- an unknown key yields no
// Previous control, and no free-form path is ever accepted, so an
// open-redirect or an off-app destination is structurally impossible. The
// key rides in the URL, so a refresh keeps the Previous control working;
// direct navigation without the key simply shows no Previous control.
//
// It is deliberately independent of the attendee-target contract
// (lib/adminAttendeeTarget.ts): the two params compose but neither depends
// on the other, and neither carries an Event switch (ADR-006 §2).

export const ADMIN_RETURN_PARAM = "returnTo";

/**
 * The only workspaces a `returnTo` key may resolve to. Add an entry here
 * to let a new origin be a valid Previous target -- never accept a path
 * from the URL directly.
 */
export const ADMIN_RETURN_TARGETS = {
  attendees: { path: "/admin/attendees", label: "Attendees" },
} as const;

export type AdminReturnKey = keyof typeof ADMIN_RETURN_TARGETS;

export type AdminReturnTarget = {
  key: AdminReturnKey;
  path: (typeof ADMIN_RETURN_TARGETS)[AdminReturnKey]["path"];
  label: (typeof ADMIN_RETURN_TARGETS)[AdminReturnKey]["label"];
};

function isAdminReturnKey(value: string): value is AdminReturnKey {
  return Object.prototype.hasOwnProperty.call(ADMIN_RETURN_TARGETS, value);
}

/**
 * Appends `&returnTo=<key>` to an existing href, but only for a key that
 * is in the allow-list. Any other value is silently dropped so a caller
 * can pass an optional/derived key without guarding first.
 */
export function withAdminReturnTarget(
  href: string,
  returnKey: string | null | undefined,
): string {
  if (!returnKey || !isAdminReturnKey(returnKey)) {
    return href;
  }

  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}${ADMIN_RETURN_PARAM}=${encodeURIComponent(returnKey)}`;
}

/**
 * Resolves a page's `?returnTo=` into a validated internal target, or null
 * when it is missing / blank / not in the allow-list. The destination
 * page shows a "← Previous" control only when this returns non-null, and
 * navigates only to `.path` (a compile-time-fixed internal route).
 */
export function readAdminReturnTarget(
  searchParams: { get(name: string): string | null } | null | undefined,
): AdminReturnTarget | null {
  if (!searchParams) {
    return null;
  }

  const raw = (searchParams.get(ADMIN_RETURN_PARAM) || "").trim();
  if (!raw || !isAdminReturnKey(raw)) {
    return null;
  }

  const entry = ADMIN_RETURN_TARGETS[raw];
  return { key: raw, path: entry.path, label: entry.label };
}
