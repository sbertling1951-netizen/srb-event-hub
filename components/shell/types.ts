import type { ReactNode } from "react";

/**
 * Canonical EpicentraX Shell Contract (EPICENTRAX UI STAGE 2).
 *
 * One typed contract consumed identically by Member, Admin, and Vendor.
 * The shell owns shared presentation concerns only -- it never resolves
 * business authority, workspace, or identity itself. Every value here is
 * assembled by a role adapter (components/shell/adapters/*) from
 * already-resolved workspace context (useMemberWorkspace, useAdminWorkspace
 * + useAdmin, useVendorWorkspace) and handed to AppShell as data.
 */

export type ShellRole = "member" | "admin" | "vendor";

export type ShellNavItem = {
  id: string;
  label: string;
  href: string;
  icon?: string;
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
  contentMode?: ShellContentMode;
  presentationHint?: ShellPresentationHint;
};
