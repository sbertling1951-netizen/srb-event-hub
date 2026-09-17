"use client";

import Link from "next/link";
import { type RefObject,useEffect, useRef, useState } from "react";

import type { ShellAccountAction, ShellNavItem, ShellNavSection } from "@/components/shell/types";

export type ShellNavProps = {
  sections: ShellNavSection[];
  accountActions?: ShellAccountAction[];
  activeHref?: string | null;
  isCompact: boolean;
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

const DRAWER_ID = "shell-nav-drawer";
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The mobile-drawer focus trap's Tab-boundary decision, extracted so it
 * has exactly one implementation -- the production keydown handler below
 * calls this directly, and the test file imports and calls this exact
 * function too, rather than a look-alike re-implementation that could
 * silently drift from the real behavior.
 *
 * Takes the drawer's CURRENTLY focusable elements (the caller must query
 * these fresh, on every Tab press -- this function itself has no opinion
 * on when or how they were queried, which is what lets a submenu
 * expand/collapse between two Tab presses be reflected correctly: the
 * caller re-queries, and whatever list it passes in here is exactly what
 * gets wrapped against), the element currently focused, and whether
 * Shift is held. Returns the element focus should move to when Tab would
 * otherwise leave the trapped region, or `null` when Tab should proceed
 * normally (no wrap needed).
 */
export function resolveTabWrapTarget(
  focusable: ArrayLike<HTMLElement>,
  activeElement: Element | null,
  shiftKey: boolean,
): HTMLElement | null {
  if (focusable.length === 0) {
    return null;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (shiftKey && activeElement === first) {
    return last;
  }
  if (!shiftKey && activeElement === last) {
    return first;
  }
  return null;
}

function matchesHref(href: string, activeHref: string): boolean {
  return activeHref === href || activeHref.startsWith(`${href}/`);
}

type ResolvedActiveEntry = { href: string; ownerId: string };

/**
 * Resolves exactly one "active" href across every top-level item AND its
 * submenu children, using the same exact/longest-match semantics as
 * before nested submenus existed -- the item whose `href` is either an
 * exact match, or the longest matching path-boundary prefix, of
 * `activeHref`. `ownerId` is the top-level item that "owns" the match --
 * itself, when its own href is the active one, or its parent's id, when a
 * child's href is -- and is what drives which single submenu auto-opens.
 * `href` is what drives which single leaf (top-level item or child)
 * renders as visually active. Only the single most specific match wins,
 * never every ancestor simultaneously -- unchanged invariant from before.
 */
function resolveActiveEntry(sections: ShellNavSection[], activeHref?: string | null): ResolvedActiveEntry | null {
  if (!activeHref) {
    return null;
  }
  let best: ResolvedActiveEntry | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      if (matchesHref(item.href, activeHref) && (!best || item.href.length > best.href.length)) {
        best = { href: item.href, ownerId: item.id };
      }
      for (const child of item.children ?? []) {
        if (matchesHref(child.href, activeHref) && (!best || child.href.length > best.href.length)) {
          best = { href: child.href, ownerId: item.id };
        }
      }
    }
  }
  return best;
}

