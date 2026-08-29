import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import AdminTrustIndicator from "@/components/admin/AdminTrustIndicator";

// Focused tests for the intentionally dormant Admin Trust Indicator boundary
// (docs/architecture/EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md §7, Semantic
// limits: absence of a governed signal is not evidence of
// trustworthiness). Run with:
//   npx tsx --test components/admin/AdminTrustIndicator.test.tsx

test("renders no UI until governed Admin Trust evidence exists", () => {
  const first = renderToStaticMarkup(<AdminTrustIndicator />);
  const second = renderToStaticMarkup(<AdminTrustIndicator />);

  assert.equal(first, "");
  assert.equal(first, second);
});

test("does not fabricate a green/healthy/trustworthy state while unconnected", () => {
  const html = renderToStaticMarkup(<AdminTrustIndicator />);

  for (const forbidden of [
    "green",
    "#0",
    "healthy",
    "trustworthy",
    "all good",
    "All normal",
  ]) {
    assert.ok(
      !html.toLowerCase().includes(forbidden.toLowerCase()),
      `AdminTrustIndicator must never render "${forbidden}"`,
    );
  }
});

test("takes no props -- nothing in the surrounding page can feed it a computed status", () => {
  assert.equal(AdminTrustIndicator.length, 0);
});

test("no I/O: the component source issues no fetch, Supabase, storage, or RPC access, and polls nothing", () => {
  const sourcePath = fileURLToPath(
    new URL("./AdminTrustIndicator.tsx", import.meta.url),
  );
  const source = readFileSync(sourcePath, "utf8");

  for (const forbidden of [
    "fetch(",
    "supabase",
    "localStorage",
    "sessionStorage",
    ".rpc(",
    "useEffect",
    "useState",
    "setInterval",
  ]) {
    assert.ok(
      !source.includes(forbidden),
      `AdminTrustIndicator.tsx must not contain "${forbidden}" -- it must not compute, poll, or infer trust state itself`,
    );
  }
});
