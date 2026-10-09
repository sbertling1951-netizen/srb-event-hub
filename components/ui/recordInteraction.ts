import type { HTMLAttributes, KeyboardEvent } from "react";

const nativeControl = "button, a, input, select, textarea, label, [contenteditable=true]";

/** Opt-in record navigation; the page retains selection and mutation authority. */
export function recordRowProps<T>(record: T, select: (record: T) => void, edit: (record: T) => void): HTMLAttributes<HTMLElement> {
  return {
    tabIndex: 0,
    "data-record-row": true,
    "data-record-id": record && typeof record === "object" && "id" in record ? String(record.id) : undefined,
    onClick(event) {
      if ((event.target as HTMLElement).closest(nativeControl)) {return;}
      event.currentTarget.focus({ preventScroll: true });
      select(record);
    },
    onDoubleClick(event) {
      if ((event.target as HTMLElement).closest(nativeControl)) {return;}
      select(record);
      edit(record);
    },
    onFocus(event) {
      if (event.target === event.currentTarget) {select(record);}
    },
    onKeyDown(event) {
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {return;}
      const target = event.target as HTMLElement;
      // Native text editing, pickers and button activation keep their own keys.
      if (target.closest("input, select, textarea, [contenteditable=true]")) {return;}
      const row = event.currentTarget;
      if (event.key === "Enter" && target === row) {
        event.preventDefault();
        edit(record);
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const rows = Array.from(row.parentElement?.querySelectorAll<HTMLElement>(":scope > [data-record-row]") ?? []);
        const next = rows[rows.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)];
        if (next) {
          event.preventDefault();
          next.focus({ preventScroll: true });
          next.scrollIntoView({ block: "nearest" });
        }
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const controls = [row, ...Array.from(row.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]"))];
        const next = controls[controls.indexOf(target) + (event.key === "ArrowRight" ? 1 : -1)];
        if (next) { event.preventDefault(); next.focus({ preventScroll: true }); }
      }
    },
  } as HTMLAttributes<HTMLElement>;
}

/** Save shortcuts are scoped to an editor form, never to the page. */
export function recordEditorKeyDown(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key !== "Enter" || event.defaultPrevented || event.nativeEvent.isComposing || event.shiftKey || event.altKey) {return;}
  const target = event.target as HTMLElement;
  if (target.closest("button, a, select, input[type=file], input[type=color], input[type=date], input[type=datetime-local], [contenteditable=true]")) {return;}
  if (target.closest("textarea") && !(event.metaKey || event.ctrlKey)) {return;}
  event.preventDefault();
  event.currentTarget.requestSubmit();
}
