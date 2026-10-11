// Pure geometry for creating an Agenda item from empty Calendar time.
// Positions are pixels from the top of a day column; results are minutes
// after midnight on that same day. Selections never cross into another day.

export const AGENDA_CREATE_DRAG_THRESHOLD_PX = 6;
export const AGENDA_CREATE_DEFAULT_MINUTES = 30;

const LAST_MINUTE_OF_DAY = 24 * 60 - 1;

export type AgendaCalendarGeometry = {
  rangeStart: number;
  rangeEnd: number;
  slotMinutes: number;
  slotHeight: number;
};

export type AgendaMinuteRange = { start: number; end: number };

// Movement at or beyond the threshold is a drag (mouse) or a scroll (touch),
// never a click/tap.
export function exceedsAgendaCreateThreshold(dx: number, dy: number) {
  return Math.hypot(dx, dy) >= AGENDA_CREATE_DRAG_THRESHOLD_PX;
}

// Start of the slot containing y, clamped to the displayed day range.
export function agendaSlotStartAt(y: number, geometry: AgendaCalendarGeometry) {
  const { rangeStart, rangeEnd, slotMinutes, slotHeight } = geometry;
  const slotIndex = Math.floor(Math.max(0, y) / slotHeight);
  return Math.min(rangeEnd - slotMinutes, rangeStart + slotIndex * slotMinutes);
}

// The day ends at 23:59 instead of wrapping to 00:00 of the next day.
function endOfDay(end: number) {
  return Math.min(LAST_MINUTE_OF_DAY, end);
}

// Click/tap: the chosen slot with the default duration, kept inside the day.
export function agendaClickRange(y: number, geometry: AgendaCalendarGeometry): AgendaMinuteRange {
  const start = agendaSlotStartAt(y, geometry);
  return {
    start,
    end: endOfDay(Math.min(geometry.rangeEnd, start + AGENDA_CREATE_DEFAULT_MINUTES)),
  };
}

// Drag: every slot touched between the origin and the pointer, in either
// direction, snapped to whole slots (so at least one slot long).
export function agendaDragRange(
  originY: number,
  currentY: number,
  geometry: AgendaCalendarGeometry,
): AgendaMinuteRange {
  const first = agendaSlotStartAt(Math.min(originY, currentY), geometry);
  const last = agendaSlotStartAt(Math.max(originY, currentY), geometry);
  return { start: first, end: endOfDay(last + geometry.slotMinutes) };
}
