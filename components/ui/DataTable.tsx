import type { ReactNode } from "react";

type DataTableProps = {
  /**
   * Accessible name for the table, rendered as a visually-hidden
   * `<caption>` (screen readers announce it when entering the table;
   * sighted users already have the preceding page/section heading).
   */
  caption: string;
  children: ReactNode;
  className?: string;
};

/**
 * Desktop data-table shell (UI Phase 2). Deliberately thin: it owns the
 * horizontal-scroll container, the base `.data-table` class (header/row/
 * hover/border treatment lives in app/globals.css), and an accessible
 * caption -- nothing else. Callers write ordinary semantic
 * `<thead>/<tbody>/<tr>/<th>/<td>` markup as children, exactly as they
 * would without this wrapper; there is no column/row configuration
 * object to learn, and no behavior this component could get wrong for a
 * future module's different column set.
 */
export function DataTable({ caption, children, className }: DataTableProps) {
  const classes = ["data-table", className].filter(Boolean).join(" ");

  return (
    <div className="data-table-scroll">
      <table className={classes}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

type ResponsiveListProps = {
  children: ReactNode;
  className?: string;
};

/**
 * Narrow-viewport row-list shell (UI Phase 2) -- the same rows a
 * `DataTable` would show, presented as a list of cards instead of a
 * table, for widths where per-row touch actions need real room rather
 * than table-cell density. `role="list"` is explicit because some
 * screen readers drop the implicit list semantics from a `<ul>` once
 * `list-style: none` is applied (app/globals.css). Callers render their
 * own `<li className="responsive-list-item">` rows as children.
 */
export function ResponsiveList({ children, className }: ResponsiveListProps) {
  const classes = ["responsive-list", className].filter(Boolean).join(" ");

  return (
    <ul className={classes} role="list">
      {children}
    </ul>
  );
}
