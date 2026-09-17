import type { ReactNode } from "react";

/**
 * Canonical EpicentraX Shell Contract (EPICENTRAX UI STAGE 2).
 *
 * One typed contract consumed identically by Member, Admin, Vendor, and
 * the platform-neutral Organizer shell. The shell owns shared presentation
 * concerns only -- it never resolves business authority, workspace, or
 * identity itself. Every value here is assembled by a role adapter
 * (components/shell/adapters/*) from already-resolved workspace context
 * (useMemberWorkspace, useAdminWorkspace + useAdmin, useVendorWorkspace) and
 * handed to AppShell as data. The Organizer adapter is the deliberate
 * minimal case: it resolves nothing at all, supplying only a static neutral
 * platform brand and two fixed nav links.
 */

export type ShellRole = "member" | "admin" | "vendor" | "organizer";

export type ShellNavItem = {
  id: string;
  label: string;
  href: string;
  icon?: string;
  /** A small, presentation-only count for an already-authorized work queue. */
  badgeCount?: number;
  /**
   * Optional nested items presented as this item's submenu (Stage: Central
   * Navigation, shared nested-submenu extension). Omitted or empty means
   * this item renders exactly as before -- a single flat link, no
   * expand/collapse control. `item.href` always stays a real link to that
   * item's own landing page; children are a *separate* accessible
   * expand/collapse affordance layered on top, never a replacement for the
   * parent's own destination. One level deep only -- a child's own
   * `children` field, if ever populated, is not rendered by `ShellNav`.
   * Backward compatible for every existing consumer (Member/Vendor/
   * Organizer nav builders never set this field, so their output is
   * byte-identical to before this field existed).
   */
  children?: ShellNavItem[];
};

export type ShellNavSection = {
  id: string;
  title?: string;
  items: ShellNavItem[];
};

export type ShellBrand = {
  title: string;
  tagline?: string | null;
  logoUrl?: string | null;
  logoAlt?: string;
};

/** Event/workspace identity (§C). Never business Authority -- display only. */
export type ShellWorkspaceIdentity = {
  name: string | null;
  /**
   * Optional short/compact form of `name` for narrow-viewport presentation
   * (Stage 4C §A) -- e.g. a governed `events.short_name` value ("Saint
   * George") standing in for a longer official name ("St. George, Utah
   * Fall Event"). Purely an alternate PRESENTATION string for the same
   * Event identity, never a second identity. When absent, compact
   * presentation falls back to `name` itself.
   */
  compactName?: string | null;
  location?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

export type ShellAccountAction = {
  id: string;
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "danger";
};

export type ShellBackTarget = {
  label: string;
  href: string;
};

/**
 * A persistent, secondary header escape path to the role's own home/
 * Dashboard destination (Central Navigation Batch 2A) -- role-neutral in
 * shape (reuses `ShellBackTarget`'s own `{label, href}`), but populated
 * today only by `AdminShellAdapter`, from the canonical Admin nav model's
 * own already-computed Dashboard visibility -- never a second permission
 * decision. Distinct from `backTarget`: a page's explicit parent-return
 * link is never replaced or hidden by this field; both may render
 * together. `null`/omitted means no such action for this role/account
 * (e.g. Member/Vendor/Organizer never set this field today, and an Admin
 * account without `can_view_admin_dashboard` gets `null` here too).
 */
export type ShellHomeAction = ShellBackTarget;

export type ShellContentMode = "standard" | "full-bleed";

/**
 * Device-presentation input contract for future use (§J).
 *
 * This is intentionally the ONLY device-presentation surface the shell
 * exposes. It must only ever be populated with a governed, deterministic,
 * non-learning value (e.g. a static viewport-derived class). The Adaptive
 * UI Architecture (docs/architecture/EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md)
 * remains Proposed, not Accepted -- no caller in this stage may populate
 * this field from remembered/learned device state, interaction history, or
 * a Person x device preference. Omitting it entirely is always valid; the
 * shell does not require it to render correctly.
 */
export type ShellPresentationHint = "compact" | "standard" | "wide" | "touch-optimized";

export type ShellConfig = {
  role: ShellRole;
  brand: ShellBrand;
  workspace?: ShellWorkspaceIdentity | null;
  pageTitle?: string;
  pageSubtitle?: string;
  navSections: ShellNavSection[];
  activeHref?: string | null;
  accountActions?: ShellAccountAction[];
  statusContent?: ReactNode;
  backTarget?: ShellBackTarget | null;
  homeAction?: ShellHomeAction | null;
  contentMode?: ShellContentMode;
  presentationHint?: ShellPresentationHint;
};
