"use client";

import Link from "next/link";

import { readAdminReturnTarget } from "@/lib/adminWorkspaceReturn";

/**
 * "← Previous" control for a canonical owner workspace (Check-In, Parking)
 * that an operator reached from another Admin surface via a status handoff.
 *
 * Renders only when the current URL carries a `?returnTo=` key that
 * resolves against the fixed allow-list in `lib/adminWorkspaceReturn.ts`
 * -- otherwise nothing is shown, so a direct visit never gets a broken or
 * misleading Previous control. Navigation targets a compile-time-fixed
 * internal route (never a path taken from the URL), so an open-redirect is
 * structurally impossible. This is deliberately not browser history/back:
 * the key rides in the URL, so a refresh keeps Previous working.
 */
export function AdminReturnLink({
  searchParams,
}: {
  searchParams: { get(name: string): string | null } | null | undefined;
}) {
  const target = readAdminReturnTarget(searchParams);

  if (!target) {
    return null;
  }

  return (
    <div>
      <Link
        href={target.path}
        className="app-button"
        aria-label={`Back to ${target.label}`}
      >
        <span aria-hidden="true">&larr; </span>
        Previous
      </Link>
    </div>
  );
}
