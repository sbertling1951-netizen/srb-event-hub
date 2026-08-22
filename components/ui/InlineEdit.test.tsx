import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import {
  attemptInlineEditSave,
  InlineEdit,
  type InlineEditAction,
  inlineEditReducer,
  type InlineEditState,
  InlineEditView,
} from "@/components/ui/InlineEdit";

// Focused tests for the canonical InlineEdit primitive (Central UI
// Standard -- Inline Edit). Two layers of proof, matching the pattern
// already established by Dialog/DialogSurface:
//   1. The pure state machine (inlineEditReducer) and the pure async save
//      orchestration (attemptInlineEditSave) are exercised directly --
//      plain node:test, no renderer, no DOM.
//   2. InlineEditView's markup contract (display mode, editing mode, error/
//      saving/disabled states) is exercised with renderToStaticMarkup, the
//      same way DialogSurface is tested.
// Interactive DOM behavior InlineEditView/InlineEdit's own hooks own
// (focus move-in/out, text selection, real click/keydown dispatch) cannot
// be exercised this way -- renderToStaticMarkup does not attach listeners
// and this repo has no DOM-testing dependency installed (see Dialog.test.tsx's
// own doc comment) -- verified by real-device testing instead, as already
// established for the canonical shell and Dialog.
// Run with: npx tsx --test components/ui/InlineEdit.test.tsx

const source = readFileSync(fileURLToPath(new URL("./InlineEdit.tsx", import.meta.url)), "utf8");

// ---------------------------------------------------------------------------
// inlineEditReducer (pure state machine)
// ---------------------------------------------------------------------------

const DISPLAY: InlineEditState = { mode: "display" };
const EDITING: InlineEditState = { mode: "editing", draft: "Groceries", error: undefined, saving: false };

test("begin enters editing with the given value as the draft, no error, not saving", () => {
  const next = inlineEditReducer(DISPLAY, { type: "begin", value: "Groceries" });
  assert.deepEqual(next, { mode: "editing", draft: "Groceries", error: undefined, saving: false });
});

test("change updates the draft and clears any existing error while editing", () => {
  const withError: InlineEditState = { mode: "editing", draft: "", error: "Required.", saving: false };
  const next = inlineEditReducer(withError, { type: "change", draft: "Produce" });
  assert.deepEqual(next, { mode: "editing", draft: "Produce", error: undefined, saving: false });
});

test("change is a no-op while in display mode", () => {
  const next = inlineEditReducer(DISPLAY, { type: "change", draft: "ignored" });
  assert.deepEqual(next, DISPLAY);
});

test("validation-failed sets the error and leaves saving false, while editing", () => {
  const next = inlineEditReducer(EDITING, { type: "validation-failed", error: "Can't be empty." });
  assert.deepEqual(next, { mode: "editing", draft: "Groceries", error: "Can't be empty.", saving: false });
});

test("validation-failed is a no-op while in display mode", () => {
  const next = inlineEditReducer(DISPLAY, { type: "validation-failed", error: "x" });
  assert.deepEqual(next, DISPLAY);
});

test("save-started sets saving and clears any error, while editing", () => {
  const withError: InlineEditState = { mode: "editing", draft: "Groceries", error: "stale", saving: false };
  const next = inlineEditReducer(withError, { type: "save-started" });
  assert.deepEqual(next, { mode: "editing", draft: "Groceries", error: undefined, saving: true });
});

test("save-succeeded always returns to display mode, discarding draft/error/saving", () => {
  assert.deepEqual(inlineEditReducer(EDITING, { type: "save-succeeded" }), DISPLAY);
  assert.deepEqual(inlineEditReducer(DISPLAY, { type: "save-succeeded" }), DISPLAY);
});

