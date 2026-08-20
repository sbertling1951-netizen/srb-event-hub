"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
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

const HISTORY_MARKER = "__appDialogOpen";

type DialogSurfaceProps = {
  titleId: string;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  dialogRef: RefObject<HTMLDivElement | null>;
  onBackdropClick: () => void;
  onDialogKeyDown: (e: ReactKeyboardEvent) => void;
};

/**
 * The dialog's actual markup, with no portal wrapping and no lifecycle
 * effects of its own -- deliberately separate from `Dialog` below so this
 * part (roles, labeling, class names, footer/content composition) can be
 * exercised with a plain `renderToStaticMarkup` test, the same way every
 * other primitive in `components/ui/*` is tested. `Dialog`'s portal
 * mounting and focus/Escape/scroll-lock/stack behavior cannot be
 * meaningfully tested the same way -- `createPortal` output is not
 * included in server-rendered markup at all (a React constraint, not a
 * gap in this component), and this repo has no DOM-testing dependency
 * (e.g. jsdom) installed to exercise it interactively. That real
 * interaction contract is verified by real-device testing instead, as
 * already established for the canonical shell.
 */
function DialogSurface({
  titleId,
  title,
  description,
  children,
  footer,
  className,
  dialogRef,
  onBackdropClick,
  onDialogKeyDown,
}: DialogSurfaceProps) {
  return (
    <div className="app-dialog-backdrop" role="presentation" onClick={onBackdropClick}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={["app-dialog", className].filter(Boolean).join(" ")}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
        tabIndex={-1}
      >
        <h2 id={titleId} className="app-dialog-title">
          {title}
        </h2>

        {description ? <p className="app-dialog-description">{description}</p> : null}

        {children}

        {footer ? <div className="app-dialog-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

export type DialogProps = {
  open: boolean;
  /** Called on Escape, backdrop click, or (when `historyBack` is set) Back. */
  onClose: () => void;
  title: ReactNode;
  /** Overrides the auto-generated id used for aria-labelledby, for a
   * caller that already has its own heading element/id to reuse. */
  titleId?: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Action row, rendered last. Layout/spacing is owned by `.app-dialog-footer`. */
  footer?: ReactNode;
  /** Appended to the dialog panel's own class list (e.g. a width override). */
  className?: string;
  /** Which element receives focus on open. Defaults to the first focusable
   * descendant found inside the dialog's own content. Pass a ref when a
   * specific control (e.g. a confirm button) must receive focus instead --
   * native `autoFocus` on a child is not reliable here because this
   * component's own focus-management effect would immediately override it. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Push one history entry while open, so Back closes the dialog before it
   * navigates the page (matching `PreferredMapChooser`'s original
   * behavior). Off by default -- most dialogs (confirmations, small
   * pickers) don't need this, and a caller with a real need can opt in.
   */
  historyBack?: boolean;
};

/**
 * Canonical dialog foundation (Central UI Standard, Stage 2), generalized
 * from `PreferredMapChooser.tsx`'s already-proven pattern: portal
 * rendering, focus move-in/trap/return, Escape (topmost-layer-aware via
 * the existing `lib/dialogLayerStack`), backdrop click-to-close, and
 * scroll lock. `ConfirmDialog` is built on top of this; any future
 * general-purpose dialog should be too, rather than re-implementing the
 * same mechanics a third time.
 *
 * Deliberately does not own history/Back integration by default --
 * `historyBack` opts a specific consumer in without changing the
 * baseline behavior for everything else already using this foundation.
 */
export function Dialog({
  open,
  onClose,
  title,
  titleId: titleIdProp,
  description,
  children,
  footer,
  className,
  initialFocusRef,
  historyBack = false,
}: DialogProps) {
  const generatedTitleId = useId();
  const titleId = titleIdProp ?? generatedTitleId;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const pushedHistoryRef = useRef(false);
  const layerIdRef = useRef<symbol | null>(null);
  const onCloseRef = useRef(onClose);
  const [mounted, setMounted] = useState(false);

  onCloseRef.current = onClose;

  useEffect(() => {
    setMounted(true);
  }, []);

  // Move focus in on open; capture and restore the triggering control.
  useEffect(() => {
    if (!open) {
      return;
    }

    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusTarget =
      initialFocusRef?.current ??
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      dialogRef.current;
    focusTarget?.focus();

    return () => {
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Lock background scroll while open. If another dialog is already open
  // underneath, this simply re-applies the same "hidden" value it already
  // set, and restores it correctly on close regardless of nesting order.
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

  // Escape-key priority: only the topmost open dialog should react.
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

  // Optional Back-button integration (opt-in, see `historyBack` above).
  useEffect(() => {
    if (!open || !historyBack) {
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

      const state = window.history.state as Record<string, unknown> | null | undefined;

      if (state && state[HISTORY_MARKER]) {
        return;
      }

      pushedHistoryRef.current = false;
      onCloseRef.current();
    }

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [open, historyBack]);

  const requestClose = useCallback(() => {
    if (historyBack && pushedHistoryRef.current) {
      pushedHistoryRef.current = false;
      window.history.back();
      return;
    }

    onCloseRef.current();
  }, [historyBack]);

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
    if (e.key !== "Tab" || !dialogRef.current) {
      return;
    }

    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
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
    <DialogSurface
      titleId={titleId}
      title={title}
      description={description}
      footer={footer}
      className={className}
      dialogRef={dialogRef}
      onBackdropClick={requestClose}
      onDialogKeyDown={handleTrapKeyDown}
    >
      {children}
    </DialogSurface>,
    document.body,
  );
}

export { DialogSurface };
