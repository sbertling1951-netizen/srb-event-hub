"use client";

/**
 * A small organizer-only 24-hour `HH:MM` time entry, replacing the native
 * `<input type="time">` in the organizer Agenda form.
 *
 * Why: Safari renders `type="time"` as a locale-driven segmented `05:00 PM`
 * control, which conflicts with the organizer planner's fixed 24-hour readback
 * (`17:00`) and is awkward for keyboard editing. This is a plain text input
 * that renders and emits canonical `HH:MM` only.
 *
 * It is NOT a public/member-facing formatter. Member/guest agenda displays
 * (friendly 12-hour, e.g. `5:00 PM`) are a separate, later concern and do not
 * exist yet. Database values, RPC arguments, and validation semantics are
 * unchanged: this component only shapes what the planner types into the same
 * canonical `HH:MM` (or empty) string the adapter already sends.
 */

const CANONICAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True only for a valid canonical 24-hour `HH:MM` string. */
export function isCanonicalTime(value: string): boolean {
  return CANONICAL_TIME.test(value);
}

/**
 * Live keystroke shaping: keep digits (and a single colon), auto-insert the
 * colon once the hour is complete, and cap at `HH:MM`. Deliberately lenient --
 * a still-invalid partial (`17:`, `9`, `93:0`) is left visible for the planner
 * to finish/fix; final canonicalization happens on blur.
 */
export function normalizeTimeInput(raw: string): string {
  const cleaned = raw.replace(/[^\d:]/g, "");
  const colon = cleaned.indexOf(":");
  if (colon === -1) {
    if (cleaned.length > 2) {
      return `${cleaned.slice(0, 2)}:${cleaned.slice(2, 4)}`;
    }
    return cleaned.slice(0, 2);
  }
  const hours = cleaned.slice(0, colon).replace(/:/g, "").slice(0, 2);
  const minutes = cleaned.slice(colon + 1).replace(/:/g, "").slice(0, 2);
  return `${hours}:${minutes}`;
}

/**
 * On-blur canonicalization: `1700` -> `17:00`, `17` -> `17:00`, `9:5` ->
 * `09:05`, `930` -> `09:30`, `` -> ``. An out-of-range result (`25:00`,
 * `17:70`) is left as-is so the form's own validation surfaces it -- it is
 * never silently coerced into a different valid time.
 */
export function finalizeTimeInput(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    return "";
  }

  let hours: string;
  let minutes: string;
  if (trimmed.includes(":")) {
    const [rawHours, rawMinutes = ""] = trimmed.split(":");
    hours = rawHours;
    minutes = rawMinutes;
  } else if (trimmed.length <= 2) {
    hours = trimmed;
    minutes = "";
  } else if (trimmed.length === 3) {
    hours = trimmed.slice(0, 1);
    minutes = trimmed.slice(1);
  } else {
    hours = trimmed.slice(0, 2);
    minutes = trimmed.slice(2, 4);
  }

  hours = hours.replace(/\D/g, "").slice(0, 2).padStart(2, "0");
  minutes = minutes.replace(/\D/g, "").slice(0, 2).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Arrow-key step by whole minutes, wrapping `23:59` -> `00:00`. Steps ONLY a
 * value that is already a complete canonical time -- a mid-edit partial
 * (`17:`, `9`) or an out-of-range value (`25:00`) is returned unchanged so
 * arrows never snap an in-progress entry somewhere unexpected.
 */
export function stepTime(value: string, deltaMinutes: number): string {
  if (!isCanonicalTime(value)) {
    return value;
  }
  const [h, m] = value.split(":").map(Number);
  const wrapped = (((h * 60 + m + deltaMinutes) % 1440) + 1440) % 1440;
  const nextHours = Math.floor(wrapped / 60);
  const nextMinutes = wrapped % 60;
  return `${String(nextHours).padStart(2, "0")}:${String(nextMinutes).padStart(2, "0")}`;
}

export function OrganizerTimeField({
  value,
  onChange,
  id,
  required,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  id?: string;
  required?: boolean;
  ariaLabel?: string;
}) {
  return (
    <input
      id={id}
      className="app-form-input"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="HH:MM"
      maxLength={5}
      pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
      title="Use 24-hour HH:MM, for example 17:00"
      aria-label={ariaLabel}
      required={required}
      value={value}
      onChange={(event) => onChange(normalizeTimeInput(event.target.value))}
      onBlur={() => {
        const finalized = finalizeTimeInput(value);
        if (finalized !== value) {
          onChange(finalized);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          const stepped = stepTime(value, event.key === "ArrowUp" ? 1 : -1);
          if (stepped !== value) {
            event.preventDefault();
            onChange(stepped);
          }
        }
      }}
    />
  );
}
