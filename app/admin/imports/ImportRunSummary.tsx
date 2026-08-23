import type { ReactNode } from "react";

export type ImportRunSummaryItem = {
  label: string;
  value: number;
  description?: ReactNode;
};

type ImportRunSummaryProps = {
  label: string;
  items: ImportRunSummaryItem[];
};

/**
 * Small import-type-agnostic summary for persisted run counts. It owns only
 * semantic list/layout presentation; each import door supplies its own
 * operator vocabulary and server-derived values.
 */
export function ImportRunSummary({ label, items }: ImportRunSummaryProps) {
  return (
    <dl
      aria-label={label}
      style={{
        display: "grid",
        gap: "var(--space-3)",
        gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
        margin: 0,
      }}
    >
      {items.map((item) => (
        <div key={item.label} className="app-card-section-muted">
          <dt className="app-subtle-text" style={{ fontSize: "var(--font-size-caption)" }}>
            {item.label}
          </dt>
          <dd style={{ margin: "var(--space-1) 0 0" }}>
            <span
              style={{
                display: "block",
                fontSize: "var(--font-size-page-title)",
                fontWeight: "var(--font-weight-bold)",
              }}
            >
              {item.value}
            </span>
            {item.description ? (
              <span
                className="app-subtle-text"
                style={{ display: "block", marginTop: "var(--space-1)" }}
              >
                {item.description}
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
