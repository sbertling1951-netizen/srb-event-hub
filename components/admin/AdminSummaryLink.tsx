import type { Route } from "next";
import Link from "next/link";

// Presentation-only Summary Link
// (docs/architecture/EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md §5; the term
// itself is explicitly provisional there). Represents one Level-1 Admin
// module on the Dashboard: the minimum information needed to decide
// whether entering it is useful now, plus a direct, governed link into
// it -- never a recomputed statistic. No governed per-module summary
// signal exists yet (no Admin Collector/Resolver), so this renders only
// the module's name and a static, non-numeric purpose description, per
// this task's own instruction to prefer that over inventing a metric.
//
// A real `<Link>`, not a button-plus-router.push -- this is the same
// native-navigation choice components/layout/Sidebar.tsx already makes
// for its own nav items, and gives strictly better accessibility than a
// synthetic click handler: native keyboard activation, middle-click/
// open-in-new-tab, and correct link (not button) semantics for assistive
// technology. The whole card is the one interactive surface -- no nested
// interactive control inside it.
//
// Styling (UI Phase 1) moved from an inline style object to the shared
// `.admin-summary-link` class (app/globals.css) -- token-driven colors/
// radius/shadow, plus a real hover and `:focus-visible` state that inline
// styles could not express.
export type AdminSummaryLinkProps = {
  title: string;
  description: string;
  href: string;
};

export default function AdminSummaryLink({
  title,
  description,
  href,
}: AdminSummaryLinkProps) {
  return (
    <Link href={href as Route} className="admin-summary-link">
      <div className="admin-summary-link-title">{title}</div>
      <div className="admin-summary-link-description">{description}</div>
    </Link>
  );
}
