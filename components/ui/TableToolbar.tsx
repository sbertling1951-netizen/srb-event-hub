import { type InputHTMLAttributes, type ReactNode, useId } from "react";

type TableToolbarProps = {
  children: ReactNode;
  className?: string;
};

/**
 * Shared list/table toolbar shell (UI Phase 4, first built for
 * Attendees). Deliberately thin -- a sticky, tokenized container and
 * nothing else. It owns no search/filter state and no field definitions;
 * every control inside is page-specific composition, exactly as
 * DataTable owns no column definitions. Reusable by any future Admin
 * list module (Vendor Requests, Reports selections, Photos/Photo
 * Library, Admin Users) that needs the same "search + primary filter
 * always visible, secondary filters progressively disclosed" shape,
 * without forcing those modules' own filter fields into a shared
 * configuration object.
 */
export function TableToolbar({ children, className }: TableToolbarProps) {
  const classes = ["table-toolbar", className].filter(Boolean).join(" ");
  return <div className={classes}>{children}</div>;
}

type TableToolbarRowProps = {
  children: ReactNode;
};

/** The always-visible row -- search plus at most one or two primary decisions. */
export function TableToolbarPrimaryRow({ children }: TableToolbarRowProps) {
  return <div className="table-toolbar-row">{children}</div>;
}

type TableToolbarDisclosureProps = {
  label: string;
  activeCount?: number;
  children: ReactNode;
};

/**
 * Progressive disclosure for secondary/low-frequency filters, via native
 * `<details>` (free keyboard/screen-reader semantics, no JS open-state to
 * own). `activeCount`, when greater than zero, renders as a badge on the
 * summary so an operator can tell filters are active without opening it
 * -- "do not hide active filter state" (Part 4).
 */
export function TableToolbarDisclosure({ label, activeCount, children }: TableToolbarDisclosureProps) {
  return (
    <details className="table-toolbar-disclosure">
      <summary className="table-toolbar-disclosure-summary">
        {label}
        {activeCount ? (
          <span className="app-status-pill app-status-pill-info" style={{ marginLeft: "var(--space-2)" }}>
            {activeCount} active
          </span>
        ) : null}
      </summary>
      <div className="table-toolbar-row">{children}</div>
    </details>
  );
}

type SearchFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">;

/**
 * Labeled search input, styled consistently wherever a list needs one.
 * Presentation only -- the caller owns the search term's state and
 * whatever matching logic it drives, exactly as Attendees' own
 * attendeeMatchesSearch already does.
 *
 * The default id is generated via `useId()` (Central UI Standard,
 * Stage 2) -- it previously fell back to the literal string
 * `"search-field"`, so two `SearchField`s on the same page without an
 * explicit `id` prop would collide, breaking both fields' label
 * association. An explicit `id` prop still overrides it.
 */
export function SearchField({ label, value, onChange, id, ...rest }: SearchFieldProps) {
  const generatedId = useId();
  const fieldId = id || generatedId;

  return (
    <div>
      <label className="table-toolbar-label" htmlFor={fieldId}>
        {label}
      </label>
      <input
        id={fieldId}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...rest}
      />
    </div>
  );
}
