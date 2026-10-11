/** Compare calendar dates directly; do not shift event dates through browser timezones. */
export function eventScheduleCaution(value: string, start?: string | null, end?: string | null): string | undefined {
  const date = value.slice(0, 10);
  if (!date) {return undefined;}
  if ((start && date < start.slice(0, 10)) || (end && date > end.slice(0, 10))) {
    return "This date is outside the event dates. You can keep it if intentional.";
  }
  return undefined;
}

/** Keep a paired end selectable when its start moves forward. */
export function endAfterStartChange(end: string, start: string, previousStart = ""): string {
  if (!start) {return end;}
  return !end || end === previousStart || end < start ? start : end;
}