function NavSections({
  sections,
  accountActions,
  resolvedActiveHref,
  openIds,
  onToggle,
  onNavigate,
}: {
  sections: ShellNavSection[];
  accountActions?: ShellAccountAction[];
  resolvedActiveHref: string | null;
  openIds: Set<string>;
  onToggle: (id: string) => void;
  onNavigate?: () => void;
}) {
  return (
    <nav className="shell-nav" aria-label="Primary navigation">
      {sections.map((section) => (
        <div key={section.id} className="shell-nav-section">
          {section.title ? <div className="shell-nav-section-title">{section.title}</div> : null}
          <div className="shell-nav-list">
            {section.items.map((item) => {
              const children: ShellNavItem[] = item.children ?? [];
              const hasChildren = children.length > 0;
              const isItemActive = item.href === resolvedActiveHref;
              const isOpen = hasChildren && openIds.has(item.id);
              const submenuId = `shell-nav-submenu-${item.id}`;

              return (
                <div key={item.id} className="shell-nav-item-group">
                  <div className={"shell-nav-item-row" + (hasChildren ? " shell-nav-item-row-parent" : "")}>
                    <Link
                      href={item.href}
                      aria-current={isItemActive ? "page" : undefined}
                      className={"shell-nav-item" + (isItemActive ? " shell-nav-item-active" : "")}
                      onClick={onNavigate}
                    >
                      {item.icon ? (
                        <span className="shell-nav-icon" aria-hidden="true">
                          {item.icon}
                        </span>
                      ) : null}
                      <span>{item.label}</span>
                      {item.badgeCount && item.badgeCount > 0 ? (
                        <sup className="shell-nav-item-badge" aria-label={`${item.badgeCount} pending approvals`}>
                          {item.badgeCount}
                        </sup>
                      ) : null}
                    </Link>
                    {hasChildren ? (
                      <button
                        type="button"
                        className="shell-nav-item-toggle"
                        aria-expanded={isOpen}
                        aria-controls={submenuId}
                        aria-label={(isOpen ? "Collapse " : "Expand ") + item.label + " submenu"}
                        onClick={() => onToggle(item.id)}
                      >
                        <span
                          className={"shell-nav-item-toggle-chevron" + (isOpen ? " shell-nav-item-toggle-chevron-open" : "")}
                          aria-hidden="true"
                        />
                      </button>
                    ) : null}
                  </div>

                  {hasChildren && isOpen ? (
                    <div id={submenuId} className="shell-nav-submenu">
                      {children.map((child) => {
                        const isChildActive = child.href === resolvedActiveHref;
                        return (
                          <Link
                            key={child.id}
                            href={child.href}
                            aria-current={isChildActive ? "page" : undefined}
                            className={"shell-nav-subitem" + (isChildActive ? " shell-nav-subitem-active" : "")}
                            onClick={onNavigate}
                          >
                            <span>{child.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {accountActions && accountActions.length > 0 ? (
        <div className="shell-nav-account-actions">
          {accountActions.map((action) =>
            action.href ? (
              <Link
                key={action.id}
                href={action.href}
                className={
                  "shell-nav-account-action" +
                  (action.variant === "danger" ? " shell-nav-account-action-danger" : "")
                }
                onClick={onNavigate}
              >
                {action.label}
              </Link>
            ) : (
              <button
                key={action.id}
                type="button"
                className={
                  "shell-nav-account-action" +
                  (action.variant === "danger" ? " shell-nav-account-action-danger" : "")
                }
                onClick={() => {
                  onNavigate?.();
                  action.onClick?.();
                }}
                disabled={action.disabled}
              >
                {action.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </nav>
  );
}

/**
 * Canonical navigation renderer (§F, Stage 2; accessibility completed
 * Stage 2B §H; nested submenus completed Central Navigation Batch 1).
 * Desktop nav, mobile drawer, and active-route highlighting all consume
 * the identical ShellNavSection[] model supplied by a role adapter --
 * including each item's optional `children` submenu, rendered by this
 * exact same `NavSections` function for both viewports, so desktop and
 * mobile can never structurally diverge (no role- or viewport-specific
 * submenu markup exists anywhere in this file).
 *
 * Submenu model: a parent item with `children` renders as a real `<Link>`
 * to its own landing page PLUS a separate `<button>` expand/collapse
 * control (its own `aria-expanded`/`aria-controls`, never overloading the
 * link's own click) -- clicking the link navigates; clicking the toggle
 * only shows/hides the submenu. Open/collapsed state is one `Set<string>`
 * of open parent ids, owned by this component (not duplicated per
 * viewport, since only one of the two NavSections call sites is ever
 * mounted for a given `isCompact`) and persists across an isCompact
 * transition, so a section a person opened on desktop stays open if the
 * viewport narrows into the drawer. Whichever parent "owns" the current
 * active route (itself, or one of its children) is automatically added to
 * the open set on every navigation, without ever force-closing a
 * different section the person opened manually -- this is what keeps
 * "the active leaf is selected and its parent is open" true without an
 * accordion-style single-open constraint neither Pap's brief nor any
 * current data asks for. A parent whose `children` end up empty after its
 * builder's own permission filtering renders as a plain leaf link -- no
 * toggle, no dead empty submenu -- because `hasChildren` is computed from
 * the actual (already-filtered) array length, not from whether the field
 * was set at all.
 *
 * Drawer accessibility (mobile/compact only): the trigger button
 * (rendered by ShellHeader, referenced here via `triggerRef`) carries
 * `aria-controls={DRAWER_ID}`; on open, focus moves to the first
 * focusable element inside the drawer and Tab is trapped within it.
 * Submenus stay correctly wrapped because the trap re-runs its
 * `FOCUSABLE_SELECTOR` query fresh on every single Tab keydown, not once
 * when the drawer opened -- expanding or collapsing a submenu between two
 * Tab presses changes which real `<a>`/`<button>` elements exist in the
 * drawer's DOM, and the very next Tab press wraps against exactly that
 * current set, submenu toggles and (when open) submenu links included.
 * Escape, an overlay click, or selecting a nav item (leaf or child) all
 * close it; on close, focus always returns to the trigger button.
 */
export function ShellNav({ sections, accountActions, activeHref, isCompact, open, onClose, triggerRef }: ShellNavProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const resolvedActive = resolveActiveEntry(sections, activeHref);
  const resolvedActiveHref = resolvedActive?.href ?? null;

  // Initialized synchronously (not only via an effect) from the FIRST
  // render's own active route, so the correct submenu is already open in
  // the very first paint -- no effect-only flash of every submenu
  // starting collapsed regardless of where the person actually is.
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(resolvedActive?.ownerId ? [resolvedActive.ownerId] : []),
  );

  // Handles activeHref changing after mount (client-side navigation to a
  // different section without ShellNav itself remounting) -- the initial
  // state above already covers first paint.
  useEffect(() => {
    const ownerId = resolvedActive?.ownerId;
    if (!ownerId) {
      return;
    }
    setOpenIds((prev) => {
      if (prev.has(ownerId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(ownerId);
      return next;
    });
  }, [resolvedActive?.ownerId]);

  function toggleOpen(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  useEffect(() => {
    if (!isCompact || !open) {
      return;
    }

    const drawer = drawerRef.current;
    if (!drawer) {
      return;
    }

    // Captured now, not read again inside the cleanup closure below: the
    // trigger button (rendered by ShellHeader) could in principle unmount
    // before this effect's cleanup runs, at which point `triggerRef.current`
    // would already be null.
    const triggerToRestore = triggerRef.current;
    // Initial-focus-on-open only -- a one-time snapshot is correct here,
    // since this runs exactly once per drawer open, before any submenu
    // toggle could have happened yet.
    drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "Tab") {
        // Re-read from the ref, and re-queried, on every Tab press --
        // not the effect's own one-time snapshot above: a submenu toggle
        // between two Tab presses adds or removes real focusable links
        // in the drawer's DOM, and the wrap set must reflect exactly
        // what is focusable right now, not what was focusable when the
        // drawer first opened.
        const currentDrawer = drawerRef.current;
        if (!currentDrawer) {
          return;
        }
        const focusable = currentDrawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        const wrapTarget = resolveTabWrapTarget(focusable, document.activeElement, event.shiftKey);
        if (wrapTarget) {
          event.preventDefault();
          wrapTarget.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      triggerToRestore?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCompact, open]);

  if (!isCompact) {
    return (
      <aside className="shell-nav-desktop">
        <NavSections
          sections={sections}
          accountActions={accountActions}
          resolvedActiveHref={resolvedActiveHref}
          openIds={openIds}
          onToggle={toggleOpen}
        />
      </aside>
    );
  }

  if (!open) {
    return null;
  }

  return (
    <div className="shell-nav-drawer-backdrop" onClick={onClose}>
      <div
        ref={drawerRef}
        id={DRAWER_ID}
        className="shell-nav-drawer"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
      >
        <NavSections
          sections={sections}
          accountActions={accountActions}
          resolvedActiveHref={resolvedActiveHref}
          openIds={openIds}
          onToggle={toggleOpen}
          onNavigate={onClose}
        />
      </div>
    </div>
  );
}

export { DRAWER_ID as SHELL_NAV_DRAWER_ID };
