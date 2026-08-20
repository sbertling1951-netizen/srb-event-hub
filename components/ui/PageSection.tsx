import type { CSSProperties, ReactNode } from "react";

import { PageHeader } from "@/components/ui/PageHeader";

type PageSectionVariant = "card" | "section";

const VARIANT_CLASS: Record<PageSectionVariant, string> = {
  card: "card",
  section: "app-card-section",
};

type PageSectionProps = {
  children: ReactNode;
  title?: ReactNode;
  titleStyle?: CSSProperties;
  variant?: PageSectionVariant;
  style?: CSSProperties;
};

/**
 * Standard content-section wrapper for the repeated card/header/body
 * pattern used in the migrated admin pages.
 *
 * `variant` picks between the two container classes -- a real semantic
 * choice, not an arbitrary one (Central UI Standard, Stage 2): `"card"`
 * (`.card`, 16px padding) is a standalone bordered container -- a page's
 * own top-level grouping, or one used outside any other section. `"section"`
 * (`.app-card-section`, 14px padding) is one of several stacked in-page
 * sections under a single page/heading -- deliberately a touch denser so
 * a run of them reads as siblings, not as separate standalone cards. Both
 * are heavily used today (35 and 10+ call sites respectively) with real,
 * different composition patterns behind them, so this is a documented
 * distinction, not a merge -- picking one to deprecate would be a real
 * page-visual change, out of scope for this stage.
 *
 * `style` is a passthrough for inline overrides a section relies on.
 *
 * The optional title is rendered through `PageHeader` (heading level fixed
 * at `h2`, matching every current section title) so section headers stay
 * visually and behaviorally identical to page headers. This intentionally
 * does not expose `description`/`actions`/heading-level overrides, since no
 * migrated section currently uses them -- add them when a real consumer
 * needs them, not speculatively.
 */
export function PageSection({
  children,
  title,
  titleStyle,
  variant = "section",
  style,
}: PageSectionProps) {
  const className = VARIANT_CLASS[variant];

  return (
    <div className={className} style={style}>
      {title !== undefined ? (
        <PageHeader title={title} headingLevel="h2" titleStyle={titleStyle} />
      ) : null}

      {children}
    </div>
  );
}
