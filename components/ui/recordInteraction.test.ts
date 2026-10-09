import assert from "node:assert/strict";
import test from "node:test";

import type { KeyboardEvent } from "react";

import { recordEditorKeyDown, recordRowProps } from "./recordInteraction";

test("editor saves ordinary text with Enter, but multiline text only with Cmd/Ctrl+Enter", () => {
  for (const [textarea, ctrlKey, metaKey, expected] of [
    [false, false, false, 1], [true, false, false, 0],
    [true, true, false, 1], [true, false, true, 1],
  ] as const) {
    let saves = 0;
    recordEditorKeyDown({key: "Enter", ctrlKey, metaKey, nativeEvent: {isComposing: false},
      target: {closest: (selector: string) => selector === "textarea" && textarea ? {} : null},
      preventDefault() {}, currentTarget: {requestSubmit() { saves++; }},
    } as unknown as KeyboardEvent<HTMLFormElement>);
    assert.equal(saves, expected);
  }
});

test("composition, native pickers and previously handled Enter never submit", () => {
  for (const mode of ["composition", "picker", "handled"]) {
    recordEditorKeyDown({key: "Enter", defaultPrevented: mode === "handled",
      nativeEvent: {isComposing: mode === "composition"},
      target: {closest: () => mode === "picker" ? {} : null},
      preventDefault() {assert.fail("native Enter must remain untouched");},
      currentTarget: {requestSubmit() {assert.fail("unexpected save");}},
    } as unknown as KeyboardEvent<HTMLFormElement>);
  }
});

test("single click selects; double click and focused-row Enter activate editing", () => {
  const actions: string[] = [];
  const props = recordRowProps("record", () => actions.push("select"), () => actions.push("edit"));
  const row = {focus() {}, closest() { return null; }};
  const event = {target: row, currentTarget: row, preventDefault() {}, key: "Enter"};
  props.onClick!(event as never);
  assert.deepEqual(actions, ["select"]);
  props.onDoubleClick!(event as never);
  props.onKeyDown!(event as never);
  assert.deepEqual(actions, ["select", "select", "edit", "edit"]);
});

test("arrows move among sibling records and row actions, without taking native text keys", () => {
  const focus: string[] = [];
  const action = {focus() {focus.push("action");}};
  const next = {focus() {focus.push("next");}, scrollIntoView() {focus.push("reveal");}};
  const row = {closest() {return null;}, parentElement: {querySelectorAll() {return [row, next];}}, querySelectorAll() {return [action];}};
  const handle = recordRowProps("record", () => {}, () => {}).onKeyDown!;
  const event = {currentTarget: row, target: {closest() {return null;}}, preventDefault() {}};
  handle({...event, key: "ArrowDown"} as never);
  handle({...event, target: row, key: "ArrowRight"} as never);
  assert.deepEqual(focus, ["next", "reveal", "action"]);
  handle({...event, target: {closest() {return {}; }}, key: "ArrowDown"} as never);
  handle({...event, defaultPrevented: true, key: "ArrowDown"} as never);
  assert.equal(focus.length, 3);
});
