import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  agendaEditFieldsAreEqual,
  type AgendaEditRowFields,
  shouldCloseAgendaEditAfterSave,
  shouldSubmitAgendaEditOnEnter,
} from "@/components/admin/agenda/AgendaEditRowDialog";

const DIALOG_SOURCE = readFileSync(
  fileURLToPath(new URL("./AgendaEditRowDialog.tsx", import.meta.url)),
  "utf8",
);
const WORKSPACE_SOURCE = readFileSync(
  fileURLToPath(new URL("./AgendaImportReviewWorkspace.tsx", import.meta.url)),
  "utf8",
);

const BASE_FIELDS: AgendaEditRowFields = {
  Title: "Dinner",
  Description: "Evening meal",
  Location: "Garden Pavilion",
  Speaker: "Jordan Lee",
  "Agenda Date": "2026-11-04",
  "Start Time": "17:00",
  "End Time": "19:00",
  Category: "Meal",
  Color: "#FDE68A",
  Published: true,
  "Sort Order": "12",
};

function keyEventTarget(
  tagName: string,
  options: {
    type?: string;
    readOnly?: boolean;
    disabled?: boolean;
    isContentEditable?: boolean;
  } = {},
) {
  return { tagName, ...options } as unknown as EventTarget;
}

function enterEvent(target: EventTarget) {
  return {
    key: "Enter",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    target,
  };
}

test("Enter in a normal single-line edit input submits through the one correction save path", () => {
  assert.equal(
    shouldSubmitAgendaEditOnEnter(
      enterEvent(keyEventTarget("INPUT", { type: "text" })),
    ),
    true,
  );
  assert.match(
    DIALOG_SOURCE,
    /function handleDialogKeyDown[\s\S]*?event\.preventDefault\(\);\s*\n\s*void handleSave\(\);/,
  );
  assert.match(
    DIALOG_SOURCE,
    /<AppButton variant="primary" loading=\{saving\} onClick=\{\(\) => void handleSave\(\)\}>/,
  );
  assert.equal(
    (DIALOG_SOURCE.match(/correctAgendaImportRow\(\{/g) || []).length,
    1,
  );
});

test("successful valid Save closes only after the governed correction result and recovery callback retains it", () => {
  assert.equal(shouldCloseAgendaEditAfterSave("approved"), true);
  assert.match(
    DIALOG_SOURCE,
    /const shouldClose = shouldCloseAgendaEditAfterSave\(result\.rowState\);[\s\S]*?await onSaved\(/,
  );
  assert.match(
    WORKSPACE_SOURCE,
    /onSaved=\{async \(message, shouldClose\) => \{[\s\S]*?if \(shouldClose\) \{\s*\n\s*setEditOpen\(false\);[\s\S]*?await onRowsChanged\(message\);/,
  );
});

test("invalid Save uses the same governed path but remains open with the existing validation guidance", () => {
  assert.equal(shouldCloseAgendaEditAfterSave("validation_failed"), false);
  assert.match(DIALOG_SOURCE, /interpretation\.issues\.length/);
  assert.match(
    DIALOG_SOURCE,
    /You can still save this correction\. It will remain in Needs Attention/,
  );
  assert.match(
    WORKSPACE_SOURCE,
    /if \(shouldClose\) \{\s*\n\s*setEditOpen\(false\);\s*\n\s*\}\s*\n\s*await onRowsChanged\(message\);/,
  );
});

test("Enter in multiline and native-control contexts keeps native behavior and never submits", () => {
  assert.equal(shouldSubmitAgendaEditOnEnter(enterEvent(keyEventTarget("TEXTAREA"))), false);
  assert.equal(shouldSubmitAgendaEditOnEnter(enterEvent(keyEventTarget("SELECT"))), false);
  assert.equal(
    shouldSubmitAgendaEditOnEnter(
      enterEvent(keyEventTarget("INPUT", { type: "checkbox" })),
    ),
    false,
  );
  assert.equal(shouldSubmitAgendaEditOnEnter(enterEvent(keyEventTarget("BUTTON"))), false);
  assert.equal(
    shouldSubmitAgendaEditOnEnter(
      enterEvent(keyEventTarget("INPUT", { type: "text", readOnly: true })),
    ),
    false,
  );
});

test("outside interaction cannot dismiss or reset the Agenda edit panel", () => {
  assert.match(DIALOG_SOURCE, /dismissOnBackdrop=\{false\}/);
  assert.doesNotMatch(DIALOG_SOURCE, /onBlur\s*=/);
  assert.match(DIALOG_SOURCE, /setFields\(\(prev\) => \(\{ \.\.\.prev, \[key\]: value \}\)\)/);
});

test("dirty detection preserves edits until an explicit confirmed discard", () => {
  assert.equal(agendaEditFieldsAreEqual(BASE_FIELDS, { ...BASE_FIELDS }), true);
  assert.equal(
    agendaEditFieldsAreEqual(BASE_FIELDS, {
      ...BASE_FIELDS,
      Title: "Changed Dinner",
    }),
    false,
  );
  assert.match(
    DIALOG_SOURCE,
    /const isDirty =[\s\S]*?agendaEditFieldsAreEqual[\s\S]*?reasonCode !== DEFAULT_CORRECTION_REASON/,
  );
  assert.match(
    DIALOG_SOURCE,
    /function requestClose\(\)[\s\S]*?if \(isDirty\) \{\s*\n\s*setDiscardConfirmOpen\(true\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*onCancel\(\);/,
  );
  assert.match(DIALOG_SOURCE, /title="Discard unsaved changes\?"/);
  assert.match(DIALOG_SOURCE, /confirmLabel="Discard Changes"/);
  assert.match(DIALOG_SOURCE, /cancelLabel="Keep Editing"/);
  assert.match(DIALOG_SOURCE, /onClose=\{requestClose\}/);
  assert.match(DIALOG_SOURCE, /<AppButton onClick=\{requestClose\}/);
});
