"use client";

import Link from "next/link";
import { type RefObject,useEffect, useRef } from "react";

import type { ShellNavSection } from "@/components/shell/types";

export type ShellNavProps = {
  sections: ShellNavSection[];
  activeHref?: string | null;
  isCompact: boolean;
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

const DRAWER_ID = "shell-nav-drawer";
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function matchesHref(href: string, activeHref: string): boolean {
  return activeHref === href || activeHref.startsWith(`${href}/`);
}

/**
 * Resolves exactly one "active" item across every section using
 * exact/longest-match semantics (§D): the item whose `href` is either an
 * exact match, or the longest matching path-boundary prefix, of
 * `activeHref`. This is what stops `/vendor/workspace` (Home) from also
 * lighting up while on `/vendor/workspace/contacts` -- only the single
 * most specific match wins, never every ancestor route simultaneously.
 */
function resolveActiveHref(sections: ShellNavSection[], activeHref?: string | null): string | null {
  if (!activeHref) {
    return null;
  }
  let best: string | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      if (matchesHref(item.href, activeHref) && (!best || item.href.length > best.length)) {
        best = item.href;
      }
    }
  }
  return best;
}

function NavSections({
  sections,
  resolvedActiveHref,
  onNavigate,
}: {
  sections: ShellNavSection[];
  resolvedActiveHref: string | null;
  onNavigate?: () => void;
}) {
  return (
    <nav className="shell-nav" aria-label="Primary navigation">
      {sections.map((section) => (
        <div key={section.id} className="shell-nav-section">
          {section.title ? <div className="shell-nav-section-title">{section.title}</div> : null}
          <div className="shell-nav-list">
            {section.items.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                aria-current={item.href === resolvedActiveHref ? "page" : undefined}
                className={"shell-nav-item" + (item.href === resolvedActiveHref ? " shell-nav-item-active" : "")}
                onClick={onNavigate}
              >
                {item.icon ? (
                  <span className="shell-nav-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                ) : null}
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

/**
 * Canonical navigation renderer (§F, Stage 2; accessibility completed
 * Stage 2B §H). Desktop nav, mobile drawer, and active-route highlighting
 * all consume the identical ShellNavSection[] model supplied by a role
 * adapter.
 *
 * Drawer accessibility (mobile/compact only): the trigger button
 * (rendered by ShellHeader, referenced here via `triggerRef`) carries
 * `aria-controls={DRAWER_ID}`; on open, focus moves to the first
 * focusable element inside the drawer and Tab is trapped within it;
 * Escape, an overlay click, or selecting a nav item all close it; on
 * close, focus always returns to the trigger button. This is a small,
 * dependency-free focus-trap implementation (native DOM query + keydown
 * listener) rather than a new library, per §H's "use the simplest
 * accessible pattern... do not add a dependency unless truly necessary."
 */
export function ShellNav({ sections, activeHref, isCompact, open, onClose, triggerRef }: ShellNavProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const resolvedActiveHref = resolveActiveHref(sections, activeHref);

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
    const focusable = drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    focusable[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "Tab" && focusable.length > 0) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
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
        <NavSections sections={sections} resolvedActiveHref={resolvedActiveHref} />
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
        <NavSections sections={sections} resolvedActiveHref={resolvedActiveHref} onNavigate={onClose} />
      </div>
    </div>
  );
}

export { DRAWER_ID as SHELL_NAV_DRAWER_ID };
