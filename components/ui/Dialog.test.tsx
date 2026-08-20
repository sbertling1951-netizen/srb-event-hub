import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { DialogSurface } from "@/components/ui/Dialog";

// Focused tests for Dialog's markup contract (Central UI Standard, Stage
// 2): correct dialog semantics, labeling, and content/footer composition.
// `DialogSurface` is the pure, portal-free half of `Dialog` -- see its own
// doc comment for why the portal/focus/Escape/stack half cannot be
// exercised this way (React does not render portal content via
// `renderToStaticMarkup`, and this repo has no DOM-testing dependency
// installed). That behavior is verified by real-device testing instead.
// Run with: npx tsx --test components/ui/Dialog.test.tsx

const NOOP_REF = { current: null };

test("renders correct dialog semantics: role, aria-modal, and aria-labelledby pointing at the real heading id", () => {
  const html = renderToStaticMarkup(
    <DialogSurface
      titleId="my-dialog-title"
      title="Delete this event?"
      dialogRef={NOOP_REF}
      onBackdropClick={() => {}}
      onDialogKeyDown={() => {}}
    />,
  );
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="my-dialog-title"/);
  assert.match(html, /<h2 id="my-dialog-title"/);
});

test("the backdrop is role=\"presentation\" -- decorative, not itself part of the dialog's accessible structure", () => {
  const html = renderToStaticMarkup(
    <DialogSurface
      titleId="t"
      title="Title"
      dialogRef={NOOP_REF}
      onBackdropClick={() => {}}
      onDialogKeyDown={() => {}}
    />,
  );
  assert.match(html, /class="app-dialog-backdrop" role="presentation"/);
});

test("description renders as a paragraph when supplied, and is omitted entirely (not an empty element) when not", () => {
  const withDescription = renderToStaticMarkup(
    <DialogSurface
      titleId="t"
      title="Title"
      description="This cannot be undone."
      dialogRef={NOOP_REF}
      onBackdropClick={() => {}}
      onDialogKeyDown={() => {}}
    />,
  );
  assert.match(withDescription, /<p class="app-dialog-description">This cannot be undone\.<\/p>/);

  const withoutDescription = renderToStaticMarkup(
    <DialogSurface
      titleId="t"
      title="Title"
      dialogRef={NOOP_REF}
      onBackdropClick={() => {}}
      onDialogKeyDown={() => {}}
    />,
  );
  assert.equal(withoutDescription.includes("app-dialog-description"), false);
});

test("footer renders inside the shared app-dialog-footer layout wrapper, and is omitted when not supplied", () => {
  const withFooter = renderToStaticMarkup(
    <DialogSurface
      titleId="t"
      title="Title"
      footer={<button type="button">Confirm</button>}
      dialogRef={NOOP_REF}
      onBackdropClick={() => {}}
      onDialogKeyDown={() => {}}
    />,
  );
  assert.match(withFooter, /<div class="app-dialog-footer"><button type="button">Confirm<\/button><\/div>/);

  const withoutFooter = renderToStaticMarkup(
    <DialogSurface
      titleId="t"
      title="Title"
      dialogRef={NOOP_REF}
      onBackdropClick={() => {}}
      onDialogKeyDown={() => {}}
    />,
  );
  assert.equal(withoutFooter.includes("app-dialog-footer"), false);
});

test("children render as arbitrary body content between the description and the footer", () => {
  const html = renderToStaticMarkup(
    <DialogSurface
      titleId="t"
      title="Title"
      description="desc"
      footer={<span>footer</span>}
      dialogRef={NOOP_REF}
      onBackdropClick={() => {}}
      onDialogKeyDown={() => {}}
    >
      <div className="my-body">body content</div>
    </DialogSurface>,
  );
  const descIndex = html.indexOf("app-dialog-description");
  const bodyIndex = html.indexOf("my-body");
  const footerIndex = html.indexOf("app-dialog-footer");
  assert.ok(descIndex < bodyIndex && bodyIndex < footerIndex, "expected description -> body -> footer order");
});

test("an extra className is appended to the dialog panel, alongside (not instead of) app-dialog", () => {
  const html = renderToStaticMarkup(
    <DialogSurface
      titleId="t"
      title="Title"
      className="preferred-map-chooser-like"
      dialogRef={NOOP_REF}
      onBackdropClick={() => {}}
      onDialogKeyDown={() => {}}
    />,
  );
  assert.match(html, /class="app-dialog preferred-map-chooser-like"/);
});
