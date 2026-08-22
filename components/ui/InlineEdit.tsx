"use client";

import {
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useReducer,
  useRef,
} from "react";

import { AppButton } from "@/components/ui/AppButton";

/**
 * Pure state machine for InlineEdit (Central UI Standard -- Inline Edit).
 * Kept free of React/DOM so the full begin/change/validate/save/cancel
 * contract can be unit-tested directly (`node:test`, no renderer needed)
 * -- the same split `Dialog.tsx` already uses between its portal/focus
 * mechanics and `DialogSurface`'s pure markup, one layer earlier, for
 * state instead of markup.
 */
export type InlineEditState =
  | { mode: "display" }
  | { mode: "editing"; draft: string; error: string | undefined; saving: boolean };

export type InlineEditAction =
  | { type: "begin"; value: string }
  | { type: "change"; draft: string }
  | { type: "validation-failed"; error: string }
  | { type: "save-started" }
  | { type: "save-succeeded" }
  | { type: "save-failed"; error: string }
  | { type: "cancel" };

export const INLINE_EDIT_INITIAL_STATE: InlineEditState = { mode: "display" };

export function inlineEditReducer(state: InlineEditState, action: InlineEditAction): InlineEditState {
  switch (action.type) {
    case "begin":
      return { mode: "editing", draft: action.value, error: undefined, saving: false };
    case "change":
      // Clear a stale validation error as soon as the draft changes -- an
      // error tied to a value the user has already edited away from would
      // be misleading, not helpful.
      return state.mode === "editing" ? { ...state, draft: action.draft, error: undefined } : state;
    case "validation-failed":
      return state.mode === "editing" ? { ...state, error: action.error, saving: false } : state;
    case "save-started":
      return state.mode === "editing" ? { ...state, error: undefined, saving: true } : state;
    case "save-succeeded":
      return { mode: "display" };
    case "save-failed":
      return state.mode === "editing" ? { ...state, saving: false, error: action.error } : state;
    case "cancel":
      return { mode: "display" };
    default:
      return state;
  }
}

/**
 * Async save orchestration, kept separate from the component so it can be
 * unit-tested with a controllable fake `onSave` and no DOM: duplicate-save
 * prevention, validate-before-save, and success/failure dispatch are all
 * exercised directly. `guard` is a plain ref-shaped object so a
 * synchronous flag can block a second call arriving before the first
 * `await` yields -- state updated only via `dispatch` would not be visible
 * until React's next render, too late to stop a second synchronous
 * click/Enter from also calling `onSave`.
 */
export type InlineEditSaveDeps = {
  guard: RefObject<boolean>;
  draft: string;
  validate?: (draft: string) => string | undefined;
  onSave: (value: string) => void | Promise<void>;
  dispatch: (action: InlineEditAction) => void;
};

export async function attemptInlineEditSave({
  guard,
  draft,
  validate,
  onSave,
  dispatch,
}: InlineEditSaveDeps): Promise<void> {
  if (guard.current) {
    return;
  }

  const validationError = validate?.(draft);
  if (validationError) {
    dispatch({ type: "validation-failed", error: validationError });
    return;
  }

  guard.current = true;
  dispatch({ type: "save-started" });

  try {
    await onSave(draft);
    guard.current = false;
    dispatch({ type: "save-succeeded" });
  } catch (err) {
    guard.current = false;
    dispatch({
      type: "save-failed",
      error: err instanceof Error && err.message ? err.message : "Could not save. Please try again.",
    });
  }
}

