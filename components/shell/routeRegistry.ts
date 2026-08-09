/**
 * The single executable shell-transition truth (EPICENTRAX UI STAGE 2B,
 * §A/§B). `resolveShellMode(pathname)` is the ONLY place that decides
 * which shell presentation a route receives. `components/shell/
 * ShellTransition.tsx` consults it exactly once, at the root, and it is
 * not re-derived anywhere else -- no page-local second registry.
 *
 * This registry answers exactly one question: "what shell presentation
 * mode should this pathname use?" It never answers "is this user allowed
 * to access this route?" (§L). Authentication/authorization remain
 * entirely owned by `AdminRouteGuard`, `MemberRouteGuard`, and each
 * workspace provider, exactly as before this task.
 */

export type ShellPresentationMode =
  | "legacy"
  | "canonical-member"
  | "canonical-admin"
  | "canonical-vendor"
  | "exception";

/**
 * Exact-path routes that render with no application shell at all --
 * pre-auth/gateway forms and the OAuth callback, none of which have a
 * resolved Workspace to build chrome from yet.
 *
 * `/dev/shell-preview` is included for a different reason (EPICENTRAX UI
 * STAGE 2D): it is production-gated separately and independently by
 * `app/dev/shell-preview/page.tsx`'s server-side `NODE_ENV === "production"
 * -> notFound()` check, but in development it renders `ShellPreviewClient`,
 * which switches between the Member/Admin/Vendor adapters and therefore
 * already renders its own canonical `AppShell` per selected role. Without
 * this entry, the registry's fallback ("legacy") would additionally wrap
 * it in `LegacyChromeCompat`, producing exactly the double-shell defect
 * this registry exists to prevent -- `LegacyChromeCompat -> AppShell`
 * nested, violating the one-presentation-per-route invariant even though
 * production is unaffected. Removing this entry does not affect the
 * production gate above, which is independent and remains unchanged.
 */
const EXACT_EXCEPTION_ROUTES: readonly string[] = [
  "/",
  "/member/login",
  "/member/activate",
  "/member/account",
  "/member/account/reset-password",
  "/admin/login",
  "/vendor/login",
  "/vendor/callback",
  "/vendor/register",
  "/vendor/reset-password",
  "/auth/callback",
  "/dev/shell-preview",
];

/**
 * Prefix-match routes that render with no application shell at all.
 * Both entries are routes that, today, already unconditionally hide all
 * chrome themselves for their entire lifetime (print views open
 * standalone for printing; `/slideshow/view` toggles
 * `slideshow-view-mode`, which hides `.app-sidebar`/`.app-header-card` in
 * CSS unconditionally on mount) -- this registry now enforces the same
 * outcome structurally instead of leaving it to page-toggled CSS classes
 * plus a chrome frame that still mounts underneath.
 *
 * `/coach-map` is deliberately NOT included here even though it was named
 * in this task's requested coverage list. Verified by inspection:
 * `app/coach-map/public/page.tsx` has no back/exit navigation control of
 * its own, and `components/layout/Sidebar.tsx` (unmodifiable per ADR-011
 * §18) is today the Person's *only* way to leave the map -- its own mode
 * detection explicitly treats `/coach-map` as Member nav, and the
 * existing `coach-map-lock` CSS class hides only `.app-header-card`, not
 * the Sidebar `<aside>`. Reclassifying `/coach-map` as "exception" here
 * would remove that one working exit path with nothing yet built to
 * replace it -- a real functional regression, not a presentation
 * correction. `/coach-map*` therefore remains "legacy" (unchanged) until
 * a separate, explicitly authorized task gives it its own exit control.
 * See the Stage 2B report for this exact reasoning.
 */
const PREFIX_EXCEPTION_ROUTES: readonly string[] = [
  "/admin/print",
  "/admin/reports/coach-plates/print",
  "/admin/reports/name-tags/print",
  "/slideshow",
];

/** Vendor workspace routes already delegate to VendorShellAdapter -> AppShell. */
const CANONICAL_VENDOR_PREFIXES: readonly string[] = ["/vendor/workspace"];

/**
 * No route is registered canonical-member/canonical-admin yet. Member and
 * Admin pages remain "legacy" until their own, separately authorized
 * pilot-migration stage (§N) actually moves a route onto
 * MemberShellAdapter/AdminShellAdapter. Populate these when that stage
 * begins -- do not pre-populate them speculatively now.
 */
const CANONICAL_MEMBER_PREFIXES: readonly string[] = [];
const CANONICAL_ADMIN_PREFIXES: readonly string[] = [];

function matchesExact(pathname: string, routes: readonly string[]): boolean {
  return routes.includes(pathname);
}

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function resolveShellMode(pathname: string | null | undefined): ShellPresentationMode {
  if (!pathname) {
    return "legacy";
  }

  if (matchesExact(pathname, EXACT_EXCEPTION_ROUTES) || matchesPrefix(pathname, PREFIX_EXCEPTION_ROUTES)) {
    return "exception";
  }

  if (matchesPrefix(pathname, CANONICAL_VENDOR_PREFIXES)) {
    return "canonical-vendor";
  }

  if (matchesPrefix(pathname, CANONICAL_MEMBER_PREFIXES)) {
    return "canonical-member";
  }

  if (matchesPrefix(pathname, CANONICAL_ADMIN_PREFIXES)) {
    return "canonical-admin";
  }

  return "legacy";
}
