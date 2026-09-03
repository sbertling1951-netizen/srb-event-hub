"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  isTopDialogLayer,
  popDialogLayer,
  pushDialogLayer,
} from "@/lib/dialogLayerStack";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const HISTORY_MARKER = "__objectPanelOpen";

export type ObjectPanelProps = {
  /** Whether the panel is open. This component is presentation-only; the
   * consuming page owns which object (if any) is selected. */
  open: boolean;
  /** Called whenever the panel should close (close control, Escape,
   * backdrop click, or browser/Android Back). The consumer is responsible
   * for clearing its own "selected object" state in response. */
  onClose: () => void;
  /** Object name / heading. Provides the panel's accessible name. */
  title: ReactNode;
  /** Optional subtitle or contextual metadata shown under the title
   * (e.g. category, distance). */
  subtitle?: ReactNode;
  /** Primary actions for the object (e.g. Directions, Call, Website). */
  primaryActions?: ReactNode;
  /** Secondary, lower-emphasis actions (e.g. Copy address, Favorite). */
  secondaryActions?: ReactNode;
  /** Object detail content (address, phone, notes, etc.). */
  children?: ReactNode;
  /** Optional supplementary content pinned below the body (e.g. IDs,
   * coordinates, attribution). */
  footer?: ReactNode;
  /** Go to the previous object in the consumer's current list/order.
   * Omit entirely to hide previous/next navigation. */
  onPrevious?: () => void;
  /** Go to the next object in the consumer's current list/order. */
  onNext?: () => void;
  previousLabel?: string;
  nextLabel?: string;
  closeLabel?: string;
  /** Visual density. "comfortable" (default) is unchanged for every
   * existing consumer. "compact" tightens the panel's own chrome padding
   * and lays the primary/secondary action rows out as tight grids -- for
   * a glanceable surface like the Nearby map place panel. Purely
   * presentational; changes no behavior, semantics, or which content
   * renders. */
  density?: "comfortable" | "compact";
  /** Desktop presentation. "side" (default) is the right-edge panel that
   * leaves the discovery surface visible -- unchanged for every existing
   * consumer. "centered" renders a centered, comfortably-wide record
   * workspace over a dimmed page, for surfaces where the object IS the
   * work (attendee record entry/editing) rather than a glance. Purely
   * presentational: dialog semantics, focus trap, Escape/backdrop/Back,
   * and the mobile bottom-sheet fallback are identical. */
  presentation?: "side" | "centered";
};

/**
 * Reusable object panel: the "Understand and Act" step of
 * Browse -> Select -> Understand -> Act -> Close -> Continue.
 *
 * Presentation-only and white-label -- it renders whatever title/actions/
 * body/footer content the consumer supplies and contains no domain-specific
 * business logic. Responsive presentation (bottom sheet vs. side panel) is
 * handled entirely by CSS media queries in `app/globals.css` (see
 * `.object-panel-*`), so rotating or resizing the viewport changes
 * presentation without this component re-rendering, closing, or losing
 * state. `density="compact"` (opt-in; default unchanged) adds
 * `.object-panel--compact` to tighten chrome padding and grid the action
 * rows -- still purely CSS, still the same content and semantics.
 *
 * Behavior provided:
 * - Correct dialog semantics (`role="dialog"`, `aria-modal`,
 *   `aria-labelledby` pointing at the title).
 * - Focus moves into the panel on open and returns to the element that
 *   opened it on close (captured automatically via `document.activeElement`
 *   -- no ref plumbing required from the consumer).
 * - Focus is trapped inside the panel while open (Tab/Shift+Tab cycle
 *   within it); Escape closes it.
 * - Background page scroll is locked while open; scrolling inside the
 *   panel's own body is unaffected and does not chain to the page behind
 *   it (`overscroll-behavior: contain`).
 * - Opening pushes one `history` entry so browser/Android Back closes the
 *   panel before leaving the page; closing via any other control consumes
 *   that entry so Back never leaves a stale step in history.
 * - Respects `prefers-reduced-motion` (see CSS) and never disables pinch
 *   zoom, text selection, or native scrolling.
 */
