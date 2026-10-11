import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AGENDA_CREATE_DRAG_THRESHOLD_PX,
  agendaClickRange,
  agendaDragRange,
  agendaSlotStartAt,
  exceedsAgendaCreateThreshold,
} from "@/lib/agendaCreationGesture";

// 07:00-22:00 in 15-minute, 28px slots, matching the Admin Agenda Calendar.
const day = { rangeStart: 7 * 60, rangeEnd: 22 * 60, slotMinutes: 15, slotHeight: 28 };
const fullDay = { ...day, rangeStart: 0, rangeEnd: 24 * 60 };

test("movement below 6px is a click/tap; 6px or more is a drag or scroll", () => {
  assert.equal(AGENDA_CREATE_DRAG_THRESHOLD_PX, 6);
  assert.equal(exceedsAgendaCreateThreshold(0, 0), false);
  assert.equal(exceedsAgendaCreateThreshold(3, 4.9), false);
  assert.equal(exceedsAgendaCreateThreshold(0, 6), true);
  assert.equal(exceedsAgendaCreateThreshold(-6, 0), true);
  assert.equal(exceedsAgendaCreateThreshold(3, 6), true);
});

test("slot positions snap down to 15 minutes and clamp to the displayed day", () => {
  assert.equal(agendaSlotStartAt(0, day), 7 * 60);
  assert.equal(agendaSlotStartAt(27.9, day), 7 * 60);
  assert.equal(agendaSlotStartAt(28, day), 7 * 60 + 15);
  assert.equal(agendaSlotStartAt(-40, day), 7 * 60);
  assert.equal(agendaSlotStartAt(100_000, day), 22 * 60 - 15);
});

test("click/tap opens the chosen slot with a 30-minute default inside the day", () => {
  assert.deepEqual(agendaClickRange(28 * 4 + 5, day), { start: 8 * 60, end: 8 * 60 + 30 });
  // The last slot cannot extend past the displayed range.
  assert.deepEqual(agendaClickRange(100_000, day), { start: 22 * 60 - 15, end: 22 * 60 });
  // A full-day range ends at 23:59, never wrapping to the next day.
  assert.deepEqual(agendaClickRange(100_000, fullDay), { start: 24 * 60 - 15, end: 24 * 60 - 1 });
});

test("dragging selects whole slots forward or backward with a 15-minute minimum", () => {
  const forward = agendaDragRange(28 * 4 + 2, 28 * 7 + 20, day);
  const backward = agendaDragRange(28 * 7 + 20, 28 * 4 + 2, day);
  assert.deepEqual(forward, { start: 8 * 60, end: 9 * 60 });
  assert.deepEqual(backward, forward);
  assert.deepEqual(agendaDragRange(30, 50, day), { start: 7 * 60 + 15, end: 7 * 60 + 30 });
});

test("dragging beyond the column clamps to the same day's range", () => {
  assert.deepEqual(agendaDragRange(28 * 2, -500, day), { start: 7 * 60, end: 7 * 60 + 45 });
  assert.deepEqual(agendaDragRange(28 * 2, 100_000, day), { start: 7 * 60 + 30, end: 22 * 60 });
  assert.deepEqual(agendaDragRange(28 * 90, 100_000, fullDay), { start: 22 * 60 + 30, end: 24 * 60 - 1 });
});
