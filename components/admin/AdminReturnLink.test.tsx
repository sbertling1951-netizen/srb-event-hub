import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import { AdminReturnLink } from "@/components/admin/AdminReturnLink";

// Focused tests for the "<- Previous" owner-workspace return control. Run:
//   npx tsx --test components/admin/AdminReturnLink.test.tsx

test("renders a real link to the resolved internal route when ?returnTo names an allow-listed workspace", () => {
  const html = renderToStaticMarkup(
    <AdminReturnLink searchParams={new URLSearchParams("returnTo=attendees")} />,
  );

  assert.match(html, /<a /);
  assert.match(html, /href="\/admin\/attendees"/);
  assert.match(html, /Previous/);
  assert.match(html, /aria-label="Back to Attendees"/);
});

test("renders nothing when ?returnTo is missing -- a direct visit gets no Previous control", () => {
  assert.equal(
    renderToStaticMarkup(<AdminReturnLink searchParams={new URLSearchParams("")} />),
    "",
  );
});

test("renders nothing for an unknown / off-app returnTo value -- never a broken or misleading control", () => {
  for (const bad of ["returnTo=dashboard", "returnTo=https://evil.example", "returnTo="]) {
    assert.equal(
      renderToStaticMarkup(<AdminReturnLink searchParams={new URLSearchParams(bad)} />),
      "",
      `"${bad}" must not produce a Previous control`,
    );
  }
});

test("renders nothing when no searchParams object is available", () => {
  assert.equal(renderToStaticMarkup(<AdminReturnLink searchParams={null} />), "");
  assert.equal(renderToStaticMarkup(<AdminReturnLink searchParams={undefined} />), "");
});

test("no I/O and no history/back navigation -- the control is a plain internal Link driven only by the URL key", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./AdminReturnLink.tsx", import.meta.url)),
    "utf8",
  );

  for (const forbidden of [
    "fetch(",
    "supabase",
    "localStorage",
    "sessionStorage",
    ".rpc(",
    "history.back",
    "router.back",
    "useRouter",
  ]) {
    assert.ok(
      !source.includes(forbidden),
      `AdminReturnLink.tsx must not contain "${forbidden}"`,
    );
  }
});
