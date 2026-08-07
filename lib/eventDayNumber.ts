// Shared, deterministic "which day of the event is this" calculation.
// Used by both the Shared Experience Context Collector's base event slice
// (lib/experienceContext/defaults.ts) and the member dashboard header
// (components/MemberDashboardHeader.tsx) -- one governed calculation
// instead of two independently maintained copies, per Development
// Standards' "eliminate duplicate pathways and redundant logic."
//
// Required semantics:
//   - before startDate -> null (never a fabricated positive Day number
//     before the event begins)
//   - on startDate       -> 1
//   - during the event   -> the correct Day N
//   - after endDate      -> null (never a fabricated in-event Day number
//     once the event has concluded)
//
// Date-parsing convention (preserved, not invented here): startDate/
// endDate are date-only strings ("YYYY-MM-DD"), parsed via the standard
// Date constructor, which the ECMAScript spec defines as UTC for a
// date-only string. Calendar-date comparison then uses LOCAL year/month/
// day components extracted from that instant, compared against `now`'s
// own local components. This exact convention already existed,
// independently, in both callers before this change; it is consolidated
// here unchanged -- no event-specific timezone concept is introduced.
export function computeEventDayNumber(
  startDate: string | null,
  endDate: string | null,
  now: Date,
): number | null {
  if (!startDate) {
    return null;
  }

  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) {
    return null;
  }

  const startDay = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayNumber =
    Math.round((today.getTime() - startDay.getTime()) / 86400000) + 1;

  if (dayNumber < 1) {
    return null;
  }

  if (endDate) {
    const end = new Date(endDate);
    if (!Number.isNaN(end.getTime())) {
      const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
      if (today.getTime() > endDay.getTime()) {
        return null;
      }
    }
  }

  return dayNumber;
}
