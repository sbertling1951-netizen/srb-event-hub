import type { CSSProperties, ReactNode } from "react";

type HeadingLevel = "h1" | "h2" | "h3";

type PageHeaderProps = {
  title: ReactNode;
  titleId?: string;
  titleClassName?: string;
  titleStyle?: CSSProperties;
  headingLevel?: HeadingLevel;
  description?: ReactNode;
  descriptionClassName?: string;
  descriptionStyle?: CSSProperties;
  actions?: ReactNode;
};

/**
 * Standard page/section title row: heading, optional description, optional
 * adjacent actions (buttons, status pills, etc.).
 *
 * Always renders a single root `<div>`, so the DOM shape is predictable
 * regardless of which optional props are supplied -- there is no
 * Fragment-vs-wrapper branch to reason about at call sites.
 *
 * When `actions` is passed at all (even as `null`, e.g. a
 * conditionally-rendered badge), the heading/description are grouped in
 * their own inner `<div>` and kept beside the actions using
 * `.app-page-header` (wrapping and stacking at narrow widths), so the row layout stays stable regardless of whether
 * the action content is currently present. When `actions` is omitted, the
 * heading/description render directly inside the root `<div>` with no
 * layout class, matching plain heading+paragraph markup.
 *
 * Heading level, and the className/style of the title and description, are
 * overridable because heading level and text styling vary across the pages
 * this replaces and must be reproduced exactly, not normalized. These are
 * the only overrides in use by the current migrated pages.
 *
 * `titleId` (UI Phase 1) is optional and only needed when a caller wants
 * to point a landmark's `aria-labelledby` at this exact heading rather
 * than relying on document-order heading navigation alone.
 */
export function PageHeader({
  title,
  titleId,
  titleClassName,
  titleStyle,
  headingLevel = "h2",
  description,
  descriptionClassName,
  descriptionStyle,
  actions,
}: PageHeaderProps) {
  const Heading = headingLevel;

  const heading = (
    <Heading id={titleId} className={titleClassName} style={titleStyle}>
      {title}
    </Heading>
  );

  const descriptionEl =
    description !== undefined ? (
      <p className={descriptionClassName} style={descriptionStyle}>
        {description}
      </p>
    ) : null;

  if (actions !== undefined) {
    return (
      <div className="app-page-header">
        <div className="app-page-header-copy">
          {heading}
          {descriptionEl}
        </div>
        <div className="app-page-header-actions">{actions}</div>
      </div>
    );
  }

  return (
    <div>
      {heading}
      {descriptionEl}
    </div>
  );
}
