import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { Checkbox, Field, Input, Radio, Select, Textarea } from "@/components/ui/Field";

// Focused tests for the canonical Field/Input/Select/Textarea/Checkbox/
// Radio primitives (Central UI Standard, Stage 2): label/control
// association, required indication, help/error wiring, and that
// Input/Select/Textarea apply the one consolidated .app-control class.
// Run with: npx tsx --test components/ui/Field.test.tsx

test("Field's label htmlFor matches the id it hands the control render-prop -- real, working label association", () => {
  const html = renderToStaticMarkup(
    <Field label="Event name">{(controlProps) => <Input {...controlProps} />}</Field>,
  );
  const forMatch = html.match(/<label for="([^"]+)"/);
  const idMatch = html.match(/<input[^>]*\bid="([^"]+)"/);
  assert.ok(forMatch, "expected a label[for]");
  assert.ok(idMatch, "expected the input to carry an id");
  assert.equal(forMatch![1], idMatch![1]);
});

test("required renders a visible, aria-hidden asterisk and sets aria-required on the control -- not color/asterisk alone as the accessible signal", () => {
  const html = renderToStaticMarkup(
    <Field label="Event name" required>
      {(controlProps) => <Input {...controlProps} />}
    </Field>,
  );
  assert.match(html, /<span class="app-field-required" aria-hidden="true">/);
  assert.match(html, /aria-required="true"/);
});

test("without required, no asterisk and no aria-required is rendered", () => {
  const html = renderToStaticMarkup(
    <Field label="Event name">{(controlProps) => <Input {...controlProps} />}</Field>,
  );
  assert.equal(html.includes("app-field-required"), false);
  assert.equal(html.includes("aria-required"), false);
});

test("help text renders and is wired to the control via aria-describedby", () => {
  const html = renderToStaticMarkup(
    <Field label="Event name" help="Shown to attendees.">
      {(controlProps) => <Input {...controlProps} />}
    </Field>,
  );
  const helpMatch = html.match(/<p id="([^"]+)" class="app-field-help">Shown to attendees\.<\/p>/);
  assert.ok(helpMatch, "expected the help paragraph with a real id");
  assert.match(html, new RegExp(`aria-describedby="${helpMatch![1]}"`));
});

test("error text renders with role=\"alert\", sets aria-invalid on the control, and is included in aria-describedby alongside help", () => {
  const html = renderToStaticMarkup(
    <Field label="Event name" help="Shown to attendees." error="Name is required.">
      {(controlProps) => <Input {...controlProps} />}
    </Field>,
  );
  assert.match(html, /<p id="[^"]+-error" class="app-field-error" role="alert">Name is required\.<\/p>/);
  assert.match(html, /aria-invalid="true"/);
  // aria-describedby must reference BOTH the help id and the error id.
  const describedByMatch = html.match(/aria-describedby="([^"]+)"/);
  assert.ok(describedByMatch);
  const ids = describedByMatch![1].split(" ");
  assert.equal(ids.length, 2);
});

test("with neither help nor error, aria-describedby is omitted entirely rather than an empty string", () => {
  const html = renderToStaticMarkup(
    <Field label="Event name">{(controlProps) => <Input {...controlProps} />}</Field>,
  );
  assert.equal(html.includes("aria-describedby"), false);
});

test("disabled adds app-field-disabled to the wrapper and passes disabled through to the control", () => {
  const html = renderToStaticMarkup(
    <Field label="Event name" disabled>
      {(controlProps) => <Input {...controlProps} />}
    </Field>,
  );
  assert.match(html, /class="app-field app-field-disabled"/);
  assert.match(html, /disabled=""/);
});

test("Input/Select/Textarea each apply the canonical app-control class, appended alongside (not instead of) any caller className", () => {
  const input = renderToStaticMarkup(<Input className="extra" />);
  assert.match(input, /class="app-control extra"/);

  const select = renderToStaticMarkup(
    <Select>
      <option>One</option>
    </Select>,
  );
  assert.match(select, /<select class="app-control">/);

  const textarea = renderToStaticMarkup(<Textarea />);
  assert.match(textarea, /<textarea class="app-control">/);
});

test("Checkbox associates its label via htmlFor/id and wires help text through aria-describedby, same as Field", () => {
  const html = renderToStaticMarkup(<Checkbox label="Pinned" help="Shows at the top of the list." />);
  const forMatch = html.match(/<label for="([^"]+)"/);
  const idMatch = html.match(/<input[^>]*\bid="([^"]+)"/);
  assert.ok(forMatch && idMatch);
  assert.equal(forMatch![1], idMatch![1]);
  assert.match(html, /type="checkbox"/);
  const helpMatch = html.match(/<p id="([^"]+)" class="app-field-help">/);
  assert.ok(helpMatch);
  assert.match(html, new RegExp(`aria-describedby="${helpMatch![1]}"`));
});

test("Radio renders type=\"radio\" with the same label/help/error shape as Checkbox", () => {
  const html = renderToStaticMarkup(<Radio label="Option A" />);
  assert.match(html, /type="radio"/);
  const forMatch = html.match(/<label for="([^"]+)"/);
  const idMatch = html.match(/<input[^>]*\bid="([^"]+)"/);
  assert.ok(forMatch && idMatch);
  assert.equal(forMatch![1], idMatch![1]);
});

test("Checkbox/Radio accept an explicit id from the caller instead of generating one -- useful when a caller already owns the id", () => {
  const html = renderToStaticMarkup(<Checkbox label="Pinned" id="announcement-pinned" />);
  assert.match(html, /<label for="announcement-pinned"/);
  assert.match(html, /id="announcement-pinned"/);
});
