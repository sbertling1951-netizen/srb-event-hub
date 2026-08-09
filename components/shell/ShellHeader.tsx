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
 * Canonical header composition (§G, Stage 2). Defines consistent slots --
 * brand, workspace/Event identity, page title/subtitle, back action,
 * mobile menu control, account controls, optional contextual status area
 * -- without forcing every page to populate every slot. A role/page
 * adapter decides which fields are present; the shell only guarantees
 * consistent spacing and slot order.
 *
 * The mobile-menu trigger carries `aria-controls` pointing at the drawer
 * `ShellNav` renders (§H) so assistive technology can associate the two
 * even though they are siblings, not parent/child, in the DOM; the
 * `navTriggerRef` it also attaches to is what `ShellNav` uses to restore
 * focus to this button when the drawer closes.
 */
export function ShellHeader({ config, isCompact, navOpen, onToggleNav, navTriggerRef }: ShellHeaderProps) {
  const { brand, workspace, pageTitle, pageSubtitle, backTarget, accountActions, statusContent } = config;

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
            {workspace?.name ? <div className="shell-workspace-name">{workspace.name}</div> : null}
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
