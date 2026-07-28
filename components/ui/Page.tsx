import type { HTMLAttributes, ReactNode } from "react";

type PageProps = {
  children: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "className">;

/**
 * Standard outer wrapper for a top-level admin/member page.
 *
 * `.app-page` is always applied; any supplied `className` is appended, not
 * substituted, so the canonical page class can never be dropped by a
 * caller. `.app-page` itself only carries properties that are safe to
 * combine with any existing root class (see `app/globals.css`) -- it does
 * not set `display`/`gap`, since some migrated pages already own their
 * layout mode (a bordered `card`, a page-specific grid class, or an inline
 * `style` override) and a competing layout declaration on `.app-page`
 * would change their rendered output.
 */
export function Page({ children, className, ...props }: PageProps) {
  const classes = ["app-page", className].filter(Boolean).join(" ");

  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
}
