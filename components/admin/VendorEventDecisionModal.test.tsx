import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Focused tests for the Admin Batch 3 Central UI Standard migration of
// VendorEventDecisionModal -- one of the ten independent role="dialog"
// implementations the blueprint's own Part 1 audit flagged as lacking
// Escape handling and focus-trap/return-focus logic. Converting it onto
// the canonical Dialog primitive closes that real accessibility gap.
// Run with:
//   npx tsx --test components/admin/VendorEventDecisionModal.test.tsx

const source = readFileSync(
  fileURLToPath(new URL("./VendorEventDecisionModal.tsx", import.meta.url)),
  "utf8",
);

test("the hand-rolled role=\"dialog\" overlay is gone -- the canonical Dialog primitive now owns focus trap, Escape, backdrop, and scroll lock", () => {
  assert.match(source, /import \{ Dialog \} from "@\/components\/ui\/Dialog";/);
  assert.match(source, /<Dialog\s*\n\s*open=\{open\}/);
  assert.equal(/role="dialog"/.test(source), false);
  assert.equal(/aria-modal="true"/.test(source), false);
  assert.equal(/position: "fixed"/.test(source), false);
});

test("closing while busy remains blocked -- Dialog's onClose is gated on !busy, matching the original onClick={busy ? undefined : onCancel} behavior", () => {
  const dialogIdx = source.indexOf("<Dialog");
  const onCloseIdx = source.indexOf("onClose={", dialogIdx);
  const onCloseBody = source.slice(onCloseIdx, source.indexOf("}}", onCloseIdx) + 2);
  assert.match(onCloseBody, /if \(!busy\)/);
  assert.match(onCloseBody, /onCancel\(\);/);
});

test("Cancel and the destructive Reject/Revoke confirm both render as real AppButtons in the Dialog's footer -- Confirm uses variant=\"stop\", the one place a solid destructive fill belongs, matching ConfirmDialog's own reserved scope", () => {
  const footerIdx = source.indexOf("footer={");
  const footerEnd = source.indexOf("}\n      children", footerIdx);
  const footerBlock = source.slice(footerIdx, footerEnd === -1 ? footerIdx + 700 : footerEnd);
  assert.match(footerBlock, /<AppButton onClick=\{onCancel\} disabled=\{busy\}>/);
  assert.match(footerBlock, /variant="stop"/);
  assert.match(footerBlock, /loading=\{busy\}/);
});

test("handleConfirm's validation and onConfirm(reasonCode, reasonText) contract is byte-identical -- only the modal shell changed", () => {
  const fnIdx = source.indexOf("function handleConfirm() {");
  const fnBody = source.slice(fnIdx, source.indexOf("\n  }", fnIdx));
  assert.match(fnBody, /if \(!selectedCode\) \{/);
  assert.match(fnBody, /setValidationError\("Select a reason before continuing\."\);/);
  assert.match(fnBody, /void onConfirm\(selectedCode, reasonText\.trim\(\) \|\| null\);/);
});

test("the reason catalog is still loaded live from listVendorDispositionReasonCodes on open -- no hardcoded second reason list was introduced", () => {
  assert.match(source, /listVendorDispositionReasonCodes\(\)/);
  assert.match(source, /import \{\s*\n\s*listVendorDispositionReasonCodes,/);
});

test("the classification-grouped, color-coded reason cards remain specialized raw radio markup -- not forced into the generic Radio primitive, which would lose the classification-color selected-state treatment", () => {
  assert.match(source, /type="radio"/);
  assert.match(source, /name="vendor-event-decision-reason"/);
  assert.match(source, /REASON_CLASSIFICATION_COLORS/);
  assert.equal(/from "@\/components\/ui\/Field"[^;]*Radio/.test(source), false);
});

test("the supporting-detail textarea and load/validation errors route through the canonical Field/Textarea/Alert/LoadingState primitives", () => {
  assert.match(source, /import \{ Field, Textarea \} from "@\/components\/ui\/Field";/);
  assert.match(source, /<Field label="Supporting detail \(optional\)">/);
  assert.match(source, /import \{ Alert \} from "@\/components\/ui\/Alert";/);
  assert.match(source, /<Alert tone="danger">\{loadError\}<\/Alert>/);
  assert.match(source, /<Alert tone="danger">\{validationError\}<\/Alert>/);
  assert.match(source, /import \{ LoadingState \} from "@\/components\/ui\/LoadingState";/);
  assert.match(source, /<LoadingState message="Loading reason options\.\.\." \/>/);
});