test("save-failed keeps the draft, clears saving, and sets the error, while editing", () => {
  const saving: InlineEditState = { mode: "editing", draft: "Groceries", error: undefined, saving: true };
  const next = inlineEditReducer(saving, { type: "save-failed", error: "Network error." });
  assert.deepEqual(next, { mode: "editing", draft: "Groceries", error: "Network error.", saving: false });
});

test("save-failed is a no-op while in display mode -- nothing to preserve", () => {
  const next = inlineEditReducer(DISPLAY, { type: "save-failed", error: "x" });
  assert.deepEqual(next, DISPLAY);
});

test("cancel always returns to display mode, discarding the draft", () => {
  assert.deepEqual(inlineEditReducer(EDITING, { type: "cancel" }), DISPLAY);
});

// ---------------------------------------------------------------------------
// attemptInlineEditSave (pure async orchestration)
// ---------------------------------------------------------------------------

function makeDispatchRecorder() {
  const actions: InlineEditAction[] = [];
  return { actions, dispatch: (a: InlineEditAction) => actions.push(a) };
}

test("a successful save dispatches save-started then save-succeeded, and resets the guard", async () => {
  const { actions, dispatch } = makeDispatchRecorder();
  const guard = { current: false };
  let onSaveCalledWith: string | undefined;

  await attemptInlineEditSave({
    guard,
    draft: "Produce",
    onSave: async (v) => {
      onSaveCalledWith = v;
    },
    dispatch,
  });

  assert.equal(onSaveCalledWith, "Produce");
  assert.deepEqual(actions, [{ type: "save-started" }, { type: "save-succeeded" }]);
  assert.equal(guard.current, false);
});

test("validation failure dispatches validation-failed and never calls onSave", async () => {
  const { actions, dispatch } = makeDispatchRecorder();
  const guard = { current: false };
  let onSaveCalled = false;

  await attemptInlineEditSave({
    guard,
    draft: "",
    validate: (draft) => (draft.trim() ? undefined : "Required."),
    onSave: async () => {
      onSaveCalled = true;
    },
    dispatch,
  });

  assert.equal(onSaveCalled, false);
  assert.deepEqual(actions, [{ type: "validation-failed", error: "Required." }]);
  assert.equal(guard.current, false);
});

test("a rejected save dispatches save-started then save-failed with the error's message, and resets the guard so retry is possible", async () => {
  const { actions, dispatch } = makeDispatchRecorder();
  const guard = { current: false };

  await attemptInlineEditSave({
    guard,
    draft: "Produce",
    onSave: async () => {
      throw new Error("Network error.");
    },
    dispatch,
  });

  assert.deepEqual(actions, [{ type: "save-started" }, { type: "save-failed", error: "Network error." }]);
  assert.equal(guard.current, false);
});

test("a rejection with a non-Error value falls back to a generic message", async () => {
  const { actions, dispatch } = makeDispatchRecorder();
  const guard = { current: false };

  await attemptInlineEditSave({
    guard,
    draft: "Produce",
    onSave: async () => {
      throw "boom";
    },
    dispatch,
  });

  assert.deepEqual(actions, [
    { type: "save-started" },
    { type: "save-failed", error: "Could not save. Please try again." },
  ]);
});

test("a call while the guard is already set is a no-op -- duplicate-save prevention", async () => {
  const { actions, dispatch } = makeDispatchRecorder();
  const guard = { current: true };
  let onSaveCalled = false;

  await attemptInlineEditSave({
    guard,
    draft: "Produce",
    onSave: async () => {
      onSaveCalled = true;
    },
    dispatch,
  });

  assert.equal(onSaveCalled, false);
  assert.deepEqual(actions, []);
});

