import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  type CanonicalEventOperationalSummary,
  formatArrivedOfActive,
  toEventOperationalSummaryCards,
} from "./eventOperationalSummary";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./eventOperationalSummary.ts", import.meta.url)),
  "utf8",
);

const SAMPLE: CanonicalEventOperationalSummary = {
  eventId: "event-1",
  totalRegistrations: 100,
  activeRegistrations: 80,
  cancelledRegistrations: 15,
  inactiveRegistrations: 5,
  activeArrived: 30,
  activeNotArrived: 50,
  currentPlacements: 28,
  activeNeedsParkingUnplaced: 12,
};

// ---- Pure presentation functions: unit-testable with plain data. ----

test("toEventOperationalSummaryCards returns all eight settled aggregates, each value copied verbatim from the canonical summary", () => {
  const cards = toEventOperationalSummaryCards(SAMPLE);
  assert.equal(cards.length, 8);
  const byKey = Object.fromEntries(cards.map((c) => [c.key, c.value]));
  assert.deepEqual(byKey, {
    totalRegistrations: 100,
    activeRegistrations: 80,
    cancelledRegistrations: 15,
    inactiveRegistrations: 5,
    activeArrived: 30,
    activeNotArrived: 50,
    currentPlacements: 28,
    activeNeedsParkingUnplaced: 12,
  });
});

test("toEventOperationalSummaryCards uses the contract's exact canonical labels", () => {
  const cards = toEventOperationalSummaryCards(SAMPLE);
  const byKey = Object.fromEntries(cards.map((c) => [c.key, c.label]));
  assert.deepEqual(byKey, {
    totalRegistrations: "Total Registrations",
    activeRegistrations: "Active Registrations",
    cancelledRegistrations: "Cancelled Registrations",
    inactiveRegistrations: "Inactive Registrations",
    activeArrived: "Active Arrived",
    activeNotArrived: "Active Not Arrived",
    currentPlacements: "Current Placements",
    activeNeedsParkingUnplaced: "Active Needs-Parking / Unplaced",
  });
});

test("formatArrivedOfActive composes the two canonical Arrival values without recomputing either", () => {
  assert.equal(formatArrivedOfActive(SAMPLE), "30 of 80");
});

// ---- Structural proof: the adapter cannot create an alternate fact. ----

test("the adapter performs no arithmetic on canonical fields -- no +, -, *, or / touching a summary field", () => {
  const body = SOURCE.slice(SOURCE.indexOf("function toCanonicalSummary"));
  assert.equal(/summary\.\w+\s*[+\-*/]/.test(body), false);
  assert.equal(/row\.\w+\s*[+\-*/]/.test(body), false);
});

test("the adapter never queries a table or issues its own authority check -- all data comes from the RPC result parameter", () => {
  assert.equal(/\.from\(/.test(SOURCE), false);
  assert.equal(/has_event_task_authority|has_platform_admin_authority|has_tenant_admin_authority/.test(SOURCE), false);
});

test("fetchEventOperationalSummary calls only the governed get_event_operational_summary RPC, and no other table or function", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("export async function fetchEventOperationalSummary"));
  assert.match(fn, /\.rpc\("get_event_operational_summary", \{ p_event_id: eventId \}\)/);
  assert.equal((fn.match(/\.rpc\(/g) || []).length, 1);
});

test("fetchEventOperationalSummary distinguishes authorization_denied from a generic load failure, and neither path invents a summary", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("export async function fetchEventOperationalSummary"));
  assert.match(fn, /reason: "authorization_denied"/);
  assert.match(fn, /reason: "load_failed"/);
  assert.equal(/ok: true/.test(fn.slice(0, fn.indexOf("if (!data)"))), false);
});
