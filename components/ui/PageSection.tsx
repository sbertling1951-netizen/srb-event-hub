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
 * `variant` selects the existing container class a section already used
 * before migration (`card` or `app-card-section`, the only two in current
 * use); `style` is a passthrough for inline overrides a section relies on.
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