export function ObjectPanel({
  open,
  onClose,
  title,
  subtitle,
  primaryActions,
  secondaryActions,
  children,
  footer,
  onPrevious,
  onNext,
  previousLabel = "Previous",
  nextLabel = "Next",
  closeLabel = "Close",
  density = "comfortable",
  presentation = "side",
}: ObjectPanelProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const pushedHistoryRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const layerIdRef = useRef<symbol | null>(null);
  const [mounted, setMounted] = useState(false);

  onCloseRef.current = onClose;

  // Portals require a browser document; only render one after mount.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Move focus in on open; capture and restore the triggering element.
  useEffect(() => {
    if (!open) {
      return;
    }

    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const focusTarget = closeButtonRef.current ?? panelRef.current;
    focusTarget?.focus();

    return () => {
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
  }, [open]);

  // Lock background scroll while open without disabling scrolling inside
  // the panel itself.
  useEffect(() => {
    if (!open) {
      return;
    }

    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";

    return () => {
      root.style.overflow = previousOverflow;
    };
  }, [open]);

  // Tracks Escape-key priority so that if another dialog (e.g.
  // PreferredMapChooser) is opened on top of this one, a single Escape
  // press closes only the topmost dialog instead of cascading through
  // both at once.
  useEffect(() => {
    if (!open) {
      return;
    }

    layerIdRef.current = pushDialogLayer();

    return () => {
      if (layerIdRef.current) {
        popDialogLayer(layerIdRef.current);
        layerIdRef.current = null;
      }
    };
  }, [open]);

  // Browser / Android Back closes the panel first, then behaves normally.
  // Reacting only when this panel's own history marker is no longer
  // present (rather than unconditionally on every popstate) keeps this
  // correct even when another dialog with its own pushed entry is
  // currently open on top of this one -- popping that dialog's entry
  // alone must not also close this panel.
  useEffect(() => {
    if (!open) {
      return;
    }

    if (!pushedHistoryRef.current) {
      window.history.pushState(
        { ...(window.history.state || {}), [HISTORY_MARKER]: true },
        "",
      );
      pushedHistoryRef.current = true;
    }

    function handlePopState() {
      if (!pushedHistoryRef.current) {
        return;
      }

      const state = window.history.state as
        | Record<string, unknown>
        | null
        | undefined;

      if (state && state[HISTORY_MARKER]) {
        // A more-recently-pushed entry belonging to some other dialog was
        // popped; this panel's own entry is still current, so it stays
        // open.
        return;
      }

      pushedHistoryRef.current = false;
      onCloseRef.current();
    }

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [open]);

  const requestClose = useCallback(() => {
    if (pushedHistoryRef.current) {
      pushedHistoryRef.current = false;
      // Consumes the entry pushed on open so Back never lands on a stale
      // "panel open" step once the panel has been closed another way.
      window.history.back();
    }

    onCloseRef.current();
  }, []);

  // Escape closes the panel on keyboard-capable devices.
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === "Escape" &&
        layerIdRef.current &&
        isTopDialogLayer(layerIdRef.current)
      ) {
        e.preventDefault();
        requestClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, requestClose]);

  const handleTrapKeyDown = useCallback((e: ReactKeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) {
      return;
    }

    const focusable = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    if (focusable.length === 0) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  if (!mounted || !open) {
    return null;
  }

  return createPortal(
    <div
      className={
        presentation === "centered"
          ? "object-panel-backdrop object-panel-backdrop--centered"
          : "object-panel-backdrop"
      }
      role="presentation"
      onClick={requestClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={[
          "object-panel",
          density === "compact" ? "object-panel--compact" : null,
          presentation === "centered" ? "object-panel--centered" : null,
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleTrapKeyDown}
        tabIndex={-1}
      >
        <div className="object-panel-header">
          <div className="object-panel-header-text">
            <h2 id={titleId} className="object-panel-title">
              {title}
            </h2>

            {subtitle ? (
              <div className="object-panel-subtitle">{subtitle}</div>
            ) : null}
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={requestClose}
            className="object-panel-close"
            aria-label={closeLabel}
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        {primaryActions ? (
          <div className="object-panel-primary-actions app-button-row">
            {primaryActions}
          </div>
        ) : null}

        {(onPrevious || onNext) && (
          <div className="object-panel-nav">
            <button
              type="button"
              className="object-panel-nav-button"
              onClick={onPrevious}
              disabled={!onPrevious}
            >
              &larr; {previousLabel}
            </button>

            <button
              type="button"
              className="object-panel-nav-button"
              onClick={onNext}
              disabled={!onNext}
            >
              {nextLabel} &rarr;
            </button>
          </div>
        )}

        {children ? (
          <div className="object-panel-body">{children}</div>
        ) : null}

        {secondaryActions ? (
          <div className="object-panel-secondary-actions app-button-row">
            {secondaryActions}
          </div>
        ) : null}

        {footer ? <div className="object-panel-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
