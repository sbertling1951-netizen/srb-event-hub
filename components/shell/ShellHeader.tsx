import type { RefObject } from "react";

import { SHELL_NAV_DRAWER_ID } from "@/components/shell/ShellNav";
import type { ShellConfig } from "@/components/shell/types";

export type ShellHeaderProps = {
  config: ShellConfig;
  isCompact: boolean;
  navOpen: boolean;
  onToggleNav: () => void;
  navTriggerRef: RefObject<HTMLButtonElement | null>;
};

/**
 * Formats an already-supplied start/end date pair for display. Pure
 * presentation formatting of strings `ShellWorkspaceIdentity` already
 * carries -- no new context source, no query. Mirrors the identical
 * `formatDateRange` pattern already used in three other places in this
 * codebase (`components/layout/Sidebar.tsx`, `components/layout/
 * EventBanner.tsx`, `lib/memberAccountSession.ts`) so the shell's display
 * format matches existing convention rather than inventing a fourth,
 * slightly different one.
 */
function formatWorkspaceDateRange(startDate?: string | null, endDate?: string | null): string {
  if (!startDate && !endDate) {
    return "";
  }
  if (startDate && endDate) {
    return `${startDate} – ${endDate}`;
  }
  return startDate || endDate || "";
}

/**
 * Canonical header composition (§G, Stage 2; workspace metadata completed
 * Stage 3B §B). Defines consistent slots -- brand, workspace/Event
 * identity (name, location, date range), page title/subtitle, back
 * action, mobile menu control, account controls, optional contextual
 * status area -- without forcing every page to populate every slot. A
 * role/page adapter decides which fields are present; the shell only
 * guarantees consistent spacing and slot order.
 *
 * Workspace location/date render as subordinate metadata beneath the
 * workspace name, never as a second page title -- `pageTitle` remains the
 * only `<h1>` this header ever renders. Location and date range are
 * omitted individually when absent (Vendor, for example, supplies only a
 * `name`), and the whole metadata line is omitted when neither is
 * present, so no adapter is forced to populate fields it has no source
 * for.
 *
 * The mobile-menu trigger carries `aria-controls` pointing at the drawer
 * `ShellNav` renders (§H) so assistive technology can associate the two
 * even though they are siblings, not parent/child, in the DOM; the
 * `navTriggerRef` it also attaches to is what `ShellNav` uses to restore
 * focus to this button when the drawer closes.
 */
export function ShellHeader({ config, isCompact, navOpen, onToggleNav, navTriggerRef }: ShellHeaderProps) {
  const { brand, workspace, pageTitle, pageSubtitle, backTarget, accountActions, statusContent } = config;
  const workspaceDateRange = formatWorkspaceDateRange(workspace?.startDate, workspace?.endDate);
  const hasWorkspaceMeta = Boolean(workspace?.location || workspaceDateRange);

  return (
    <header className="shell-header">
      <div className="shell-header-row">
        <div className="shell-header-identity">
          {isCompact ? (
            <button
              ref={navTriggerRef}
              type="button"
              className="shell-nav-trigger"
              aria-expanded={navOpen}
              aria-controls={SHELL_NAV_DRAWER_ID}
              aria-label={navOpen ? "Close menu" : "Open menu"}
              onClick={onToggleNav}
            >
              <span className="shell-nav-trigger-bar" />
              <span className="shell-nav-trigger-bar" />
              <span className="shell-nav-trigger-bar" />
            </button>
          ) : null}

          {backTarget ? (
            <a href={backTarget.href} className="shell-back-action">
              ← {backTarget.label}
            </a>
          ) : null}

          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt={brand.logoAlt || brand.title} className="shell-brand-logo" />
          ) : null}

          <div className="shell-header-titles">
            <div className="shell-brand-title">{brand.title}</div>
            {workspace?.name ? (
              <div className="shell-workspace-identity">
                <div className="shell-workspace-name">{workspace.name}</div>
                {hasWorkspaceMeta ? (
                  <div className="shell-workspace-meta">
                    {workspace?.location ? (
                      <span className="shell-workspace-location">{workspace.location}</span>
                    ) : null}
                    {workspace?.location && workspaceDateRange ? (
                      <span className="shell-workspace-meta-sep" aria-hidden="true">
                        {" "}
                        •{" "}
                      </span>
                    ) : null}
                    {workspaceDateRange ? (
                      <span className="shell-workspace-daterange">{workspaceDateRange}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            {pageTitle ? <h1 className="shell-page-title">{pageTitle}</h1> : null}
            {pageSubtitle ? <div className="shell-page-subtitle">{pageSubtitle}</div> : null}
          </div>
        </div>

        {accountActions && accountActions.length > 0 ? (
          <div className="shell-account-actions">
            {accountActions.map((action) =>
              action.href ? (
                <a
                  key={action.id}
                  href={action.href}
                  className={
                    "shell-account-action" + (action.variant === "danger" ? " shell-account-action-danger" : "")
                  }
                >
                  {action.label}
                </a>
              ) : (
                <button
                  key={action.id}
                  type="button"
                  onClick={action.onClick}
                  className={
                    "shell-account-action" + (action.variant === "danger" ? " shell-account-action-danger" : "")
                  }
                >
                  {action.label}
                </button>
              ),
            )}
          </div>
        ) : null}
      </div>

      {statusContent ? <div className="shell-status-area">{statusContent}</div> : null}
    </header>
  );
}
