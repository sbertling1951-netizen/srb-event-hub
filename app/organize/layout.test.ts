import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveOrganizerBackTarget } from "./layout";

// Run with:
//   npx tsx --test app/organize/layout.test.ts

const SOURCE = readFileSync(fileURLToPath(new URL("./layout.tsx", import.meta.url)), "utf8");

test("the organizer shell mounts exactly once, at this layout, for the whole /organize family", () => {
  assert.match(SOURCE, /import \{ OrganizerShellAdapter \} from "@\/components\/shell\/adapters\/OrganizerShellAdapter";/);
  assert.match(SOURCE, /<OrganizerShellAdapter backTarget=\{resolveOrganizerBackTarget\(pathname, eventId\)\}>/);
});

test("the event-root page (/organize/[eventId]) resolves to the Your Event Spaces target", () => {
  const target = resolveOrganizerBackTarget("/organize/abc123", "abc123");
  assert.deepEqual(target, { href: "/organize", label: "Your Event Spaces" });
});

test("every event child route (agenda, budget, checklist, guests, registry, vendors, venues) resolves to the This Event target", () => {
  for (const child of ["agenda", "budget", "checklist", "guests", "registry", "vendors", "venues"]) {
    const target = resolveOrganizerBackTarget(`/organize/abc123/${child}`, "abc123");
    assert.deepEqual(target, { href: "/organize/abc123", label: "This Event" });
  }
});

test("routes with no eventId (/organize, /organize/account) have no back target -- unchanged from before this batch", () => {
  assert.equal(resolveOrganizerBackTarget("/organize", undefined), null);
  assert.equal(resolveOrganizerBackTarget("/organize/account", undefined), null);
});

test("the eventId segment is encoded exactly once via encodeURIComponent, matching the prior page-local links' own encoding", () => {
  const target = resolveOrganizerBackTarget("/organize/has%20space/agenda", "has space");
  assert.deepEqual(target, { href: "/organize/has%20space", label: "This Event" });
});

test("a path-separator-bearing eventId is encoded beneath /organize/ and cannot escape it -- ../outside, abc/def", () => {
  assert.deepEqual(
    resolveOrganizerBackTarget("/organize/..%2Foutside/agenda", "../outside"),
    { href: "/organize/..%2Foutside", label: "This Event" },
  );
  assert.deepEqual(
    resolveOrganizerBackTarget("/organize/abc%2Fdef/agenda", "abc/def"),
    { href: "/organize/abc%2Fdef", label: "This Event" },
  );
});

test("a query-string-shaped eventId cannot construct a malformed query -- ?next=/outside stays a single encoded path segment", () => {
  assert.deepEqual(
    resolveOrganizerBackTarget("/organize/%3Fnext%3D%2Foutside/agenda", "?next=/outside"),
    { href: "/organize/%3Fnext%3D%2Foutside", label: "This Event" },
  );
});

test("a hash-shaped eventId cannot construct a malformed fragment -- #outside stays a single encoded path segment", () => {
  assert.deepEqual(
    resolveOrganizerBackTarget("/organize/%23outside/agenda", "#outside"),
    { href: "/organize/%23outside", label: "This Event" },
  );
});

test("a pathname containing the encoded event-root segment resolves to the Your Event Spaces root target, not the child target", () => {
  assert.deepEqual(
    resolveOrganizerBackTarget("/organize/..%2Foutside", "../outside"),
    { href: "/organize", label: "Your Event Spaces" },
  );
  assert.deepEqual(
    resolveOrganizerBackTarget("/organize/has%20space", "has space"),
    { href: "/organize", label: "Your Event Spaces" },
  );
});