function EditPencilIcon() {
  return (
    <svg className="app-inline-edit-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M11.3 1.7a1.5 1.5 0 0 1 2.12 2.12L5.5 11.74l-2.8.7.7-2.8 7.9-7.94Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type InlineEditViewProps = {
  state: InlineEditState;
  value: string;
  label: string;
  disabled?: boolean;
  placeholder?: string;
  saveLabel: string;
  cancelLabel: string;
  className?: string;
  inputId: string;
  errorId: string;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  inputRef?: RefObject<HTMLInputElement | null>;
  onTriggerClick?: () => void;
  onDraftChange?: (value: string) => void;
  onInputKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  onSaveClick?: () => void;
  onCancelClick?: () => void;
};

/**
 * The pure markup half of InlineEdit -- takes state explicitly and owns no
 * hooks/effects of its own, so it can be exercised with a plain
 * `renderToStaticMarkup` test in either mode (display or editing, with or
 * without an error/saving state), the same way `DialogSurface` is tested.
 */
export function InlineEditView({
  state,
  value,
  label,
  disabled = false,
  placeholder,
  saveLabel,
  cancelLabel,
  className,
  inputId,
  errorId,
  triggerRef,
  inputRef,
  onTriggerClick,
  onDraftChange,
  onInputKeyDown,
  onSaveClick,
  onCancelClick,
}: InlineEditViewProps) {
  if (state.mode === "editing") {
    const { draft, error, saving } = state;
    return (
      <div className={["app-inline-edit-editing", className].filter(Boolean).join(" ")}>
        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="app-control app-inline-edit-input"
          type="text"
          value={draft}
          placeholder={placeholder}
          disabled={saving}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          aria-busy={saving || undefined}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onDraftChange?.(e.target.value)}
          onKeyDown={onInputKeyDown}
        />
        <div className="app-inline-edit-actions">
          <AppButton variant="primary" onClick={onSaveClick} loading={saving}>
            {saveLabel}
          </AppButton>
          <AppButton onClick={onCancelClick} disabled={saving}>
            {cancelLabel}
          </AppButton>
        </div>
        {error ? (
          <p id={errorId} className="app-field-error app-inline-edit-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const accessibleName = `Edit ${label}${value ? `: ${value}` : ""}`;

  return (
    <button
      ref={triggerRef}
      type="button"
      className={["app-inline-edit-trigger", className].filter(Boolean).join(" ")}
      onClick={onTriggerClick}
      disabled={disabled}
      aria-label={accessibleName}
    >
      {value ? (
        <span className="app-inline-edit-value">{value}</span>
      ) : (
        <span className="app-inline-edit-value app-inline-edit-empty">{placeholder || "Not set"}</span>
      )}
      {disabled ? null : <EditPencilIcon />}
    </button>
  );
}

export type InlineEditProps = {
  /** The committed value, owned by the caller -- InlineEdit never persists
   * anything itself (see `onSave`). */
  value: string;
  /** Accessible name for the field, e.g. "Category name". Combined with
   * the current value as "Edit {label}: {value}" for the display-mode
   * trigger's accessible name (WCAG 2.5.3 Label in Name -- the visible
   * value text stays part of what a voice-control user can target), and
   * used alone as a visually-hidden `<label>` for the edit-mode input. */
  label: string;
  /** Called with the draft value on Save (Enter or the visible Save
   * button). May be sync or async; InlineEdit stays in a saving state
   * until the returned promise settles and only leaves edit mode after it
   * resolves. A thrown error / rejected promise keeps the draft and shows
   * its message. Persistence and business validation are entirely the
   * caller's concern -- InlineEdit assumes nothing about what `onSave`
   * actually does. */
  onSave: (nextValue: string) => void | Promise<void>;
  /** Returns an error message to block Save, or `undefined`/falsy when the
   * draft is acceptable. What "valid" means is entirely up to the caller
   * -- InlineEdit only owns the announce/associate/block mechanics. */
  validate?: (draft: string) => string | undefined;
  /** Read-only: the trigger renders but cannot be activated. */
  disabled?: boolean;
  placeholder?: string;
  saveLabel?: string;
  cancelLabel?: string;
  className?: string;
};

/**
 * Canonical inline-edit primitive (Central UI Standard -- Inline Edit).
 * For a SIMPLE atomic value where the surrounding context should stay
 * visible: tap/click the value, edit it in place, Enter or the visible
 * Save button commits, Escape or the visible Cancel button discards.
 * Blur/click-outside never saves, under any circumstance -- a data change
 * is always an explicit Save.
 *
 * Not intended for multi-field records, destructive actions, or anything
 * needing a confirmation step -- reach for `Dialog`/`ConfirmDialog` there
 * instead.
 */
export function InlineEdit({
  value,
  label,
  onSave,
  validate,
  disabled = false,
  placeholder,
  saveLabel = "Save",
  cancelLabel = "Cancel",
  className,
}: InlineEditProps) {
  const [state, dispatch] = useReducer(inlineEditReducer, INLINE_EDIT_INITIAL_STATE);
  const savingGuardRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevModeRef = useRef(state.mode);
  const reactId = useId();
  const inputId = `${reactId}-inline-edit-input`;
  const errorId = `${reactId}-inline-edit-error`;

  // Move focus into the input when edit mode begins (selecting existing
  // text so replacing a short value is a single keystroke); move focus
  // back to the trigger after Save or Cancel returns to display mode.
  // Neither branch fires on mount, since prevModeRef starts equal to the
  // initial state.
  useEffect(() => {
    const prevMode = prevModeRef.current;
    prevModeRef.current = state.mode;

    if (state.mode === "editing" && prevMode !== "editing") {
      inputRef.current?.focus();
      inputRef.current?.select();
    }

    if (state.mode === "display" && prevMode === "editing") {
      triggerRef.current?.focus();
    }
  }, [state.mode]);

  function beginEdit() {
    if (disabled) {
      return;
    }
    dispatch({ type: "begin", value });
  }

  function handleCancel() {
    // Inert while a save is in flight -- see attemptInlineEditSave's own
    // doc comment for the race this avoids (a stale save resolving after
    // the user has already moved on to a new edit).
    if (state.mode === "editing" && state.saving) {
      return;
    }
    dispatch({ type: "cancel" });
  }

  function handleSave() {
    if (state.mode !== "editing") {
      return;
    }
    void attemptInlineEditSave({
      guard: savingGuardRef,
      draft: state.draft,
      validate,
      onSave,
      dispatch,
    });
  }

  function handleInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
    // Every other key, including Tab, is left alone -- normal focus
    // traversal, never an implicit save. There is deliberately no onBlur
    // handler anywhere in this component: silent save-on-blur is
    // explicitly prohibited by the interaction contract.
  }

  return (
    <InlineEditView
      state={state}
      value={value}
      label={label}
      disabled={disabled}
      placeholder={placeholder}
      saveLabel={saveLabel}
      cancelLabel={cancelLabel}
      className={className}
      inputId={inputId}
      errorId={errorId}
      triggerRef={triggerRef}
      inputRef={inputRef}
      onTriggerClick={beginEdit}
      onDraftChange={(next) => dispatch({ type: "change", draft: next })}
      onInputKeyDown={handleInputKeyDown}
      onSaveClick={handleSave}
      onCancelClick={handleCancel}
    />
  );
}
