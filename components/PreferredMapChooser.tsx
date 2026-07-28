"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
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

const HISTORY_MARKER = "__preferredMapChooserOpen";

export type PreferredMapOption = {
  value: string;
  label: string;
};

export type PreferredMapChooserProps = {
  /** Whether the chooser is open. Presentation-only; the consuming page
   * owns the actual preference value. */
  open: boolean;
  /** The currently saved/selected choice, if any (used to highlight the
   * active option). */
  currentPreference: string | null;
  /** Available choices to pick from. No specific values are hardcoded
   * inside this component -- it is not aware that these happen to be map
   * providers, only that they are selectable options. */
  choices: PreferredMapOption[];
  /** Whether the selection should be persisted for future use. */
  rememberChoice: boolean;
  onRememberChoiceChange: (remember: boolean) => void;
  /** Called when the user picks an option. Selecting an option always
   * closes the chooser; this component does not call `onClose` separately
   * in that case. */
  onSelect: (choice: string) => void;
  /** Called on Cancel, Escape, backdrop click, or browser/Android Back.
   * The current preference is left unchanged. */
  onClose: () => void;
  title?: string;
  description?: string;
};

/**
 * Small, focused, reusable "pick one option" dialog. Contains no
 * place-specific or map-specific business logic of its own -- it only
 * renders whatever choices/current-preference the consumer supplies and
 * reports back which one was picked (or that the user cancelled).
 *
 * Presented as a compact dialog centered in the viewport at every size
 * (rather than switching to a full bottom sheet), since its content is a
 * short, fixed list of options rather than a variable amount of object
 * detail -- see `.preferred-map-chooser-*` in `app/globals.css`.
 *
 * Shares the same dialog mechanics as `ObjectPanel` (portal rendering,
 * focus move-in/trap/return, Escape, scroll lock, one pushed history
 * entry) so it behaves correctly whether opened directly or nested on top
 * of an already-open `ObjectPanel`. Nesting is coordinated via
 * `lib/dialogLayerStack` (so Escape closes only the topmost dialog) and a
 * dedicated history-state marker distinct from `ObjectPanel`'s own (so
 * Back closes this chooser first without also closing a panel it was
 * opened from).
 */
export function PreferredMapChooser({
  open,
  currentPreference,
  choices,
  rememberChoice,
  onRememberChoiceChange,
  onSelect,
  onClose,
  title = "Preferred Map",
  description = "Which map would you like to use for directions?",
}: PreferredMapChooserProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstOptionRef = useRef<HTMLButtonElement | null>(null);
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
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const focusTarget = firstOptionRef.current ?? dialogRef.current;
    focusTarget?.focus();

    return () => {
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
  }, [open]);

  // Lock background scroll while open. If an ObjectPanel is already open
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

  // Browser / Android Back closes the chooser first, without disturbing a
  // history entry belonging to a dialog (e.g. ObjectPanel) it was opened
  // from -- see the matching comment in ObjectPanel.tsx.
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
      window.history.back();
    }

    onCloseRef.current();
  }, []);

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
    <div
      className="preferred-map-chooser-backdrop"
      role="presentation"
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="preferred-map-chooser"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleTrapKeyDown}
        tabIndex={-1}
      >
        <h2 id={titleId} className="preferred-map-chooser-title">
          {title}
        </h2>

        {description ? (
          <p className="preferred-map-chooser-description">{description}</p>
        ) : null}

        <div className="preferred-map-chooser-options" role="radiogroup">
          {choices.map((choice, index) => (
            <button
              key={choice.value}
              ref={index === 0 ? firstOptionRef : undefined}
              type="button"
              role="radio"
              aria-checked={currentPreference === choice.value}
              className={`preferred-map-chooser-option${
                currentPreference === choice.value
                  ? " preferred-map-chooser-option-active"
                  : ""
              }`}
              onClick={() => onSelect(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        </div>

        <label className="preferred-map-chooser-remember">
          <input
            type="checkbox"
            checked={rememberChoice}
            onChange={(e) => onRememberChoiceChange(e.target.checked)}
          />
          Remember my choice
        </label>

        <div className="preferred-map-chooser-actions">
          <button
            type="button"
            className="preferred-map-chooser-cancel"
            onClick={requestClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