test("two saves fired back-to-back before the first settles result in onSave being called exactly once", async () => {
  const { dispatch } = makeDispatchRecorder();
  const guard = { current: false };
  let onSaveCalls = 0;
  let resolveFirst: (() => void) | undefined;

  const onSave = async () => {
    onSaveCalls += 1;
    await new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
  };

  const first = attemptInlineEditSave({ guard, draft: "Produce", onSave, dispatch });
  // Fired synchronously, before the first call's `await onSave(...)` has
  // settled -- this is exactly the race a synchronous ref guard (not
  // state alone) exists to close.
  const second = attemptInlineEditSave({ guard, draft: "Produce", onSave, dispatch });

  resolveFirst?.();
  await Promise.all([first, second]);

  assert.equal(onSaveCalls, 1);
});

// ---------------------------------------------------------------------------
// InlineEditView (pure markup)
// ---------------------------------------------------------------------------

const VIEW_DEFAULTS = {
  saveLabel: "Save",
  cancelLabel: "Cancel",
  inputId: "field-input",
  errorId: "field-error",
};

test("display mode renders a real <button>, not a clickable div, with the value as visible text", () => {
  const html = renderToStaticMarkup(
    <InlineEditView {...VIEW_DEFAULTS} state={DISPLAY} value="Groceries" label="Category name" />,
  );
  assert.match(html, /<button[^>]*class="app-inline-edit-trigger"/);
  assert.match(html, /<span class="app-inline-edit-value">Groceries<\/span>/);
});

test("display mode's accessible name contains both the label and the current value (WCAG 2.5.3 Label in Name)", () => {
  const html = renderToStaticMarkup(
    <InlineEditView {...VIEW_DEFAULTS} state={DISPLAY} value="Groceries" label="Category name" />,
  );
  assert.match(html, /aria-label="Edit Category name: Groceries"/);
});

test("display mode with an empty value shows a placeholder/fallback and the muted empty-state class, and the accessible name omits the value", () => {
  const html = renderToStaticMarkup(
    <InlineEditView {...VIEW_DEFAULTS} state={DISPLAY} value="" label="Category name" placeholder="No category" />,
  );
  assert.match(html, /class="app-inline-edit-value app-inline-edit-empty">No category</);
  assert.match(html, /aria-label="Edit Category name"/);
  assert.equal(/aria-label="Edit Category name:/.test(html), false);
});

test("disabled display mode sets the native disabled attribute and renders no edit-affordance icon", () => {
  const html = renderToStaticMarkup(
    <InlineEditView {...VIEW_DEFAULTS} state={DISPLAY} value="Archived" label="Category name" disabled />,
  );
  assert.match(html, /<button[^>]*disabled=""/);
  assert.equal(html.includes("app-inline-edit-icon"), false);
});

test("enabled display mode renders the edit-affordance icon", () => {
  const html = renderToStaticMarkup(
    <InlineEditView {...VIEW_DEFAULTS} state={DISPLAY} value="Groceries" label="Category name" />,
  );
  assert.match(html, /class="app-inline-edit-icon"/);
});

test("editing mode renders a labeled input (visually-hidden label, real htmlFor/id association) and both Save and Cancel", () => {
  const html = renderToStaticMarkup(
    <InlineEditView {...VIEW_DEFAULTS} state={EDITING} value="Groceries" label="Category name" />,
  );
  assert.match(html, /<label for="field-input" class="sr-only">Category name<\/label>/);
  assert.match(html, /<input[^>]*id="field-input"[^>]*value="Groceries"/);
  assert.match(html, />Save<\/button>/);
  assert.match(html, />Cancel<\/button>/);
});

test("editing mode with no error omits aria-invalid/aria-describedby and renders no error paragraph", () => {
  const html = renderToStaticMarkup(
    <InlineEditView {...VIEW_DEFAULTS} state={EDITING} value="Groceries" label="Category name" />,
  );
  assert.equal(html.includes("aria-invalid"), false);
  assert.equal(html.includes("aria-describedby"), false);
  assert.equal(html.includes("app-inline-edit-error"), false);
});

test("editing mode with an error sets aria-invalid/aria-describedby on the input and renders role=\"alert\"", () => {
  const withError: InlineEditState = { mode: "editing", draft: "", error: "Can't be empty.", saving: false };
  const html = renderToStaticMarkup(
    <InlineEditView {...VIEW_DEFAULTS} state={withError} value="Groceries" label="Category name" />,
  );
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="field-error"/);
  assert.match(
    html,
    /<p id="field-error" class="app-field-error app-inline-edit-error" role="alert">Can&#x27;t be empty\.<\/p>/,
  );
});

