// The existing cancellation timestamp stays authoritative. The input displays
// browser-local time; converting it back must not silently normalize bad dates
// or nonexistent daylight-saving times.
export function cancellationDateInput(value: string | null | undefined): string {
  if (!value) {return "";}
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {return "";}
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseCancellationDate(value: string, now = new Date()): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("Enter a cancellation date and time.");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || cancellationDateInput(date.toISOString()) !== value) {
    throw new Error("Enter a valid cancellation date and time.");
  }
  if (date.getTime() > now.getTime()) {
    throw new Error("The cancellation date cannot be in the future.");
  }
  return date.toISOString();
}