test("editing mode while saving disables the input and Cancel, and marks the input aria-busy -- Save shows AppButton's loading affordance", () => {
  const saving: InlineEditState = { mode: "editing", draft: "Groceries", error: undefined, saving: true };
  const html = renderToStaticMarkup(
    <InlineEditView {...VIEW_DEFAULTS} state={saving} value="Groceries" label="Category name" />,
  );
  assert.match(html, /<input[^>]*disabled=""[^>]*aria-busy="true"/);
  const cancelButtonMatch = html.match(/<button[^>]*>Cancel<\/button>/);
  assert.ok(cancelButtonMatch);
  assert.match(cancelButtonMatch![0], /disabled=""/);
  assert.match(html, /aria-busy="true"[^>]*>[\s\S]*?Save/);
});

// ---------------------------------------------------------------------------
// InlineEdit (the wired component) -- SSR only exercises the initial,
// display-mode render (see the file-level doc comment for why edit-mode
// interaction itself is out of scope for this test file).
// ---------------------------------------------------------------------------

test("InlineEdit renders in display mode without a Provider and without throwing, composing the real InlineEditView", () => {
  const html = renderToStaticMarkup(
    <InlineEdit value="Groceries" label="Category name" onSave={() => {}} />,
  );
  assert.ok(html.length > 0);
  assert.match(html, /class="app-inline-edit-trigger"/);
  assert.match(html, /aria-label="Edit Category name: Groceries"/);
});

test("InlineEdit forwards disabled through to the rendered trigger", () => {
  const html = renderToStaticMarkup(
    <InlineEdit value="Archived Events" label="Category name" onSave={() => {}} disabled />,
  );
  assert.match(html, /<button[^>]*disabled=""/);
});

// ---------------------------------------------------------------------------
// Source-level guards for behavior that cannot be exercised via SSR
// ---------------------------------------------------------------------------

test("no element in the file is ever wired to an onBlur prop -- blur can never trigger a save", () => {
  assert.equal(/onBlur\s*[=:]/.test(source), false);
});

test("Tab is never special-cased in the input keydown handler -- only Enter and Escape are intercepted", () => {
  const handlerSource = source.slice(
    source.indexOf("function handleInputKeyDown("),
    source.indexOf("return (", source.indexOf("function handleInputKeyDown(")),
  );
  assert.match(handlerSource, /e\.key === "Enter"/);
  assert.match(handlerSource, /e\.key === "Escape"/);
  assert.equal(/e\.key === "Tab"/.test(handlerSource), false);
});

test("Escape and Cancel share one code path (handleCancel), so their semantics cannot drift apart", () => {
  const handlerSource = source.slice(
    source.indexOf("function handleInputKeyDown("),
    source.indexOf("return (", source.indexOf("function handleInputKeyDown(")),
  );
  assert.match(handlerSource, /handleCancel\(\);/);
  assert.equal(/dispatch\(\{ type: "cancel" \}\);/.test(handlerSource), false);
});

test("duplicate-save prevention is wired through a ref-shaped guard, not component state alone", () => {
  assert.match(source, /const savingGuardRef = useRef\(false\);/);
  assert.match(source, /guard: savingGuardRef,/);
});

test("focus restoration to the trigger, and text selection on entering edit mode, are both present", () => {
  assert.match(source, /inputRef\.current\?\.focus\(\);/);
  assert.match(source, /inputRef\.current\?\.select\(\);/);
  assert.match(source, /triggerRef\.current\?\.focus\(\);/);
});
