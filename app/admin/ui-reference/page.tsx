"use client";

import type { CSSProperties, ReactNode } from "react";
import { useId, useMemo, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import {
  computeNearestNeighborSpacingPx,
  MARKER_MIN_HIT_AREA_PX,
  MarkerDot,
  MarkerLabelChip,
  resolveDensityAwareMarkerSize,
} from "@/components/map/canvas";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useShellInterfaceCapabilities } from "@/components/shell/useShellViewport";
import { Alert } from "@/components/ui/Alert";
import { AppButton, AppLinkButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { DataTable, ResponsiveList } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Checkbox, Field, Input, Radio, Select, Textarea } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { RowActions } from "@/components/ui/RowActions";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/StatusBadge";
import { SearchField, TableToolbar, TableToolbarDisclosure, TableToolbarPrimaryRow } from "@/components/ui/TableToolbar";

// =============================================================================
// EpicentraX Admin UI/UX Reference
//
// A design workbench, not a product page. Every component on this page is
// the ACTUAL shared primitive (components/ui/*) rendered with clearly-fake
// local data -- no Supabase, no Event context, no mutation of anything real.
// State declared with useState below is scoped to this page's render only
// and is discarded on reload; it never touches localStorage or a database.
//
// Most of this page should NOT be read as "this is correct, ship it" --
// where the shared system is inconsistent, awkward, or ambiguous, it shows
// that plainly rather than quietly picking a winner (see the "For review"
// callouts, and the closeout report for the full list). Two areas are the
// exception, marked "✅ Approved" in their own section: the Mid-Size UI
// Scale (Section 14) and the button/action hierarchy, System 3 (Section
// 15, Part A) -- both are now the real canonical Admin visual system, not
// prototypes, approved 2026-08-19. Table row-action LAYOUT (Section 15,
// Part B) is still undecided.
// =============================================================================

const TOC: Array<{ id: string; label: string }> = [
  { id: "layout", label: "1. Page Layout" },
  { id: "typography", label: "2. Typography" },
  { id: "buttons", label: "3. Buttons & Action Hierarchy" },
  { id: "forms", label: "4. Form Controls" },
  { id: "toolbar", label: "5. Search / Filter / Toolbar" },
  { id: "tables", label: "6. Tables & Lists" },
  { id: "status", label: "7. Status & Semantic Treatments" },
  { id: "alerts", label: "8. Alerts & Feedback" },
  { id: "containers", label: "9. Cards / Containers / Sections" },
  { id: "actions", label: "10. Action Rows" },
  { id: "states", label: "11. Empty / Loading / Error States (✅ approved)" },
  { id: "responsive", label: "12. Responsive Review" },
  { id: "device", label: "13. Device & Layout Preferences" },
  { id: "scale", label: "14. Mid-Size UI Scale (✅ approved)" },
  { id: "action-hierarchy", label: "15. Button Hierarchy (✅ approved) & Row Actions (undecided)" },
  { id: "depth", label: "16. Button Tactile Treatment (✅ approved)" },
  { id: "overlays", label: "17. Dialog & Overlays (✅ approved)" },
  { id: "map-markers", label: "18. Map Marker Standard (✅ approved)" },
  { id: "inline-edit", label: "19. Inline Edit (✅ approved -- production-proven)" },
  { id: "form-actions", label: "20. Form Actions (✅ approved)" },
];

// ----------------------------------------------------------------------------
// Small reference-page-only composition helpers (not shared primitives --
// these exist only to lay the real primitives out consistently on this one
// page; nothing here is exported or reused elsewhere).
// ----------------------------------------------------------------------------

function RefSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="ui-ref-section" style={{ display: "grid", gap: "var(--space-5)" }}>
      <PageHeader
        title={title}
        headingLevel="h2"
        titleClassName="app-section-title"
        description={description}
        descriptionClassName="app-subtle-text"
      />
      {children}
    </section>
  );
}

/** A flagged observation for Pap/Mel review -- real Alert usage, tone="warning" reserved for this. */
function Observation({ children }: { children: ReactNode }) {
  return (
    <Alert tone="warning">
      <strong>For review:</strong> {children}
    </Alert>
  );
}

function ColorSwatch({ label, varName }: { label: string; varName: string }) {
  return (
    <div className="ui-ref-swatch">
      <div className="ui-ref-swatch-chip" style={{ background: `var(${varName})` }} />
      <div className="ui-ref-swatch-label">
        <div style={{ fontWeight: "var(--font-weight-semibold)" as unknown as number, fontSize: "var(--font-size-small)" }}>
          {label}
        </div>
        <code className="ui-ref-code">{varName}</code>
      </div>
    </div>
  );
}

function TypeRow({ spec, children }: { spec: string; children: ReactNode }) {
  return (
    <div className="ui-ref-type-row">
      <code className="ui-ref-code">{spec}</code>
      <div>{children}</div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Fake, local sample data. Shaped loosely like a roster so Tables/Lists has
// something realistic to render, but deliberately generic ("Sample Request")
// rather than a real domain, per instruction: no live Event/vendor/attendee
// data. Includes a long name/email/note (wrap-behavior) and two rows with
// missing values (empty-state-per-field behavior).
// ----------------------------------------------------------------------------

type SampleCategory = "vendor" | "staff" | "speaker" | "volunteer" | "guest";
type SampleStatus = "new" | "pending" | "confirmed" | "complete" | "cancelled";

type SampleRecord = {
  id: string;
  name: string;
  category: SampleCategory;
  status: SampleStatus;
  detail: string;
  email: string;
  phone: string;
  site: string;
};

const SAMPLE_RECORDS: SampleRecord[] = [
  {
    id: "s1",
    name: "Jordan Vega",
    category: "vendor",
    status: "new",
    detail: "Requested extra table space near Gate B.",
    email: "jordan.vega@example.test",
    phone: "(555) 010-2231",
    site: "A-12",
  },
  {
    id: "s2",
    name: "Casey Whitfield-Alvarenga-Thornbury",
    category: "staff",
    status: "pending",
    detail:
      "Long note to check wrapping behavior: needs a second badge printer staged before doors open, plus a spare extension cord and a folding table for the overflow line.",
    email: "casey.whitfield.alvarenga.thornbury@example-organization-mail.test",
    phone: "",
    site: "",
  },
  {
    id: "s3",
    name: "Priya Natarajan",
    category: "speaker",
    status: "confirmed",
    detail: "Needs A/V confirmation by Friday.",
    email: "priya.n@example.test",
    phone: "(555) 044-9981",
    site: "B-04",
  },
  {
    id: "s4",
    name: "Miguel Torres",
    category: "volunteer",
    status: "complete",
    detail: "",
    email: "miguel.t@example.test",
    phone: "(555) 077-1120",
    site: "C-19",
  },
  {
    id: "s5",
    name: "Dana Okafor",
    category: "guest",
    status: "cancelled",
    detail: "Duplicate request, cancelled by requester.",
    email: "",
    phone: "(555) 099-4432",
    site: "",
  },
  {
    id: "s6",
    name: "Sam Delgado",
    category: "staff",
    status: "new",
    detail: "Second-shift coverage request.",
    email: "sam.delgado@example.test",
    phone: "(555) 021-7765",
    site: "A-12",
  },
];

const CATEGORY_LABEL: Record<SampleCategory, string> = {
  vendor: "Vendor",
  staff: "Staff",
  speaker: "Speaker",
  volunteer: "Volunteer",
  guest: "Guest",
};

/**
 * Verbatim reference copy of app/admin/attendees/page.tsx's (not exported)
 * participantTypeBadgeStyle/badgeVariant -- shown here purely to put the
 * existing categorical-role treatment next to StatusBadge for comparison.
 * Not imported, not re-exported, not consumed by any other page.
 */
function sampleCategoryBadgeStyle(category: SampleCategory): CSSProperties {
  const [background, color] = ((): [string, string] => {
    switch (category) {
      case "vendor":
        return ["#ede9fe", "#5b21b6"];
      case "staff":
        return ["#dcfce7", "#166534"];
      case "speaker":
        return ["#dbeafe", "#1d4ed8"];
      case "volunteer":
        return ["#fef3c7", "#92400e"];
      case "guest":
        return ["#fee2e2", "#991b1b"];
      default:
        return ["#e5e7eb", "#374151"];
    }
  })();

  return {
    display: "inline-block",
    padding: "3px 8px",
    borderRadius: 999,
    background,
    color,
    fontSize: 12,
    fontWeight: 700,
  };
}

const STATUS_TONE: Record<SampleStatus, StatusBadgeTone> = {
  new: "neutral",
  pending: "warning",
  confirmed: "info",
  complete: "success",
  cancelled: "danger",
};

const STATUS_LABEL: Record<SampleStatus, string> = {
  new: "New",
  pending: "Pending",
  confirmed: "Confirmed",
  complete: "Complete",
  cancelled: "Cancelled",
};

const CATEGORY_OPTIONS: SampleCategory[] = ["vendor", "staff", "speaker", "volunteer", "guest"];
const STATUS_OPTIONS: SampleStatus[] = ["new", "pending", "confirmed", "complete", "cancelled"];

// ----------------------------------------------------------------------------
// Synthetic marker-density demo data (Section 18). Deliberately NOT real
// event/site data -- these coordinates only need to reproduce three
// genuinely different real-world density regimes so the real, unmodified
// resolveDensityAwareMarkerSize actually resolves three different sizes,
// not values chosen to look right. All three share the same 200x140
// "natural" coordinate space so their resolved sizes are directly
// comparable and none can overflow a narrow viewport.
//
// Dense clusters into a narrow right-hand strip (visually the same shape
// as Saint George's real site columns) rather than spreading evenly --
// real Saint George's own 234 sites are not evenly spread across its
// 606x806 image either; they are similarly clustered, which is exactly
// why nearest-neighbor spacing (not average density over the whole
// image) is the correct measurement.
// ----------------------------------------------------------------------------

type MarkerDensityDemo = {
  key: string;
  label: string;
  description: string;
  points: { xPct: number; yPct: number }[];
};

function gridPercentPoints(
  cols: number,
  rows: number,
  xRange: [number, number],
  yRange: [number, number],
): { xPct: number; yPct: number }[] {
  const points: { xPct: number; yPct: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push({
        xPct: xRange[0] + (cols === 1 ? 0 : (c / (cols - 1)) * (xRange[1] - xRange[0])),
        yPct: yRange[0] + (rows === 1 ? 0 : (r / (rows - 1)) * (yRange[1] - yRange[0])),
      });
    }
  }
  return points;
}

const MARKER_DEMO_NATURAL = { width: 200, height: 140 };

const MARKER_DENSITY_DEMOS: MarkerDensityDemo[] = [
  {
    key: "dense",
    label: "Dense",
    description: "Clustered like Saint George's real 234-site map (~11 real native px median spacing) -- resolves to the legibility floor.",
    points: gridPercentPoints(7, 6, [65, 95], [5, 95]),
  },
  {
    key: "medium",
    label: "Medium",
    description: "A moderate, evenly spread grid -- more room than a dense site map, less than a sparse amenity layer.",
    points: gridPercentPoints(8, 6, [8, 92], [8, 92]),
  },
  {
    key: "sparse",
    label: "Sparse",
    description: "A handful of scattered points, typical of Locations' amenity markers (restrooms, dumpsters, registration) -- resolves to the readability ceiling.",
    points: [
      { xPct: 10, yPct: 15 },
      { xPct: 90, yPct: 20 },
      { xPct: 50, yPct: 85 },
      { xPct: 15, yPct: 80 },
    ],
  },
];

export default function AdminUiReferencePage() {
  return (
    <AdminRouteGuard requiredPermission="can_view_admin_dashboard">
      <AdminShellAdapter
        pageTitle="Admin UI Reference"
        pageSubtitle="Design workbench for the EpicentraX Admin visual system -- not a live operational page."
        backTarget={{ href: "/admin/dashboard", label: "Dashboard" }}
      >
        <AdminUiReferenceContent />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

/**
 * Exported separately from the guarded default page so it can be rendered
 * directly (no AdminRouteGuard/AdminShellAdapter context needed) by a
 * focused renderToStaticMarkup test, the same way components/ui/TableToolbar
 * is tested. It depends only on useShellInterfaceCapabilities, which itself
 * needs no Provider.
 */
export function AdminUiReferenceContent() {
  const capabilities = useShellInterfaceCapabilities();
  const { isCompact, viewportClass, supportsPersistentNavigation, prefersReducedMotion } = capabilities;

  // Search/filter demo state (Section 5/6) -- intentionally separate from
  // the "display preference" demo state below, so Clear Search & Filters
  // can visibly leave the preference untouched (Section 13).
  const [demoSearch, setDemoSearch] = useState("");
  const [demoCategory, setDemoCategory] = useState<SampleCategory | "all">("all");
  const [demoStatus, setDemoStatus] = useState<SampleStatus | "all">("all");
  const [demoShowNotes, setDemoShowNotes] = useState(true);

  // Section 11 demo only: whether the EmptyState action example has been
  // clicked, so the "Clear filters" button visibly does something real
  // with plain synchronous state, no timer or extra hook. Not persisted.
  const [demoStatesFiltersCleared, setDemoStatesFiltersCleared] = useState(false);

  // Section 13 demo only: a LOCAL, fake "preferred view" control. No such
  // control exists anywhere in the real app today -- see the section body.
  const [demoPreferredView, setDemoPreferredView] = useState<"automatic" | "table" | "list">("automatic");

  const [confirmOpen, setConfirmOpen] = useState(false);

  // Section 17 demo only: the general-purpose Dialog trigger, separate
  // from ConfirmDialog's own confirmOpen state above.
  const [overlayDialogOpen, setOverlayDialogOpen] = useState(false);

  // Section 14 demo only: which scale the toggleable sample roster below
  // renders at. Local state only -- never persisted, never affects any
  // other page.
  const [scaleToggle, setScaleToggle] = useState<"legacy" | "canonical">("canonical");

  // Section 15 demo only: the "outline until confirmed, solid once
  // confirmed" destructive treatment (Button System 3) reuses the real
  // ConfirmDialog, via its own open state separate from Section 3's.
  const [system3ConfirmOpen, setSystem3ConfirmOpen] = useState(false);

  // Section 16 demo only: a second, independent ConfirmDialog trigger (the
  // real, unmodified component), not persisted anywhere.
  const [depthConfirmOpen, setDepthConfirmOpen] = useState(false);

  // Section 19 demos only: one local value per InlineEdit example.
  // InlineEdit never persists anything itself -- ordinary useState here is
  // standing in for whatever a real caller's own save would be (a database
  // write, an API call), exactly as this whole page's demo state does for
  // every other primitive above.
  const [demoGroceryCategory, setDemoGroceryCategory] = useState("Groceries");
  const [demoDepartmentLabel, setDemoDepartmentLabel] = useState("Vendor Services");
  const [demoMealCategory, setDemoMealCategory] = useState("Breakfast");
  // No setter: this example's onSave always rejects (see
  // saveStorageLabelAlwaysFails below), so the committed value never
  // actually changes -- demonstrating that on purpose, not an oversight.
  const [demoStorageLabel] = useState("Storage Room");

  async function saveDepartmentLabelAsync(next: string) {
    // A real ~700ms delay so the Save button's loading state is actually
    // visible to a reviewer, not just theoretically present in the code.
    await new Promise((resolve) => setTimeout(resolve, 700));
    setDemoDepartmentLabel(next);
  }

  async function saveStorageLabelAlwaysFails(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 500));
    throw new Error("Network error -- please try again.");
  }

  const demoActiveFilterCount = (demoCategory !== "all" ? 1 : 0) + (demoStatus !== "all" ? 1 : 0);
  const demoHasClearable = demoActiveFilterCount > 0 || demoSearch.trim() !== "";

  function clearDemoFilters() {
    setDemoSearch("");
    setDemoCategory("all");
    setDemoStatus("all");
    // demoShowNotes (a display preference) and demoPreferredView (a layout
    // preference) are deliberately NOT reset here -- the same
    // filter/preference distinction UI Phase 4 established for Attendees.
  }

  const filteredRecords = useMemo(() => {
    const q = demoSearch.trim().toLowerCase();
    return SAMPLE_RECORDS.filter((r) => {
      if (demoCategory !== "all" && r.category !== demoCategory) {
        return false;
      }
      if (demoStatus !== "all" && r.status !== demoStatus) {
        return false;
      }
      if (!q) {
        return true;
      }
      return [r.name, r.email, r.phone, r.site, r.detail].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [demoSearch, demoCategory, demoStatus]);

  // Effective view for the LIVE example: an explicit non-"automatic" demo
  // preference wins when the current capability can safely support it;
  // "automatic" (or a demo preference of "table" while the real shell is
  // compact) always falls back to isCompact. This is a worked example of
  // the hierarchy proposed in Section 13, not the real app's behavior.
  const liveShowsList = demoPreferredView === "list" ? true : demoPreferredView === "table" ? isCompact : isCompact;

  return (
    <div style={{ display: "grid", gap: "var(--space-12)", minWidth: 0 }}>
      <PageSection variant="section">
        <p style={{ margin: 0, fontSize: "var(--font-size-body)", lineHeight: "var(--line-height-relaxed)" }}>
          This page puts the EpicentraX shared Admin UI system (built across UI Phases 1-5) in one place so it can be
          visually reviewed, compared, and deliberately approved before further page migrations continue. Every
          control below is the real component from <code className="ui-ref-code">components/ui/</code>, rendered
          with fake local data. Nothing on this page reads from or writes to Supabase, and no interaction here
          affects any real Event, vendor, or attendee record.
        </p>
        <nav aria-label="Reference sections" className="ui-ref-toc" style={{ marginTop: "var(--space-5)" }}>
          {TOC.map((item) => (
            <a key={item.id} href={`#${item.id}`}>
              {item.label}
            </a>
          ))}
        </nav>
      </PageSection>

      {/* =================================================================
          1. PAGE LAYOUT
          ================================================================= */}
      <RefSection
        id="layout"
        title="Page Layout"
        description="PageHeader + PageSection composition, title/subtitle hierarchy, and the difference between grouped and separated work areas."
      >
        <PageSection variant="section">
          <PageHeader
            title="Single-column content"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
            description="A narrow reading measure for prose-heavy content -- policy text, a single form, an explanation. This paragraph is realistic-length so line length and rhythm can be judged: short enough to read comfortably in one pass, long enough to show what three or four sentences of body copy actually look like stacked under a subsection heading."
            descriptionClassName="app-subtle-text"
          />
        </PageSection>

        <PageSection variant="section">
          <PageHeader
            title="Wider, data-oriented content"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
            description="The same PageSection, holding a DataTable instead of prose. Compare this section's width and padding against the single-column example above -- both use identical PageSection spacing, only the content differs."
            descriptionClassName="app-subtle-text"
          />
          <DataTable caption="Layout example: a compact 3-column table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Category</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_RECORDS.slice(0, 3).map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{CATEGORY_LABEL[r.category]}</td>
                  <td>
                    <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </PageSection>

        <div>
          <PageHeader
            title="Core design tokens in use on this page"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
            description="A sample of the token set from app/globals.css :root -- every color/spacing value used throughout this page comes from one of these, not a local literal."
            descriptionClassName="app-subtle-text"
          />
          <div className="ui-ref-swatch-grid">
            <ColorSwatch label="Page background" varName="--color-bg-page" />
            <ColorSwatch label="Panel background" varName="--color-bg-panel" />
            <ColorSwatch label="Muted background" varName="--color-bg-muted" />
            <ColorSwatch label="Border, default" varName="--color-border-default" />
            <ColorSwatch label="Action, primary" varName="--color-action-primary" />
            <ColorSwatch label="Selected" varName="--color-selected" />
            <ColorSwatch label="Status success" varName="--color-status-success" />
            <ColorSwatch label="Status warning" varName="--color-status-warning" />
            <ColorSwatch label="Status error" varName="--color-status-error" />
            <ColorSwatch label="Status info" varName="--color-status-info" />
          </div>
        </div>

        <div style={{ display: "grid", gap: "var(--space-5)" }}>
          <PageHeader
            title="Grouped vs. separated work areas"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
          />
          <div className="ui-ref-compare-grid">
            <div className="ui-ref-compare-card">
              <strong>Grouped</strong>
              <p className="app-subtle-text" style={{ margin: 0 }}>
                Two related fields inside one PageSection -- reads as one decision.
              </p>
              <div className="app-form-grid-2">
                <div>
                  <label className="table-toolbar-label" htmlFor="ref-grouped-a">
                    Field A
                  </label>
                  <input id="ref-grouped-a" placeholder="Value" />
                </div>
                <div>
                  <label className="table-toolbar-label" htmlFor="ref-grouped-b">
                    Field B
                  </label>
                  <input id="ref-grouped-b" placeholder="Value" />
                </div>
              </div>
            </div>
            <div className="ui-ref-compare-card">
              <strong>Separated</strong>
              <p className="app-subtle-text" style={{ margin: 0 }}>
                Two unrelated PageSections stacked with page-level gap -- reads as two distinct areas.
              </p>
              <PageSection variant="section" style={{ padding: "var(--space-4)" }}>
                Area 1
              </PageSection>
              <PageSection variant="section" style={{ padding: "var(--space-4)" }}>
                Area 2
              </PageSection>
            </div>
          </div>
        </div>

        <Observation>
          Vertical rhythm today comes from whatever gap value each page happens to choose at its own top-level
          grid (this page uses <code className="ui-ref-code">--space-12</code> between major sections and{" "}
          <code className="ui-ref-code">--space-5</code> within one) -- there is no single canonical "page gap"
          token or convention documented anywhere, so density varies slightly page to page depending on which
          value the author picked. Worth deciding on one default.
        </Observation>
      </RefSection>

      {/* =================================================================
          2. TYPOGRAPHY
          ================================================================= */}
      <RefSection
        id="typography"
        title="Typography"
        description="The actual type hierarchy in use, spec captions on the left, rendered sample on the right."
      >
        <PageSection variant="section" style={{ padding: 0 }}>
          <div style={{ padding: "0 var(--space-6)" }}>
            <TypeRow spec=".shell-page-title (live)">
              <span className="shell-page-title" style={{ display: "block" }}>
                Admin UI Reference
              </span>
            </TypeRow>
            <TypeRow spec="--font-size-page-title / --font-weight-bold">
              <span
                style={{
                  display: "block",
                  fontSize: "var(--font-size-page-title)",
                  fontWeight: "var(--font-weight-bold)" as unknown as number,
                }}
              >
                Admin UI Reference
              </span>
            </TypeRow>
            <TypeRow spec=".app-section-title">
              <span className="app-section-title" style={{ display: "block", margin: 0 }}>
                Vendor Dispatch Lists
              </span>
            </TypeRow>
            <TypeRow spec='"Subsection" style (Vendors’ review-panel heading)'>
              <span
                style={{
                  display: "block",
                  fontSize: "var(--font-size-small)",
                  fontWeight: "var(--font-weight-semibold)" as unknown as number,
                  color: "var(--color-text-secondary)",
                }}
              >
                Event Presentation Metadata
              </span>
            </TypeRow>
            <TypeRow spec="Body copy (--font-size-body / --line-height-normal)">
              <p style={{ margin: 0, fontSize: "var(--font-size-body)", lineHeight: "var(--line-height-normal)" }}>
                A vendor service request links a member&rsquo;s ask to a specific vendor and site. Marking a request
                Contacted does not change its placement -- Placement is read-only here and always comes from Parking.
              </p>
            </TypeRow>
            <TypeRow spec=".app-subtle-text (secondary/help text)">
              <span className="app-subtle-text">Showing 6 of 6 sample records.</span>
            </TypeRow>
            <TypeRow spec="Field label (fontWeight 600, --font-size-body)">
              <span style={{ fontWeight: 600, fontSize: "var(--font-size-body)", color: "var(--color-text-secondary)" }}>
                Business name
              </span>
            </TypeRow>
            <TypeRow spec="Table heading (.data-table thead th)">
              <DataTable caption="Table-heading type sample">
                <thead>
                  <tr>
                    <th scope="col">Sample Heading</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>&nbsp;</td>
                  </tr>
                </tbody>
              </DataTable>
            </TypeRow>
            <TypeRow spec="Small metadata (.data-table-cell-meta)">
              <span className="data-table-cell-meta">Vendor · (555) 010-2231 · Prefers email</span>
            </TypeRow>
            <TypeRow spec="Emphasized value (.data-table-cell-primary)">
              <span className="data-table-cell-primary">Jordan Vega</span>
            </TypeRow>
          </div>
        </PageSection>

        <p className="app-subtle-text" style={{ margin: 0 }}>
          <strong>Resolved (Central UI Standard, Stage 2):</strong> the two rows above now render at the exact
          same font size -- <code className="ui-ref-code">.shell-page-title</code> consumes{" "}
          <code className="ui-ref-code">var(--font-size-page-title)</code> directly, and the token itself was
          promoted from a static 23px to the shell's own <code className="ui-ref-code">clamp(19px, 2.3vw, 25px)</code>{" "}
          expression rather than the other way around, so the live shell&rsquo;s rendered size is unchanged. The
          font-<em>weight</em> gap is unchanged and intentionally left open: <code className="ui-ref-code">.shell-page-title</code>{" "}
          still uses <code className="ui-ref-code">--font-weight-semibold</code> (700), a deliberate choice from the
          Mid-Size UI Scale approval, not the <code className="ui-ref-code">--font-weight-bold</code> (800) shown in
          the token row above -- changing that is a real visual decision this stage did not make.
        </p>
        <p className="app-subtle-text" style={{ margin: 0 }}>
          <strong>Resolved (Central UI Standard):</strong> the &ldquo;subsection&rdquo; style (13px/700) is retired,
          not promoted to a third heading tier -- repository-wide search found no real page using it outside this
          one historical mention; the two tiers that already exist (Section Title via{" "}
          <code className="ui-ref-code">PageHeader</code>/<code className="ui-ref-code">PageSection</code>, and
          Label via <code className="ui-ref-code">Field</code>) are sufficient. A page that previously hand-copied
          the 13px/700 style should use one of those two instead, not a third value.
        </p>
      </RefSection>

      {/* =================================================================
          3. BUTTONS AND ACTION HIERARCHY
          ================================================================= */}
      <RefSection
        id="buttons"
        title="Buttons and Action Hierarchy"
        description="The canonical Primary/Secondary/Tertiary/Destructive/Disabled-loading hierarchy (Central UI Standard, Stage 2), plus realistic action groupings. Every example below is the real AppButton component."
      >
        <div className="ui-ref-swatch-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            <AppButton variant="primary">Primary</AppButton>
            <code className="ui-ref-code">variant=&quot;primary&quot;</code>
          </div>
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            <AppButton variant="secondary">Secondary</AppButton>
            <code className="ui-ref-code">variant=&quot;secondary&quot;</code>
          </div>
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            <AppButton variant="tertiary">Tertiary</AppButton>
            <code className="ui-ref-code">variant=&quot;tertiary&quot; (= unset)</code>
          </div>
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            <AppButton variant="danger">Destructive</AppButton>
            <code className="ui-ref-code">variant=&quot;danger&quot;</code>
          </div>
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            <AppButton variant="stop">Destructive (confirm)</AppButton>
            <code className="ui-ref-code">variant=&quot;stop&quot;</code>
          </div>
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            <AppButton disabled>Disabled</AppButton>
            <code className="ui-ref-code">disabled</code>
          </div>
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            <AppButton loading>Loading</AppButton>
            <code className="ui-ref-code">loading</code>
          </div>
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            <AppLinkButton href="#tables">Link / navigation</AppLinkButton>
            <code className="ui-ref-code">AppLinkButton</code>
          </div>
        </div>

        <p className="app-subtle-text" style={{ margin: 0 }}>
          Transitional aliases, still rendered but not part of the canonical hierarchy above -- kept only for
          existing call sites (see each swatch&rsquo;s own code caption):
        </p>
        <div className="ui-ref-swatch-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            <AppButton variant="muted">Muted</AppButton>
            <code className="ui-ref-code">variant=&quot;muted&quot; (= secondary)</code>
          </div>
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            <AppButton variant="success">Success</AppButton>
            <code className="ui-ref-code">variant=&quot;success&quot; (prefer primary)</code>
          </div>
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            <AppButton variant="start">Start</AppButton>
            <code className="ui-ref-code">variant=&quot;start&quot; (prefer primary)</code>
          </div>
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            <AppButton variant="warning">Warning</AppButton>
            <code className="ui-ref-code">variant=&quot;warning&quot; (status color, not an action)</code>
          </div>
        </div>

        <div>
          <PageHeader
            title='"Positive" and "destructive" both have two different treatments'
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
          />
          <div className="ui-ref-compare-grid">
            <div className="ui-ref-compare-card">
              <div className="app-button-row">
                <AppButton variant="success">Success (pastel)</AppButton>
                <AppButton variant="start">Start (solid)</AppButton>
              </div>
              <p className="app-subtle-text" style={{ margin: 0 }}>
                Both mean &ldquo;affirmative/go,&rdquo; rendered with entirely different visual weight (tinted pill
                vs. solid fill).
              </p>
            </div>
            <div className="ui-ref-compare-card">
              <div className="app-button-row">
                <AppButton variant="danger">Danger (pastel)</AppButton>
                <AppButton variant="stop">Stop (solid)</AppButton>
              </div>
              <p className="app-subtle-text" style={{ margin: 0 }}>
                Both mean &ldquo;destructive/end,&rdquo; same split. <code className="ui-ref-code">start</code>/
                <code className="ui-ref-code">stop</code> are used today only by Slideshow&rsquo;s Start/End
                Presentation controls.
              </p>
            </div>
          </div>
        </div>

        <p className="app-subtle-text" style={{ margin: 0 }}>
          <strong>Resolved (Central UI Standard, Stage 2):</strong> going forward, &ldquo;affirmative&rdquo; is not
          a distinct action tier -- an action that succeeds is still just the <code className="ui-ref-code">
            primary
          </code>{" "}
          action for its surface, and color communicates urgency/destructiveness, not a decoration for good
          outcomes. <code className="ui-ref-code">success</code>/<code className="ui-ref-code">start</code> remain
          as transitional aliases for existing call sites (shown above) but are not part of the canonical
          hierarchy. Destructive keeps its existing two-step shape unchanged: <code className="ui-ref-code">
            danger
          </code>{" "}
          (quiet, initiation) for a row/page-level &ldquo;begin this destructive action&rdquo; control, and{" "}
          <code className="ui-ref-code">stop</code> (solid, confirmation) reserved for the moment a{" "}
          <code className="ui-ref-code">Dialog</code>/<code className="ui-ref-code">ConfirmDialog</code> actually
          confirms it -- that was already correct (System 3, approved 2026-08-19) and is unchanged here.
        </p>

        <div>
          <PageHeader
            title="Representative action groups"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
          />
          <div className="ui-ref-compare-grid">
            <div className="ui-ref-compare-card">
              <strong>Save / Cancel</strong>
              <RowActions>
                <AppButton variant="primary">Save</AppButton>
                <AppButton>Cancel</AppButton>
              </RowActions>
            </div>
            <div className="ui-ref-compare-card">
              <strong>Edit / View</strong>
              <RowActions>
                <AppButton>Edit</AppButton>
                <AppButton variant="secondary">View</AppButton>
              </RowActions>
            </div>
            <div className="ui-ref-compare-card">
              <strong>Approve / Reject (canonical)</strong>
              <RowActions>
                <AppButton variant="primary">Approve</AppButton>
                <AppButton variant="danger">Reject</AppButton>
              </RowActions>
              <p className="app-subtle-text" style={{ margin: 0 }}>
                Approve is this row&rsquo;s principal action (primary); Reject is destructive-initiation (danger).
                Not <code className="ui-ref-code">success</code>/<code className="ui-ref-code">danger</code> -- see
                the resolved note above.
              </p>
            </div>
            <div className="ui-ref-compare-card">
              <strong>Complete / Cancel (canonical)</strong>
              <RowActions>
                <AppButton variant="primary">Complete</AppButton>
                <AppButton variant="danger">Cancel</AppButton>
              </RowActions>
            </div>
            <div className="ui-ref-compare-card">
              <strong>Destructive, confirmed</strong>
              <RowActions>
                <AppButton variant="danger" onClick={() => setConfirmOpen(true)}>
                  Cancel Registration
                </AppButton>
              </RowActions>
              <p className="app-subtle-text" style={{ margin: 0 }}>
                Opens the real, shared <code className="ui-ref-code">ConfirmDialog</code> component.
              </p>
            </div>
            <div className="ui-ref-compare-card">
              <strong>Compact row action (RowActions, 44px touch target)</strong>
              <RowActions>
                <AppButton aria-label="Edit Jordan Vega">Edit</AppButton>
                <AppButton variant="danger" aria-label="Cancel Jordan Vega's request">
                  Cancel
                </AppButton>
              </RowActions>
            </div>
          </div>
        </div>

        <ConfirmDialog
          open={confirmOpen}
          title="Cancel this registration?"
          message="This is a reference-page demo only -- confirming here does not change any real data."
          confirmLabel="Cancel Registration"
          cancelLabel="Keep Registration"
          danger
          onConfirm={() => setConfirmOpen(false)}
          onCancel={() => setConfirmOpen(false)}
        />

        <p className="app-subtle-text" style={{ margin: 0 }}>
          <strong>Resolved (Central UI Standard, Stage 2):</strong> <code className="ui-ref-code">ConfirmDialog</code>{" "}
          (used above) no longer hand-styles its own overlay -- it renders through the canonical{" "}
          <code className="ui-ref-code">Dialog</code> foundation (<code className="ui-ref-code">.app-dialog*</code>,
          fully tokenized), keeping only its own confirm/cancel decision logic. See{" "}
          <a href="#overlays" className="app-button">
            Overlays
          </a>{" "}
          below for <code className="ui-ref-code">Dialog</code> on its own.
        </p>
      </RefSection>

      {/* =================================================================
          4. FORM CONTROLS
          ================================================================= */}
      <RefSection
        id="forms"
        title="Form Controls"
        description="Actual tokenized control treatments (via .app-card-section input/select/textarea), one compact form and one standard edit form."
      >
        <PageSection variant="section">
          <PageHeader
            title="Compact form"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
            description="A narrow, single-purpose form -- two fields and one action."
          />
          <div style={{ display: "grid", gap: "var(--space-3)", maxWidth: 360 }}>
            <div>
              <label className="table-toolbar-label" htmlFor="ref-compact-name">
                Requester name
              </label>
              <input id="ref-compact-name" placeholder="Full name" />
            </div>
            <div>
              <label className="table-toolbar-label" htmlFor="ref-compact-category">
                Category
              </label>
              <select id="ref-compact-category" defaultValue="vendor">
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
            <AppButton variant="primary">Add</AppButton>
          </div>
        </PageSection>

        <PageSection variant="section">
          <PageHeader
            title="Standard edit form"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
            description="Every currently-supported control type and state, at normal edit-form density."
          />
          <div style={{ display: "grid", gap: "var(--space-5)" }}>
            <div>
              <label className="table-toolbar-label" htmlFor="ref-required-field">
                Business name <span style={{ color: "var(--color-status-error)" }}>*</span> required
              </label>
              <input id="ref-required-field" placeholder="Required text input" required />
            </div>

            <div>
              <label className="table-toolbar-label" htmlFor="ref-help-field">
                Website
              </label>
              <input id="ref-help-field" placeholder="https://..." />
              <div className="app-subtle-text" style={{ marginTop: "var(--space-2)" }}>
                Optional. Include the full https:// address.
              </div>
            </div>

            <div>
              <label className="table-toolbar-label" htmlFor="ref-error-field">
                Contact email
              </label>
              <input
                id="ref-error-field"
                defaultValue="not-an-email"
                aria-invalid="true"
                aria-describedby="ref-error-field-message"
                style={{ borderColor: "var(--color-status-error)", background: "var(--color-status-error-bg)" }}
              />
              <div
                id="ref-error-field-message"
                role="alert"
                style={{ marginTop: "var(--space-2)", fontSize: "var(--font-size-small)", color: "var(--color-status-error)" }}
              >
                Enter a valid email address.
              </div>
            </div>

            <div className="app-form-grid-2">
              <div>
                <label className="table-toolbar-label" htmlFor="ref-search-input">
                  Search input
                </label>
                <input id="ref-search-input" type="search" placeholder="Search..." />
              </div>
              <div>
                <label className="table-toolbar-label" htmlFor="ref-select-input">
                  Select / dropdown
                </label>
                <select id="ref-select-input" defaultValue="pending">
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="table-toolbar-label" htmlFor="ref-textarea">
                Notes
              </label>
              <textarea id="ref-textarea" rows={3} placeholder="Free-text notes..." />
            </div>

            <label style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
              <input type="checkbox" defaultChecked />
              Checkbox (e.g. &ldquo;Visible to members&rdquo;)
            </label>

            <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: "var(--space-2)" }}>
              <legend className="table-toolbar-label" style={{ padding: 0 }}>
                Radio group (e.g. Slideshow deck selection mode)
              </legend>
              <label style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
                <input type="radio" name="ref-radio-demo" defaultChecked /> All approved photos
              </label>
              <label style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
                <input type="radio" name="ref-radio-demo" /> Manual selection
              </label>
            </fieldset>

            <div>
              <label className="table-toolbar-label" htmlFor="ref-disabled-input">
                Disabled control
              </label>
              <input id="ref-disabled-input" defaultValue="Not editable right now" disabled />
            </div>

            <div>
              <div className="table-toolbar-label">Read-only value</div>
              <div style={{ fontSize: "var(--font-size-body)" }}>Priya Natarajan</div>
              <div className="app-subtle-text">
                Rendered as plain text, not a disabled input -- the pattern already used by Attendees&rsquo; view-mode
                record display.
              </div>
            </div>
          </div>
        </PageSection>

        <PageSection variant="section" title="Field / Input / Select / Textarea / Checkbox / Radio (canonical)">
          <p className="app-subtle-text" style={{ margin: 0 }}>
            <strong>Resolved (Central UI Standard, Stage 2):</strong> the three parallel rule sets below this
            heading (<code className="ui-ref-code">.app-card-section input</code>,{" "}
            <code className="ui-ref-code">.table-toolbar-row input</code>,{" "}
            <code className="ui-ref-code">.app-form-input</code>) are now transitional aliases for one canonical{" "}
            <code className="ui-ref-code">.app-control</code> rule, which{" "}
            <code className="ui-ref-code">components/ui/Field.tsx</code>&rsquo;s <code className="ui-ref-code">
              Input
            </code>
            /<code className="ui-ref-code">Select</code>/<code className="ui-ref-code">Textarea</code> apply
            directly. <code className="ui-ref-code">Field</code> owns label/required/help/error association;
            error styling now has a real, shared treatment (below) instead of being reference-only.
          </p>

          <div className="ui-ref-compare-grid">
            <div className="ui-ref-compare-card">
              <Field label="Event name" required help="Shown to attendees on their agenda.">
                {(controlProps) => (
                  <Input {...controlProps} defaultValue="EpicentraX Fall Rally" />
                )}
              </Field>
            </div>
            <div className="ui-ref-compare-card">
              <Field label="Contact email" error="Enter a valid email address.">
                {(controlProps) => <Input {...controlProps} type="email" defaultValue="not-an-email" />}
              </Field>
            </div>
            <div className="ui-ref-compare-card">
              <Field label="Region" disabled help="Set automatically from the Tenant's default region.">
                {(controlProps) => (
                  <Select {...controlProps} disabled defaultValue="west">
                    <option value="west">West</option>
                    <option value="east">East</option>
                  </Select>
                )}
              </Field>
            </div>
            <div className="ui-ref-compare-card">
              <Field label="Notes">
                {(controlProps) => (
                  <Textarea {...controlProps} rows={3} defaultValue="Arrives Friday evening; needs accessible parking." />
                )}
              </Field>
            </div>
            <div className="ui-ref-compare-card">
              <Checkbox label="Pinned" help="Shows at the top of the announcements list." />
            </div>
            <div className="ui-ref-compare-card">
              <Radio label="Standard registration" name="ui-ref-radio-demo" defaultChecked />
              <Radio label="VIP registration" name="ui-ref-radio-demo" />
            </div>
          </div>
        </PageSection>

        <p className="app-subtle-text" style={{ margin: 0 }}>
          <strong>Resolved (Central UI Standard, Stage 2):</strong> a bare <code className="ui-ref-code">
            &lt;input&gt;
          </code>{" "}
          outside any legacy container still renders unstyled -- but new/migrated code applies{" "}
          <code className="ui-ref-code">.app-control</code> directly via <code className="ui-ref-code">Input</code>/
          <code className="ui-ref-code">Select</code>/<code className="ui-ref-code">Textarea</code>, so this no
          longer depends on which container a control happens to sit inside.
        </p>
      </RefSection>

      {/* =================================================================
          5. SEARCH / FILTER / TOOLBAR
          ================================================================= */}
      <RefSection
        id="toolbar"
        title="Search / Filter / Toolbar"
        description="The real TableToolbar, wired live to the sample table in Section 6 below -- try searching or filtering."
      >
        <TableToolbar>
          <TableToolbarPrimaryRow>
            <SearchField
              label="Search"
              value={demoSearch}
              onChange={setDemoSearch}
              id="ref-toolbar-search"
              placeholder="Name, email, phone, site..."
            />
            <div>
              <label className="table-toolbar-label" htmlFor="ref-toolbar-category">
                Category
              </label>
              <select
                id="ref-toolbar-category"
                value={demoCategory}
                onChange={(e) => setDemoCategory(e.target.value as SampleCategory | "all")}
              >
                <option value="all">All</option>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
            {demoHasClearable ? (
              <div style={{ alignSelf: "end" }}>
                <AppButton onClick={clearDemoFilters}>Clear Search &amp; Filters</AppButton>
              </div>
            ) : null}
          </TableToolbarPrimaryRow>

          <TableToolbarDisclosure label="More filters" activeCount={demoActiveFilterCount}>
            <div>
              <label className="table-toolbar-label" htmlFor="ref-toolbar-status">
                Status (true filter)
              </label>
              <select
                id="ref-toolbar-status"
                value={demoStatus}
                onChange={(e) => setDemoStatus(e.target.value as SampleStatus | "all")}
              >
                <option value="all">All Statuses</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <label style={{ display: "flex", gap: "var(--space-3)", alignItems: "end", paddingBottom: "var(--space-3)" }}>
              <input type="checkbox" checked={demoShowNotes} onChange={(e) => setDemoShowNotes(e.target.checked)} />
              Show notes column (display preference, not a filter)
            </label>
          </TableToolbarDisclosure>
        </TableToolbar>

        <p className="app-subtle-text" style={{ margin: 0 }}>
          &ldquo;Status&rdquo; changes which rows exist in the result set -- a true filter. &ldquo;Show notes
          column&rdquo; changes only how a row is displayed and stays checked even after Clear Search &amp; Filters
          runs -- a display preference. Try it: set a Status, check the notes box, then click Clear Search &amp;
          Filters and see which one resets.
        </p>
      </RefSection>

      {/* =================================================================
          6. TABLES AND LISTS
          ================================================================= */}
      <RefSection
        id="tables"
        title="Tables and Lists"
        description="DataTable/ResponsiveList/RowActions/StatusBadge with the sample data, filtered live by Section 5's toolbar."
      >
        <PageSection variant="section">
          <PageHeader
            title="Live -- follows your current shell capability"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
            description={`isCompact=${String(isCompact)}, viewportClass="${viewportClass}" -- currently rendering as ${
              liveShowsList ? "ResponsiveList" : "DataTable"
            }. Resize the window (or use your browser's device toolbar) to watch it switch.`}
            descriptionClassName="app-subtle-text"
          />
          <SampleRoster records={filteredRecords} showNotes={demoShowNotes} asList={liveShowsList} />
        </PageSection>

        <div className="ui-ref-compare-grid" style={{ gridTemplateColumns: "1fr" }}>
          <PageSection variant="section">
            <PageHeader
              title="Desktop DataTable (forced -- all 6 sample rows, unfiltered)"
              headingLevel="h3"
              titleStyle={{ fontSize: "var(--font-size-card-title)" }}
              description="Column headings, normal row density, status, metadata, actions, a long value, and missing values (Casey/Dana), side by side regardless of your current viewport."
              descriptionClassName="app-subtle-text"
            />
            <SampleRoster records={SAMPLE_RECORDS} showNotes asList={false} />
          </PageSection>

          <PageSection variant="section">
            <PageHeader
              title="Compact ResponsiveList (forced -- all 6 sample rows, unfiltered)"
              headingLevel="h3"
              titleStyle={{ fontSize: "var(--font-size-card-title)" }}
              description="Same information and the same actions as the table above -- nothing is hidden, only re-laid-out."
              descriptionClassName="app-subtle-text"
            />
            <SampleRoster records={SAMPLE_RECORDS} showNotes asList />
          </PageSection>
        </div>

        <Observation>
          &ldquo;Pinned&rdquo; styling (<code className="ui-ref-code">.data-table-row-pinned</code> /{" "}
          <code className="ui-ref-code">.responsive-list-item-pinned</code>) and &ldquo;selected&rdquo; styling
          both render as the same left accent border in the table, but only &ldquo;selected&rdquo; gets a
          full-row background tint in the list. The two states are visually harder to tell apart in the table than
          in the list.
        </Observation>

        <div id="tables-comparison" style={{ display: "grid", gap: "var(--space-5)" }}>
          <PageHeader
            title="Table & Action Treatment Comparison"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
            description="Design workbench only -- none of the four treatments below is approved or canonical. Same six sample records in every one, so scanability, row height, and action prominence can be compared directly."
            descriptionClassName="app-subtle-text"
          />

          <Alert tone="info">
            We are exploring <strong>capabilities + available space + content needs + user preference&nbsp;→&nbsp;appropriate
            presentation</strong>, not a fixed &ldquo;desktop = table, mobile = list&rdquo; rule. Review each treatment
            against: is it easy to scan? Are rows too tall? Are actions too prominent or too hidden? Is primary vs.
            secondary information obvious? Are Casey&rsquo;s long name/email/note handled well? Would it feel natural
            with a mouse/trackpad? With touch? Which pieces should combine into the eventual canonical design?
          </Alert>

          <PageSection variant="section">
            <PageHeader
              title="1. Current / Baseline"
              headingLevel="h3"
              titleStyle={{ fontSize: "var(--font-size-body)" }}
              description="The exact DataTable treatment from the Live/Desktop example above, repeated here for direct side-by-side comparison. DataTable + RowActions + AppButton exactly as shipped -- no prototype styling."
              descriptionClassName="app-subtle-text"
            />
            <SampleRoster records={SAMPLE_RECORDS} showNotes asList={false} />
          </PageSection>

          <PageSection variant="section">
            <PageHeader
              title="2. Desktop / Pointer-Optimized Candidate"
              headingLevel="h3"
              titleStyle={{ fontSize: "var(--font-size-body)" }}
              description="Category and site fold into the record cell as secondary text; notes clamp to two lines (full text stays in the DOM); actions stay on one row via a non-wrapping RowActions. Prototype-only: the note-clamp and nowrap-actions treatments do not exist as shared primitives yet."
              descriptionClassName="app-subtle-text"
            />
            <DesktopPointerCandidate records={SAMPLE_RECORDS} />
          </PageSection>

          <PageSection variant="section">
            <PageHeader
              title="3. Touch-Optimized Candidate"
              headingLevel="h3"
              titleStyle={{ fontSize: "var(--font-size-body)" }}
              description="One always-visible, generously-sized primary action (Contact); Edit/Cancel sit behind a native, always-visible &quot;More actions&quot; disclosure -- no hover, no gesture, same native <details>/<summary> pattern TableToolbarDisclosure already uses. Prototype-only: the larger touch-target sizing on the primary action does not exist as a shared primitive yet."
              descriptionClassName="app-subtle-text"
            />
            <TouchOptimizedCandidate records={SAMPLE_RECORDS} />
          </PageSection>

          <PageSection variant="section">
            <PageHeader
              title="4. Existing ResponsiveList"
              headingLevel="h3"
              titleStyle={{ fontSize: "var(--font-size-body)" }}
              description="The exact ResponsiveList treatment from the Compact example above, repeated here for direct side-by-side comparison -- today's actual compact-shell default, not a new candidate."
              descriptionClassName="app-subtle-text"
            />
            <SampleRoster records={SAMPLE_RECORDS} showNotes asList />
          </PageSection>

          <Observation>
            None of these four is being recommended over the others here. Candidates 2 and 3 each solve a real
            problem the baseline has (row height from always-shown notes; three same-weight buttons with no
            primary/secondary distinction) with a treatment built for a specific input mode -- but neither is a
            drop-in shared primitive today, and mixing pieces from more than one (e.g. Candidate 2&rsquo;s compact
            record cell with Candidate 3&rsquo;s primary/secondary action split) is a live option worth discussing,
            not just picking one of the four whole.
          </Observation>
        </div>
      </RefSection>

      {/* =================================================================
          7. STATUS AND SEMANTIC TREATMENTS
          ================================================================= */}
      <RefSection
        id="status"
        title="Status and Semantic Treatments"
        description="Every StatusBadge tone, plus the categorical-role treatment that currently lives outside StatusBadge entirely."
      >
        <div>
          <PageHeader title="Lifecycle status (StatusBadge)" headingLevel="h3" titleStyle={{ fontSize: "var(--font-size-card-title)" }} />
          <div className="app-button-row">
            <StatusBadge tone="neutral">New</StatusBadge>
            <StatusBadge tone="warning">Pending</StatusBadge>
            <StatusBadge tone="info">Confirmed</StatusBadge>
            <StatusBadge tone="success">Complete</StatusBadge>
            <StatusBadge tone="danger">Cancelled</StatusBadge>
          </div>
        </div>

        <div>
          <PageHeader
            title="Standalone semantic tones (not tied to a lifecycle)"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
          />
          <div className="app-button-row">
            <StatusBadge tone="warning">Needs Attention</StatusBadge>
            <StatusBadge tone="info">Informational</StatusBadge>
            <StatusBadge tone="neutral">No Event Selected</StatusBadge>
          </div>
        </div>

        <div>
          <PageHeader
            title="Category/role -- NOT a StatusBadge (this is the exposed gap)"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
            description="Attendees' participant-type badge, reproduced verbatim. It is categorical (who someone is), not a lifecycle status (what state a record is in) -- deliberately left outside StatusBadge's 5-tone vocabulary in UI Phase 4."
            descriptionClassName="app-subtle-text"
          />
          <div className="app-button-row">
            {CATEGORY_OPTIONS.map((c) => (
              <span key={c} style={sampleCategoryBadgeStyle(c)}>
                {CATEGORY_LABEL[c]}
              </span>
            ))}
          </div>
        </div>

        <div>
          <PageHeader
            title="Action, for comparison -- an AppButton, not a badge"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
          />
          <AppButton variant="primary">Email Vendor</AppButton>
        </div>

        <p className="app-subtle-text" style={{ margin: 0 }}>
          <strong>Resolved (Central UI Standard):</strong> still no shared category/type badge primitive, and
          still deliberate, not an oversight -- the sample above remains five hardcoded hex pairs, reference-only,
          never a real component. A genuine second categorical data source has since appeared (Nearby&rsquo;s{" "}
          <code className="ui-ref-code">place_categories</code> catalog, 35 real categories), but it does not
          render as a colored pill/badge anywhere -- plain text in a list, an option in a canonical{" "}
          <code className="ui-ref-code">Select</code>, and (a page-specific, not central, concern) a per-category
          card color on Member Nearby. The bar this section&rsquo;s own question set -- a real second
          <em> badge</em>-shaped consumer -- still has not been met. Guidance for whoever needs one next:
          arbitrary-cardinality category/type labels should use <code className="ui-ref-code">StatusBadge
          tone=&quot;neutral&quot;</code> (plain, text-carries-meaning, no per-value color), not a new hardcoded
          hex-per-category system like this prototype&rsquo;s own.
        </p>
      </RefSection>

      {/* =================================================================
          8. ALERTS AND FEEDBACK
          ================================================================= */}
      <RefSection id="alerts" title="Alerts and Feedback" description="Every Alert tone, short and long message length.">
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Alert tone="info">Loading vendor requests...</Alert>
          <Alert tone="success">Request status updated.</Alert>
          <Alert tone="warning">Placement status is temporarily unavailable.</Alert>
          <Alert tone="danger">We couldn&rsquo;t load attendee records. Please try again.</Alert>
          <Alert tone="neutral">No admin event selected.</Alert>
          <Alert tone="info">
            This is a longer, wrapping example so line-height and padding can be judged on multi-line content: the
            batched canonical placement read for this roster covers every visible attendee in one request, refreshed
            automatically whenever the visible set or the current Event changes, so no per-row query is issued while
            you scroll or filter.
          </Alert>
        </div>
      </RefSection>

      {/* =================================================================
          9. CARDS / CONTAINERS / SECTIONS
          ================================================================= */}
      <RefSection
        id="containers"
        title="Cards, Containers, and Sections"
        description="Every current way content gets visually grouped, side by side."
      >
        <div className="ui-ref-compare-grid">
          <div>
            <div className="card">
              <strong>.card</strong>
              <p className="app-subtle-text" style={{ margin: "var(--space-2) 0 0" }}>
                bg-panel, padding var(--space-8) = 16px
              </p>
            </div>
          </div>
          <div>
            <div className="app-card-section">
              <strong>.app-card-section (PageSection variant=&quot;section&quot;)</strong>
              <p className="app-subtle-text" style={{ margin: "var(--space-2) 0 0" }}>
                bg-panel, padding var(--space-6) = 14px
              </p>
            </div>
          </div>
          <div>
            <div className="app-card-section-muted">
              <strong>.app-card-section-muted</strong>
              <p className="app-subtle-text" style={{ margin: "var(--space-2) 0 0" }}>
                bg-muted, padding var(--space-6) = 14px
              </p>
            </div>
          </div>
        </div>

        <Observation>
          <code className="ui-ref-code">.card</code> and <code className="ui-ref-code">.app-card-section</code> are
          the same border, radius, and background -- only the padding differs (16px vs. 14px) -- with no documented
          rule for which one a new page should reach for. <code className="ui-ref-code">PageSection</code> exposes
          both as if they were a deliberate choice (<code className="ui-ref-code">variant=&quot;card&quot;</code> vs.{" "}
          <code className="ui-ref-code">variant=&quot;section&quot;</code>); today the difference is 2px of padding.
        </Observation>
        <Observation>
          Nesting risk: a <code className="ui-ref-code">PageSection</code> inside a <code className="ui-ref-code">
            PageSection
          </code>{" "}
          produces a box inside a box inside a box (see the &ldquo;Grouped vs. separated&rdquo; example in Section 1)
          -- worth watching for as more pages migrate, so EpicentraX doesn&rsquo;t drift toward being overly
          card-heavy. A bare heading with page-level gap is often enough on its own.
        </Observation>
      </RefSection>

      {/* =================================================================
          10. ACTION ROWS
          ================================================================= */}
      <RefSection id="actions" title="Action Rows" description="RowActions wrapping/spacing at increasing action counts.">
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          <div>
            <div className="app-subtle-text">Two actions</div>
            <RowActions>
              <AppButton>Edit</AppButton>
              <AppButton variant="muted">View</AppButton>
            </RowActions>
          </div>
          <div>
            <div className="app-subtle-text">Several actions, mixed hierarchy</div>
            <RowActions>
              <AppButton>Edit</AppButton>
              <AppButton variant="primary">Email Vendor</AppButton>
              <AppButton variant="muted">Show on Map</AppButton>
              <AppButton variant="success">Approve</AppButton>
              <AppButton variant="danger">Reject</AppButton>
            </RowActions>
          </div>
          <div>
            <div className="app-subtle-text">Navigation + mutation together</div>
            <RowActions>
              <AppLinkButton href="#tables">View in Check-In</AppLinkButton>
              <AppButton variant="primary">Mark Contacted</AppButton>
            </RowActions>
          </div>
          <div>
            <div className="app-subtle-text">Destructive action separated to the end</div>
            <RowActions>
              <AppButton>Edit</AppButton>
              <AppButton>Duplicate</AppButton>
              <AppButton variant="danger">Delete</AppButton>
            </RowActions>
          </div>
        </div>
      </RefSection>

      {/* =================================================================
          11. EMPTY / LOADING / ERROR STATES
          ================================================================= */}
      <RefSection
        id="states"
        title="Empty, Loading, and Error States (✅ approved)"
        description={
          <>
            Controlled examples -- not real backend failures. <code className="ui-ref-code">EmptyState</code> and{" "}
            <code className="ui-ref-code">LoadingState</code> (Central UI Standard) are thin wrappers around the
            existing <code className="ui-ref-code">Alert</code> primitive -- not a second, competing status
            container -- replacing the ~20 hand-written empty-state paragraphs and ~40 hand-written
            &ldquo;Loading X...&rdquo; strings elsewhere in the app. Error states remain plain{" "}
            <code className="ui-ref-code">Alert tone=&quot;danger&quot;</code> -- an error is not an empty/loading
            state, so no dedicated component was added for it.
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <EmptyState message="No records have been submitted for this Event yet." />
          <EmptyState
            message={
              demoStatesFiltersCleared
                ? "Filters cleared -- change them again to see this message return."
                : "No records match your search or filters. Try clearing them."
            }
            action={<AppButton onClick={() => setDemoStatesFiltersCleared(true)}>Clear filters</AppButton>}
          />
          <LoadingState message="Loading records..." />
          <Alert tone="danger">We couldn&rsquo;t load these records. Please try again.</Alert>
          <Alert tone="danger">You do not have access to this workspace.</Alert>
        </div>
      </RefSection>

      {/* =================================================================
          12. RESPONSIVE REVIEW
          ================================================================= */}
      <RefSection
        id="responsive"
        title="Responsive Review"
        description="This whole page is meant to be opened at several widths, not just read once."
      >
        <p style={{ margin: 0, fontSize: "var(--font-size-body)" }}>
          Suggested widths to check: a normal desktop window (&gt;1200px, &ldquo;wide&rdquo;), a narrower
          desktop/tablet window (900-1199px, &ldquo;standard&rdquo;), and a browser-devtools phone/tablet emulation
          (&lt;900px, &ldquo;compact&rdquo;). Section 6 above shows the live DataTable/ResponsiveList switch as you
          resize; Section 13 below shows the raw capability reading in real time. No page-local resize listener or
          breakpoint exists on this page or in the shared primitives it uses -- every responsive decision on this
          page comes from <code className="ui-ref-code">useShellInterfaceCapabilities()</code>.
        </p>
      </RefSection>

      {/* =================================================================
          13. DEVICE & LAYOUT PREFERENCES
          ================================================================= */}
      <RefSection
        id="device"
        title="Device & Layout Preferences"
        description="What the shell actually knows about your device right now, what EpicentraX persists today, and what does not exist yet."
      >
        <PageSection variant="section">
          <PageHeader
            title="Live capability reading"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
          />
          <DataTable caption="Current useShellInterfaceCapabilities() values">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Current value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>viewportClass</td>
                <td>
                  <StatusBadge tone="info">{viewportClass}</StatusBadge>
                </td>
              </tr>
              <tr>
                <td>isCompact</td>
                <td>
                  <StatusBadge tone={isCompact ? "warning" : "neutral"}>{String(isCompact)}</StatusBadge>
                </td>
              </tr>
              <tr>
                <td>supportsPersistentNavigation</td>
                <td>{String(supportsPersistentNavigation)}</td>
              </tr>
              <tr>
                <td>prefersReducedMotion</td>
                <td>{String(prefersReducedMotion)}</td>
              </tr>
            </tbody>
          </DataTable>
          <p className="app-subtle-text" style={{ marginTop: "var(--space-4)" }}>
            Resize the window to watch this table update. Source: <code className="ui-ref-code">
              components/shell/useShellViewport.ts
            </code>
            .
          </p>
        </PageSection>

        <PageSection variant="section">
          <PageHeader
            title="What capability detection is -- and is not"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
          />
          <ul style={{ margin: 0, paddingLeft: "var(--space-6)", display: "grid", gap: "var(--space-2)" }}>
            <li>
              Purely viewport-width thresholds: <code className="ui-ref-code">compact</code> below 900px,{" "}
              <code className="ui-ref-code">standard</code> 900-1199px, <code className="ui-ref-code">wide</code>{" "}
              1200px and up, plus a live <code className="ui-ref-code">prefers-reduced-motion</code> read. Recomputed
              from <code className="ui-ref-code">window.innerWidth</code> and <code className="ui-ref-code">
                matchMedia
              </code>{" "}
              listeners on every resize/orientation change -- never cached, never persisted.
            </li>
            <li>
              The hook&rsquo;s own source comment is explicit: this is &ldquo;not a device identity, preference,
              remembered-device record, or authority input.&rdquo;
            </li>
            <li>
              No user-agent sniffing, no persisted device identity, and no device-class concept (&ldquo;this is an
              iPad&rdquo;) exist anywhere in the codebase for layout purposes. A search for user-agent handling found
              only unrelated identity-claim rate-limiting/fraud hashing in <code className="ui-ref-code">
                app/api/member/identity-claim/*
              </code>
              , not layout.
            </li>
          </ul>
        </PageSection>

        <PageSection variant="section">
          <PageHeader
            title="Try it: a proposed &ldquo;preferred view&rdquo; control (demo only)"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
            description="No such control exists anywhere in the real app today -- isCompact alone, automatically, decides Table vs. List everywhere. This is local component state, not persisted anywhere, shown to make the proposed hierarchy tangible."
            descriptionClassName="app-subtle-text"
          />
          <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: "var(--space-2)" }}>
            <legend className="table-toolbar-label" style={{ padding: 0 }}>
              Preferred view (this device, demo only)
            </legend>
            {(["automatic", "table", "list"] as const).map((mode) => (
              <label key={mode} style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
                <input
                  type="radio"
                  name="ref-preferred-view"
                  checked={demoPreferredView === mode}
                  onChange={() => setDemoPreferredView(mode)}
                />
                {mode === "automatic" ? "Automatic (follow shell capability)" : mode === "table" ? "Table / Data-dense" : "List / Compact"}
              </label>
            ))}
          </fieldset>
          <p className="app-subtle-text" style={{ marginTop: "var(--space-3)" }}>
            Section 6&rsquo;s &ldquo;Live&rdquo; example above reflects this control: choosing List always works;
            choosing Table only wins while the shell capability is not compact -- capability remains the safety
            constraint, preference only chooses within it.
          </p>
        </PageSection>

        <PageSection variant="section">
          <PageHeader
            title="Existing persistence -- what actually happens today"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
          />
          <DataTable caption="Existing view/filter persistence, by page">
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col">Persists search/filters/view across reloads?</th>
                <th scope="col">Mechanism</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Attendees</td>
                <td>Yes -- search, both filters, view mode, sort, page size, and a display toggle, all together</td>
                <td>
                  <code className="ui-ref-code">localStorage[&quot;fcoc-attendee-command-center-prefs&quot;]</code>
                </td>
              </tr>
              <tr>
                <td>Vendors, Vendor Requests, Announcements</td>
                <td>No -- resets on every reload</td>
                <td>None (component state only)</td>
              </tr>
              <tr>
                <td>Events (status filter only)</td>
                <td>Yes, for the one status filter</td>
                <td>
                  <code className="ui-ref-code">localStorage</code> (separate key, separate from Attendees&rsquo;)
                </td>
              </tr>
            </tbody>
          </DataTable>
          <Observation>
            Attendees&rsquo; single stored blob mixes true filters (<code className="ui-ref-code">search</code>,{" "}
            <code className="ui-ref-code">dataStatusFilter</code>, <code className="ui-ref-code">
              participantTypeFilter
            </code>
            ) together with true display preferences (<code className="ui-ref-code">pageSize</code>,{" "}
            <code className="ui-ref-code">viewMode</code>, <code className="ui-ref-code">attendeeSortMode</code>,{" "}
            <code className="ui-ref-code">showResolvedInfo</code>) in one undifferentiated JSON object, even though
            UI Phase 4&rsquo;s own Clear Filters control deliberately resets only the filter half. The UI-level
            distinction this page demonstrates in Section 5 is not reflected at the persistence layer for the one
            page that persists anything at all.
          </Observation>
          <Observation>
            Every one of these mechanisms is <code className="ui-ref-code">localStorage</code>, i.e. device-local
            (this specific browser on this specific machine). Nothing is tied to the authenticated admin&rsquo;s
            identity, so a shared/kiosk browser used by two different admins on the same machine silently inherits
            whichever admin set it last. There is no device-class concept, no per-device-class storage, and no
            database-backed preferences table anywhere in the schema.
          </Observation>
        </PageSection>

        <PageSection variant="section">
          <PageHeader
            title="Preference scope -- audited, not assumed"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
          />
          <DataTable caption="Preference scope options and current support">
            <thead>
              <tr>
                <th scope="col">Scope</th>
                <th scope="col">Currently supported?</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Same user + same device</td>
                <td>
                  <StatusBadge tone="warning">Partially -- Attendees only, via localStorage</StatusBadge>
                </td>
              </tr>
              <tr>
                <td>Same user + device class (e.g. &ldquo;my iPad&rdquo;)</td>
                <td>
                  <StatusBadge tone="danger">No</StatusBadge>
                </td>
              </tr>
              <tr>
                <td>Same user, every device</td>
                <td>
                  <StatusBadge tone="danger">No -- no database-backed preference store exists</StatusBadge>
                </td>
              </tr>
              <tr>
                <td>Page-specific vs. app-wide</td>
                <td>
                  <StatusBadge tone="warning">Page-specific only, and only where a page opted in</StatusBadge>
                </td>
              </tr>
            </tbody>
          </DataTable>
        </PageSection>

        <PageSection variant="section">
          <PageHeader
            title="Proposed decision order (for approval -- not implemented)"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
          />
          <ol style={{ margin: 0, paddingLeft: "var(--space-6)", display: "grid", gap: "var(--space-2)" }}>
            <li>Hard capability/safety constraint (isCompact -- always wins; a compact device never renders an unusable dense table)</li>
            <li>Explicit preference for this device/device class, if one exists</li>
            <li>Page-specific preference, if the page supports one</li>
            <li>App-wide user preference</li>
            <li>Automatic shell default</li>
          </ol>
          <p className="app-subtle-text" style={{ marginTop: "var(--space-3)" }}>
            Today, only steps 1 and 5 exist. Steps 2-4 are proposed for Pap/Mel review, not built.
          </p>
        </PageSection>

        <PageSection variant="section">
          <PageHeader
            title="Cross-device scenarios to evaluate"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
          />
          <ul style={{ margin: 0, paddingLeft: "var(--space-6)", display: "grid", gap: "var(--space-2)" }}>
            <li>MacBook Air, wide viewport, prefers Table -- should stay Table.</li>
            <li>Same admin&rsquo;s iPad, standard/compact viewport, prefers List -- should not inherit the laptop&rsquo;s Table preference.</li>
            <li>Same admin&rsquo;s iPhone -- should remain compact/List even if a wider-device preference exists elsewhere.</li>
            <li>
              External display attached to a laptop: because capability is recomputed live from{" "}
              <code className="ui-ref-code">window.innerWidth</code> rather than any cached device identity, this
              already works correctly today with zero special-casing -- worth preserving explicitly as a constraint
              on any future preference layer, not just an accident of the current design.
            </li>
          </ul>
        </PageSection>

        <PageSection variant="section">
          <PageHeader
            title="Touch, pointer, hover, keyboard, and gesture -- audit findings"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
          />
          <ul style={{ margin: 0, paddingLeft: "var(--space-6)", display: "grid", gap: "var(--space-2)" }}>
            <li>
              <strong>Touch target sizing</strong> is a real, existing constraint: <code className="ui-ref-code">
                --touch-target-min
              </code>{" "}
              (42px) applies to every <code className="ui-ref-code">.app-button</code> and toolbar control, bumped
              to 44px inside <code className="ui-ref-code">.row-actions</code> specifically.
            </li>
            <li>
              <strong>Hover</strong> is applied unconditionally via plain CSS <code className="ui-ref-code">:hover</code>{" "}
              everywhere (e.g. <code className="ui-ref-code">.app-button:hover</code>) -- no{" "}
              <code className="ui-ref-code">(hover: hover)</code>/<code className="ui-ref-code">(pointer: fine)</code>{" "}
              guard exists anywhere, so the app does not currently distinguish a mouse-capable input from a
              touch-only one.
            </li>
            <li>
              <strong>Keyboard</strong> relies on native semantics throughout (native <code className="ui-ref-code">
                &lt;details&gt;/&lt;summary&gt;
              </code>{" "}
              for disclosure, native <code className="ui-ref-code">&lt;select&gt;</code>, standard tab order) plus a
              few widget-local handlers (Escape/Enter in <code className="ui-ref-code">ConfirmDialog</code>, arrow
              navigation in the Shell nav drawer). There is no global keyboard-shortcut layer.
            </li>
            <li>
              <strong>Gestures</strong> (<code className="ui-ref-code">@use-gesture/react</code>,{" "}
              <code className="ui-ref-code">@dnd-kit</code>) are scoped to map-viewport pan/zoom and drag-reorder
              components only -- not used anywhere in the list/table/form system this reference page covers, and not
              audited further here.
            </li>
            <li>
              <strong>Orientation</strong> has no explicit handling -- a phone rotated to landscape can cross the
              900px compact threshold on width alone and receive the dense table treatment, even though it is still
              a small touchscreen device with no persistent pointer. This is the concrete case the &ldquo;capability
              constrains, preference chooses within it&rdquo; rule in Section 13 above exists to cover, and it is not
              handled today.
            </li>
          </ul>
        </PageSection>
      </RefSection>

      {/* =================================================================
          14. MID-SIZE UI SCALE -- APPROVED CANONICAL SCALE
          ================================================================= */}
      <RefSection
        id="scale"
        title="Mid-Size UI Scale (✅ Approved -- canonical Admin scale)"
        description="Approved 2026-08-19 as the canonical Admin scale, following the comparison Pap/Mel reviewed here (normal Safari zoom felt slightly small, one ⌘+ step felt too large -- this is the visual midpoint). The values below now live in app/globals.css's :root and are what every shared component actually renders with; nothing on this page is a page-local override of them anymore. Padding, gaps, sidebar width, card dimensions, row spacing, and radii were not touched."
      >
        <Alert tone="success">
          This scale is now real, not a prototype: every <code className="ui-ref-code">--font-size-*</code> token and{" "}
          <code className="ui-ref-code">--touch-target-min</code> in <code className="ui-ref-code">:root</code> carry
          these values, and <code className="ui-ref-code">.shell-page-title</code>/<code className="ui-ref-code">
            .app-button
          </code>
          /<code className="ui-ref-code">.row-actions .app-button</code> (previously hardcoded, not token-driven)
          were updated in place. Every shared component below (DataTable, StatusBadge, AppButton, form controls,{" "}
          <code className="ui-ref-code">.shell-nav-item</code>, <code className="ui-ref-code">.shell-page-title</code>
          , <code className="ui-ref-code">.app-section-title</code>) inherits this automatically -- no per-page
          migration was needed for pages that already use these primitives.
        </Alert>

        <PageSection variant="section">
          <PageHeader
            title="Exact values"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-body)" }}
          />
          <DataTable caption="Legacy vs. approved canonical token values">
            <thead>
              <tr>
                <th scope="col">Property</th>
                <th scope="col">Legacy (pre-2026-08-19)</th>
                <th scope="col">✅ Approved Canonical (current default)</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  --font-size-page-title / .shell-page-title (Central UI Standard, Stage 2: merged into one
                  clamp() token both the token and the live shell chrome title now consume -- previously two
                  separately-tracked values, a static 23px token nothing referenced and the shell&rsquo;s own
                  independent clamp)
                </td>
                <td>clamp(18px, 2.2vw, 24px)</td>
                <td>clamp(19px, 2.3vw, 25px)</td>
                <td>~+4%</td>
              </tr>
              <tr>
                <td>--font-size-section-title</td>
                <td>20px</td>
                <td>21px</td>
                <td>+5%</td>
              </tr>
              <tr>
                <td>--font-size-card-title</td>
                <td>17px</td>
                <td>18px</td>
                <td>+5.9%</td>
              </tr>
              <tr>
                <td>--font-size-body</td>
                <td>14px</td>
                <td>15px</td>
                <td>+7.1%</td>
              </tr>
              <tr>
                <td>--font-size-small</td>
                <td>13px</td>
                <td>14px</td>
                <td>+7.7%</td>
              </tr>
              <tr>
                <td>--font-size-caption</td>
                <td>12px</td>
                <td>13px</td>
                <td>+8.3%</td>
              </tr>
              <tr>
                <td>--touch-target-min</td>
                <td>42px</td>
                <td>45px</td>
                <td>+7.1%</td>
              </tr>
              <tr>
                <td>.app-button font-size (a literal value in the one shared rule, not a --font-size-* token)</td>
                <td>15px</td>
                <td>16px</td>
                <td>+6.7%</td>
              </tr>
              <tr>
                <td>.row-actions .app-button min-height (deliberately above --touch-target-min for precision-sensitive repeated targets)</td>
                <td>44px</td>
                <td>47px</td>
                <td>+6.8%</td>
              </tr>
            </tbody>
          </DataTable>

          <p className="app-subtle-text" style={{ marginTop: "var(--space-4)" }}>
            Deliberately NOT touched, at any scale: page/card padding (<code className="ui-ref-code">--space-*</code>
            ), major page gaps, sidebar width, panel/card dimensions, table row spacing, border radius, and
            decorative whitespace -- every one of those stays exactly as it is today, so density is preserved and
            only legibility changes.
          </p>
        </PageSection>

        <div className="ui-ref-compare-grid">
          <PageSection variant="section">
            <PageHeader
              title="Legacy Scale (historical)"
              headingLevel="h3"
              titleStyle={{ fontSize: "var(--font-size-card-title)" }}
              description="Reproduced with a reference-only override (.ui-ref-scale-legacy) -- these values no longer exist anywhere in :root."
              descriptionClassName="app-subtle-text"
            />
            <div className="ui-ref-scale-legacy">
              <ScaleExamplePanel />
            </div>
          </PageSection>
          <PageSection variant="section">
            <PageHeader
              title="✅ Approved Canonical Scale (current default)"
              headingLevel="h3"
              titleStyle={{ fontSize: "var(--font-size-card-title)" }}
              description="No wrapper class -- this is just how the real components render everywhere now."
              descriptionClassName="app-subtle-text"
            />
            <ScaleExamplePanel />
          </PageSection>
        </div>

        <PageSection variant="section">
          <PageHeader
            title="Compare against the legacy scale on the sample roster"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
            description="Same DataTable example from Section 6, above. Approved Canonical needs no override; Legacy is reproduced with the reference-only class for comparison."
            descriptionClassName="app-subtle-text"
          />
          <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: "var(--space-2)" }}>
            <legend className="table-toolbar-label" style={{ padding: 0 }}>
              View the sample roster at
            </legend>
            {(["legacy", "canonical"] as const).map((mode) => (
              <label key={mode} style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
                <input
                  type="radio"
                  name="ref-scale-toggle"
                  checked={scaleToggle === mode}
                  onChange={() => setScaleToggle(mode)}
                />
                {mode === "legacy" ? "Legacy Scale (historical)" : "✅ Approved Canonical Scale (current default)"}
              </label>
            ))}
          </fieldset>
          <div className={scaleToggle === "legacy" ? "ui-ref-scale-legacy" : undefined} style={{ marginTop: "var(--space-4)" }}>
            <SampleRoster records={SAMPLE_RECORDS} showNotes asList={false} />
          </div>
        </PageSection>

        <p className="app-subtle-text">
          &ldquo;Roughly 5-7%&rdquo; landed between 4.5% and 8.3% depending on the property -- each value was rounded
          to a clean pixel rather than forced to an exact percentage. The page-title and button dimensions that were
          hardcoded rather than token-driven were updated in their one shared rule as part of this approval, per the
          audit that surfaced them.
        </p>
      </RefSection>

      {/* =================================================================
          15. BUTTON HIERARCHY (APPROVED) + TABLE ROW ACTIONS (UNDECIDED)
          ================================================================= */}
      <RefSection
        id="action-hierarchy"
        title="Button Hierarchy (✅ Approved) & Table Row Actions (still undecided)"
        description="Part A (button hierarchy) is approved: System 3 is now the canonical action language, implemented in AppButton/AppLinkButton/ConfirmDialog themselves -- the buttons below are the real shared primitives, not prototype copies. Part B (row-action layout) is NOT decided -- Treatments 1/2/3 remain a live comparison for later Pap/Mel review; only the button styling used inside them is now canonical."
      >
        <div style={{ display: "grid", gap: "var(--space-8)" }}>
          {/* ---- PART A: BUTTON HIERARCHY (APPROVED) ---- */}
          <PageSection variant="section">
            <PageHeader
              title="Part A: Button Hierarchy -- ✅ Approved (System 3)"
              headingLevel="h3"
              titleStyle={{ fontSize: "var(--font-size-card-title)" }}
            />

            <div style={{ display: "grid", gap: "var(--space-6)" }}>
              <div>
                <div className="app-subtle-text" style={{ marginBottom: "var(--space-2)" }}>
                  success/start/danger/stop, as they render today. danger&rsquo;s fill changed to quiet/outlined as
                  part of this approval; success/start were not touched in this pass -- see &ldquo;should green mean
                  status only?&rdquo; below.
                </div>
                <div className="app-button-row">
                  <AppButton variant="success">Success</AppButton>
                  <AppButton variant="start">Start</AppButton>
                  <AppButton variant="danger">Danger</AppButton>
                  <AppButton variant="stop">Stop</AppButton>
                </div>
              </div>

              <div>
                <PageHeader
                  title="Legacy (pre-2026-08-19) -- historical"
                  headingLevel="h3"
                  titleStyle={{ fontSize: "var(--font-size-body)" }}
                  description="Reproduced with reference-only classes (.ui-ref-legacy-ordinary/-danger) -- the real global classes no longer look like this. Navigation/handoff (an AppLinkButton with no variant) used to render identically to an ordinary mutation button."
                  descriptionClassName="app-subtle-text"
                />
                <div className="app-button-row">
                  <AppButton variant="primary">Save</AppButton>
                  <AppButton className="ui-ref-legacy-ordinary">Edit</AppButton>
                  <AppButton className="ui-ref-legacy-danger">Cancel Registration</AppButton>
                  <AppButton disabled>Save</AppButton>
                  <AppLinkButton href="#tables" className="ui-ref-legacy-ordinary">
                    View in Parking
                  </AppLinkButton>
                </div>
              </div>

              <div>
                <PageHeader
                  title="Considered alternative (not adopted) -- Minimal Adjustment"
                  headingLevel="h3"
                  titleStyle={{ fontSize: "var(--font-size-body)" }}
                  description="The smaller change that was on the table: fix navigation/handoff and green-for-status only, leave ordinary/destructive as they were (reproduced here with the same legacy classes as above, since the real global classes moved past this option to System 3 instead)."
                  descriptionClassName="app-subtle-text"
                />
                <div className="app-button-row">
                  <AppButton variant="primary">Save</AppButton>
                  <AppButton className="ui-ref-legacy-ordinary">Edit</AppButton>
                  <AppButton className="ui-ref-legacy-danger">Cancel Registration</AppButton>
                  <AppButton disabled>Save</AppButton>
                  <AppLinkButton href="#tables">View in Parking →</AppLinkButton>
                </div>
              </div>

              <div>
                <PageHeader
                  title="✅ Approved / Canonical -- System 3 (Restructured Hierarchy)"
                  headingLevel="h3"
                  titleStyle={{ fontSize: "var(--font-size-body)" }}
                  description="The real AppButton/AppLinkButton/ConfirmDialog, unmodified below -- no prototype className anywhere in this example. Ordinary drops its box (ghost), destructive stays outlined until the moment it's actually confirmed (try Cancel Registration -- ConfirmDialog's own Confirm button is the one place a solid destructive fill belongs), and navigation/handoff reads as a link natively."
                  descriptionClassName="app-subtle-text"
                />
                <div className="app-button-row">
                  <AppButton variant="primary">Save</AppButton>
                  <AppButton>Edit</AppButton>
                  <AppButton variant="danger" onClick={() => setSystem3ConfirmOpen(true)}>
                    Cancel Registration
                  </AppButton>
                  <AppButton disabled>Save</AppButton>
                  <AppLinkButton href="#tables">View in Parking →</AppLinkButton>
                </div>
                <ConfirmDialog
                  open={system3ConfirmOpen}
                  title="Cancel this registration?"
                  message="Reference-page demo only -- confirming here does not change any real data. This is the one moment the approved hierarchy uses a solid destructive fill (variant=&quot;stop&quot;, inside ConfirmDialog itself)."
                  confirmLabel="Cancel Registration"
                  cancelLabel="Keep Registration"
                  danger
                  onConfirm={() => setSystem3ConfirmOpen(false)}
                  onCancel={() => setSystem3ConfirmOpen(false)}
                />
              </div>

              <div>
                <PageHeader
                  title="Should green mean status only?"
                  headingLevel="h3"
                  titleStyle={{ fontSize: "var(--font-size-body)" }}
                  description="The same 'this is done' meaning, rendered two ways. The right-hand rule is now the approved guidance for NEW buttons -- existing success/start action-button call sites were not mass-migrated in this pass (see closeout)."
                  descriptionClassName="app-subtle-text"
                />
                <div className="ui-ref-compare-grid">
                  <div className="ui-ref-compare-card">
                    <strong>Legacy pattern -- green used twice</strong>
                    <div className="app-button-row">
                      <AppButton variant="success">Complete</AppButton>
                      <StatusBadge tone="success">Complete</StatusBadge>
                    </div>
                    <p className="app-subtle-text" style={{ margin: 0 }}>
                      An action you take and a state that already happened, in the identical color. Still how
                      existing success/start call sites work today.
                    </p>
                  </div>
                  <div className="ui-ref-compare-card">
                    <strong>✅ Approved guidance -- green reserved for status</strong>
                    <div className="app-button-row">
                      <AppButton variant="primary">Complete</AppButton>
                      <StatusBadge tone="success">Complete</StatusBadge>
                    </div>
                    <p className="app-subtle-text" style={{ margin: 0 }}>
                      Click the blue button; the badge is the only thing that turns green.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </PageSection>

          {/* ---- PART B: TABLE ROW ACTIONS (LAYOUT STILL UNDECIDED) ---- */}
          <PageSection variant="section">
            <PageHeader
              title="Part B: Table Row Actions -- layout still undecided"
              headingLevel="h3"
              titleStyle={{ fontSize: "var(--font-size-card-title)" }}
              description="Same six sample records, including Casey's long name/email/note, in three row-action layouts. The buttons inside all three now use the real, approved AppButton/RowActions primitives (ghost ordinary, outlined destructive) -- but which of these three LAYOUTS becomes canonical is not decided here."
              descriptionClassName="app-subtle-text"
            />

            <div style={{ display: "grid", gap: "var(--space-6)" }}>
              <div>
                <PageHeader
                  title="Treatment 1 -- Prominent Primary, Quiet Secondary"
                  headingLevel="h3"
                  titleStyle={{ fontSize: "var(--font-size-body)" }}
                  description="One solid Contact per row; Edit recedes to ghost weight, Cancel stays outlined (present, not shouting) until it's actually needed."
                  descriptionClassName="app-subtle-text"
                />
                <RowActionsTreatmentProminent records={SAMPLE_RECORDS} />
              </div>

              <div>
                <PageHeader
                  title="Treatment 2 -- Compact Horizontal, Equal Weight"
                  headingLevel="h3"
                  titleStyle={{ fontSize: "var(--font-size-body)" }}
                  description="Reuses Section 6's Desktop/Pointer-Optimized Candidate directly (same component, not a copy) -- Edit/Contact/Cancel stay equal weight and on one row via nowrap actions."
                  descriptionClassName="app-subtle-text"
                />
                <DesktopPointerCandidate records={SAMPLE_RECORDS} />
              </div>

              <div>
                <PageHeader
                  title="Treatment 3 -- Primary Action + More Actions Disclosure"
                  headingLevel="h3"
                  titleStyle={{ fontSize: "var(--font-size-body)" }}
                  description="The same native-disclosure pattern Section 6's Touch-Optimized Candidate uses per card, shown here inside a table row instead -- compare the two to judge whether pointer and touch should share this pattern or diverge."
                  descriptionClassName="app-subtle-text"
                />
                <RowActionsTreatmentDisclosure records={SAMPLE_RECORDS} />
              </div>

              <div>
                <PageHeader
                  title="Operational handoff example -- View in Check-In / View in Parking / Edit"
                  headingLevel="h3"
                  titleStyle={{ fontSize: "var(--font-size-body)" }}
                  description="Handoffs (leave this record, go operate on it in another module) as text links; Edit (a same-page mutation) stays a ghost button -- the two kinds of action are never visually confused."
                  descriptionClassName="app-subtle-text"
                />
                <OperationalHandoffExample />
              </div>
            </div>
          </PageSection>

          <Alert tone="warning">
            <strong>Still undecided:</strong> which of Treatments 1-3 becomes the canonical table-row action layout.
            The action SEMANTICS used inside them (ghost ordinary, outlined destructive, solid primary) are now real
            and approved -- the LAYOUT arrangement is not. Treatment 3&rsquo;s disclosure pattern already exists in
            touch-card form (Section 6); whether pointer and touch should share one pattern or use different ones
            for the same underlying actions remains an open question this page raises rather than answers.
          </Alert>
        </div>
      </RefSection>

      {/* =================================================================
          16. BUTTON TACTILE TREATMENT (✅ APPROVED)
          ================================================================= */}
      <RefSection
        id="depth"
        title="Button Tactile Treatment (✅ approved -- canonical)"
        description="Subtle hover elevation and a pressed-state physical depression, promoted directly into .app-button/.app-button-primary/.app-button-danger/.app-button-stop -- every button in the app already has this; there is no separate opt-in class or a second treatment to compare against. Depth/interaction feel only, never a meaning change -- the approved System 3 action hierarchy below is completely unchanged."
      >
        <Alert tone="info">
          Hover (a real pointer device) and press/click any button below to feel it -- a static screenshot cannot
          show this. Hover elevation only applies on real pointer devices (
          <code className="ui-ref-code">hover: hover</code> + <code className="ui-ref-code">pointer: fine</code>, so
          touch never gets a &ldquo;stuck hover&rdquo;); press/compress works identically for mouse and touch via{" "}
          <code className="ui-ref-code">:active</code>. Motion respects{" "}
          <code className="ui-ref-code">prefers-reduced-motion</code>. Disabled always wins -- a disabled button
          never lifts or compresses.
        </Alert>

        <PageSection variant="section">
          <PageHeader
            title="Action hierarchy"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
          />
          <div style={{ display: "grid", gap: "var(--space-5)" }}>
            <DepthActionRow onCancelClick={() => setDepthConfirmOpen(true)} />
            <div>
              <div className="app-subtle-text" style={{ marginBottom: "var(--space-2)" }}>
                Destructive confirmation (ConfirmDialog&rsquo;s Confirm button) -- the most deliberate press-feedback
                of any variant, reserved for this one moment
              </div>
              <DepthStopExample />
            </div>
            <DepthTableRowActions records={SAMPLE_RECORDS} />
          </div>
        </PageSection>

        <ConfirmDialog
          open={depthConfirmOpen}
          title="Cancel this registration?"
          message="Reference-page demo only -- confirming here does not change any real data. This is the real, unmodified ConfirmDialog, which already carries this same tactile treatment on its own Confirm/Cancel buttons."
          confirmLabel="Cancel Registration"
          cancelLabel="Keep Registration"
          danger
          onConfirm={() => setDepthConfirmOpen(false)}
          onCancel={() => setDepthConfirmOpen(false)}
        />

        <p className="app-subtle-text" style={{ margin: 0 }}>
          Depth/interaction feel only -- no semantic meaning changed: Primary is still the one solid, most-elevated
          action; Ordinary is still the quietest of the four, unchanged at rest -- only its hover/press states gained
          depth; Destructive still shows zero shadow at rest and only gains depth on hover/press, never before;
          Destructive confirmation still only ever appears inside ConfirmDialog&rsquo;s Confirm step; Navigation/
          handoff stays a link, with none of this treatment applied at all.
        </p>
      </RefSection>

      {/* =================================================================
          17. DIALOG & OVERLAYS
          ================================================================= */}
      <RefSection
        id="overlays"
        title="Dialog & Overlays (✅ approved -- canonical foundation)"
        description="Dialog (components/ui/Dialog.tsx), generalized from PreferredMapChooser.tsx's already-proven pattern, and ConfirmDialog, now built on top of it. Both below are the real, production components."
      >
        <div className="ui-ref-compare-grid">
          <div className="ui-ref-compare-card">
            <strong>Dialog -- general purpose</strong>
            <AppButton variant="primary" onClick={() => setOverlayDialogOpen(true)}>
              Open Dialog
            </AppButton>
            <p className="app-subtle-text" style={{ margin: 0 }}>
              Correct dialog semantics, labeling, focus entry/containment/restoration, Escape, backdrop dismissal,
              and <code className="ui-ref-code">dialogLayerStack</code> integration -- centrally provided, not
              re-implemented per consumer.
            </p>
          </div>
          <div className="ui-ref-compare-card">
            <strong>ConfirmDialog -- specialized confirm/cancel</strong>
            <AppButton variant="danger" onClick={() => setConfirmOpen(true)}>
              Cancel Registration
            </AppButton>
            <p className="app-subtle-text" style={{ margin: 0 }}>
              Same demo trigger already used in{" "}
              <a href="#buttons" className="app-button">
                Buttons
              </a>
              . Now consumes <code className="ui-ref-code">Dialog</code> for every mechanic above; only the
              danger/busy decision logic remains its own.
            </p>
          </div>
        </div>

        <Dialog
          open={overlayDialogOpen}
          onClose={() => setOverlayDialogOpen(false)}
          title="Reference Dialog"
          description="This is a reference-page demo only -- it does not change any real data. Tab cycles within it, Escape or the backdrop closes it, and focus returns to the Open Dialog button on close."
          footer={
            <>
              <AppButton onClick={() => setOverlayDialogOpen(false)}>Cancel</AppButton>
              <AppButton variant="primary" onClick={() => setOverlayDialogOpen(false)}>
                Confirm
              </AppButton>
            </>
          }
        />

        <p className="app-subtle-text" style={{ margin: 0 }}>
          Interactive behavior (focus trap, Escape, portal mounting, stacking) is exercised live above and by real
          finger/keyboard on a physical device -- it cannot be captured by a static rendering test the way the rest
          of this page&rsquo;s markup contract can (see <code className="ui-ref-code">Dialog.tsx</code>&rsquo;s own
          doc comment for why). Try it here: open it, press Tab repeatedly (focus should never leave the dialog),
          press Escape, and confirm focus returns to the button that opened it.
        </p>
      </RefSection>

      {/* =================================================================
          18. MAP MARKER STANDARD
          ================================================================= */}
      <RefSection
        id="map-markers"
        title="Map Marker Standard (✅ approved -- canonical foundation)"
        description={
          <>
            <code className="ui-ref-code">MarkerDot</code> and{" "}
            <code className="ui-ref-code">MarkerLabelChip</code> (
            <code className="ui-ref-code">components/map/canvas/markerVisuals.tsx</code>), plus the density-aware
            sizing in <code className="ui-ref-code">components/map/canvas/markerSizing.ts</code> -- the same real,
            unmodified primitives and functions every migrated map page calls, not a reference-only reimplementation.
          </>
        }
      >
        <p style={{ margin: 0, fontSize: "var(--font-size-body)", lineHeight: "var(--line-height-relaxed)" }}>
          Every map-canvas consumer used to hand-roll its own marker dot and label chip independently (sizes from
          14px to 60px, inconsistent fonts/padding, no shared colors) with no awareness of how densely a given map's
          real markers are actually packed. A marker&rsquo;s size lives in the same coordinate space as the map
          image, so a fixed screen-px marker size is not merely wrong on a narrow viewport -- it is wrong at every
          zoom level, on every device, because the ratio between marker size and real site spacing never changes
          with scale. This is now a governed, canonical piece of the Central UI Standard: two separate contracts,
          each with exactly one implementation.
        </p>

        <div className="ui-ref-compare-grid">
          <div className="ui-ref-compare-card">
            <strong>Visual geometry</strong>
            <p className="app-subtle-text" style={{ margin: 0 }}>
              What the marker looks like: visible size, shape, color/tone, label treatment, selected state,
              density-aware sizing, and zoom/content-scale behavior. Governed centrally --{" "}
              <code className="ui-ref-code">MarkerDot</code>/<code className="ui-ref-code">MarkerLabelChip</code>{" "}
              decide the pixels.
            </p>
          </div>
          <div className="ui-ref-compare-card">
            <strong>Interaction geometry</strong>
            <p className="app-subtle-text" style={{ margin: 0 }}>
              How the marker is interacted with: touch/pointer hit area, tap reliability, focus/keyboard behavior,
              gesture arbitration, tap-vs-drag. Untouched by this standard --{" "}
              <code className="ui-ref-code">MarkerLayer.tsx</code> and{" "}
              <code className="ui-ref-code">GestureMapViewportV2.tsx</code> own it exactly as before. A visually
              small marker must never require a correspondingly small touch target -- see the hit-area example
              below.
            </p>
          </div>
        </div>

        <h3 style={{ margin: 0, fontSize: "var(--font-size-body)" }}>Standard dot &amp; selected state</h3>
        <div className="ui-ref-compare-grid">
          <div className="ui-ref-compare-card" style={{ alignItems: "center", textAlign: "center" }}>
            <MarkerDot size={22} tone="info" title="Standard marker" />
            <span className="app-subtle-text">Standard (unselected)</span>
          </div>
          <div className="ui-ref-compare-card" style={{ alignItems: "center", textAlign: "center" }}>
            <MarkerDot size={22} tone="info" emphasis="selected" title="Selected marker" />
            <span className="app-subtle-text">Selected -- gold ring + pulse, the same accepted treatment Parking
              uses on real hardware</span>
          </div>
          <div className="ui-ref-compare-card" style={{ alignItems: "center", textAlign: "center" }}>
            <MarkerDot size={22} tone="success" title="Restroom" />
            <MarkerLabelChip text="Restroom" />
            <span className="app-subtle-text">Dot + label chip together, the Locations pattern</span>
          </div>
        </div>

        <h3 style={{ margin: 0, fontSize: "var(--font-size-body)" }}>Semantic tone vocabulary</h3>
        <p className="app-subtle-text" style={{ margin: 0 }}>
          Colors resolve through the same <code className="ui-ref-code">StatusBadgeTone</code> vocabulary as{" "}
          <a href="#status" className="app-button">
            Status &amp; Semantic Treatments
          </a>{" "}
          -- a marker&rsquo;s <code className="ui-ref-code">danger</code> is the same red as a{" "}
          <code className="ui-ref-code">StatusBadge</code> danger anywhere else in the app. This is the preferred
          path for any new marker semantics.
        </p>
        <div className="ui-ref-swatch-grid">
          {(["neutral", "info", "warning", "danger", "success"] as const).map((tone) => (
            <div key={tone} className="ui-ref-swatch" style={{ display: "grid", placeItems: "center", padding: "var(--space-4)", gap: "var(--space-2)" }}>
              <MarkerDot size={22} tone={tone} title={tone} />
              <code className="ui-ref-code">{tone}</code>
            </div>
          ))}
          <div className="ui-ref-swatch" style={{ display: "grid", placeItems: "center", padding: "var(--space-4)", gap: "var(--space-2)" }}>
            <MarkerDot size={22} color="gold" title="Escape hatch" />
            <code className="ui-ref-code">color=&quot;gold&quot;</code>
          </div>
        </div>
        <p className="app-subtle-text" style={{ margin: 0 }}>
          The last swatch is the <code className="ui-ref-code">color</code> escape hatch -- an exact value that wins
          over <code className="ui-ref-code">tone</code>, kept for genuinely specialized cases (Parking and
          Locations both currently use it for their existing accepted &ldquo;selected&rdquo; gold swap, preserved
          exactly rather than silently changed by this migration). New marker semantics should reach for a canonical
          tone first; the escape hatch is not the default path.
        </p>

        <h3 style={{ margin: 0, fontSize: "var(--font-size-body)" }}>Density-aware sizing</h3>
        <p className="app-subtle-text" style={{ margin: 0 }}>
          Marker size derives from each map&rsquo;s own real nearest-neighbor site spacing, clamped to a legible
          floor and a readability ceiling -- dense maps get smaller visible markers, sparse maps may get larger
          ones, computed live below by the real, unmodified <code className="ui-ref-code">
          computeNearestNeighborSpacingPx</code>/<code className="ui-ref-code">resolveDensityAwareMarkerSize</code>{" "}
          against synthetic (not production) coordinates.
        </p>
        <div className="ui-ref-compare-grid">
          {MARKER_DENSITY_DEMOS.map((demo) => {
            const spacing = computeNearestNeighborSpacingPx(demo.points, MARKER_DEMO_NATURAL);
            const size = resolveDensityAwareMarkerSize(spacing, { isNarrow: false });
            return (
              <div key={demo.key} className="ui-ref-compare-card">
                <strong>{demo.label}</strong>
                <div
                  style={{
                    position: "relative",
                    width: MARKER_DEMO_NATURAL.width,
                    height: MARKER_DEMO_NATURAL.height,
                    maxWidth: "100%",
                    background: "var(--color-bg-muted)",
                    border: "var(--border-width-default) solid var(--color-border-default)",
                    borderRadius: "var(--radius-medium)",
                  }}
                >
                  {demo.points.map((p, i) => (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left: `${p.xPct}%`,
                        top: `${p.yPct}%`,
                        transform: "translate(-50%, -50%)",
                      }}
                    >
                      <MarkerDot size={size} tone="info" />
                    </div>
                  ))}
                </div>
                <p className="app-subtle-text" style={{ margin: 0 }}>
                  {demo.description} Resolved size: <strong>{size.toFixed(1)}px</strong> (native).
                </p>
              </div>
            );
          })}
        </div>

        <h3 style={{ margin: 0, fontSize: "var(--font-size-body)" }}>Visible marker vs. interaction target</h3>
        <div className="ui-ref-compare-card" style={{ alignItems: "center", textAlign: "center", maxWidth: 320 }}>
          <div style={{ position: "relative", display: "inline-block" }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                border: "2px dashed var(--color-border-strong)",
                borderRadius: 8,
                pointerEvents: "none",
              }}
            />
            <MarkerDot size={8} tone="info" hitAreaSize={MARKER_MIN_HIT_AREA_PX} title="Dense-map marker" />
          </div>
          <p className="app-subtle-text" style={{ margin: 0 }}>
            The visible dot above is 8px -- the same size a Saint-George-dense map resolves to. The dashed box is
            the real, unmodified <code className="ui-ref-code">MARKER_MIN_HIT_AREA_PX</code> ({MARKER_MIN_HIT_AREA_PX}
            px) invisible hit area <code className="ui-ref-code">MarkerDot</code> always renders around it --
            shrinking a marker for legibility on a dense map never shrinks its tap target below a comfortable
            minimum.
          </p>
        </div>

        <p className="app-subtle-text" style={{ margin: 0 }}>
          <strong>Canonical adoption:</strong> migrated onto this standard --{" "}
          <a href="/admin/parking" className="app-button">
            Parking
          </a>
          , <a href="/admin/locations" className="app-button">
            Admin Locations
          </a>
          , and the public Locations page. Coach Map public (its own real-time occupied/viewer-assigned semantics)
          and the Master Maps authoring tool (an editing workspace with marquee-select and delete, not a display
          page) are deliberately not migrated yet -- a separate, future adoption, not an oversight.
        </p>
        <p className="app-subtle-text" style={{ margin: 0 }}>
          <strong>Central control:</strong> future map-canvas consumers must not independently redefine marker
          diameter, shape, selected treatment, label-chip styling, or semantic colors. A page provides its own
          business state (assigned/arrived, occupied/vacant, category); the shared marker visual system in{" "}
          <code className="ui-ref-code">components/map/canvas/</code> decides how that state renders. This governs
          marker <em>presentation</em> only -- map pan/zoom/drag gesture mechanics remain fully specialized per{" "}
          <code className="ui-ref-code">EPICENTRAX_CENTRAL_UI_STANDARD_BLUEPRINT.md</code> §12.
        </p>
      </RefSection>

      {/* =================================================================
          19. INLINE EDIT
          ================================================================= */}
      <RefSection
        id="inline-edit"
        title="Inline Edit (✅ approved -- production-proven)"
        description={
          <>
            <code className="ui-ref-code">components/ui/InlineEdit.tsx</code> -- the real, shared primitive for
            editing a SIMPLE atomic value in place: tap/click the value, edit it, Enter or the visible Save
            button commits, Escape or the visible Cancel button discards. Visually/behaviorally approved (real
            iPhone and desktop) and already in production on{" "}
            <code className="ui-ref-code">/admin/nearby-settings</code> (global category-name rename, Platform/
            Super Admin only) -- see the Central UI Standard blueprint Part 18 for the full adoption record.
          </>
        }
      >
        <p style={{ margin: 0, fontSize: "var(--font-size-body)", lineHeight: "var(--line-height-relaxed)" }}>
          <strong>Use InlineEdit for:</strong> simple atomic values where the surrounding context should stay
          visible -- category names, short labels, display names, short titles, simple numeric/order values.{" "}
          <strong>Use a Dialog/form for:</strong> multi-field or consequential edits, anything destructive, or
          anything needing a confirmation step.
        </p>

        <ul
          className="app-subtle-text"
          style={{ margin: 0, paddingLeft: "1.1em", display: "grid", gap: "var(--space-1)" }}
        >
          <li>Tap/click the value → enter edit mode</li>
          <li>Enter, or the visible Save button → Save</li>
          <li>Escape, or the visible Cancel button → Cancel</li>
          <li>Blur / clicking outside the value → no implicit save, ever</li>
        </ul>

        <h3 style={{ margin: 0, fontSize: "var(--font-size-body)" }}>1. Basic text edit</h3>
        <InlineEdit
          label="Category name"
          value={demoGroceryCategory}
          onSave={(next) => setDemoGroceryCategory(next)}
        />

        <h3 style={{ margin: 0, fontSize: "var(--font-size-body)" }}>2. Another realistic value, async save</h3>
        <InlineEdit label="Department label" value={demoDepartmentLabel} onSave={saveDepartmentLabelAsync} />
        <p className="app-subtle-text" style={{ margin: 0 }}>
          Saves after a real ~700ms delay -- watch the Save button&rsquo;s loading state.
        </p>

        <h3 style={{ margin: 0, fontSize: "var(--font-size-body)" }}>3. Validation</h3>
        <InlineEdit
          label="Meal category"
          value={demoMealCategory}
          onSave={(next) => setDemoMealCategory(next)}
          validate={(draft) => (draft.trim() ? undefined : "This field can't be empty.")}
        />
        <p className="app-subtle-text" style={{ margin: 0 }}>
          Required. Clear the value and press Save/Enter to see the validation error -- Save is blocked and the
          draft is kept.
        </p>

        <h3 style={{ margin: 0, fontSize: "var(--font-size-body)" }}>4. Async failure / retry</h3>
        <InlineEdit label="Storage room label" value={demoStorageLabel} onSave={saveStorageLabelAlwaysFails} />
        <p className="app-subtle-text" style={{ margin: 0 }}>
          This one always rejects (~500ms delay) -- Save, watch it fail, and confirm the draft and edit mode are
          both preserved so you can retry or Cancel.
        </p>

        <h3 style={{ margin: 0, fontSize: "var(--font-size-body)" }}>5. Disabled / read-only</h3>
        <InlineEdit label="Locked category name" value="Archived Events" onSave={() => {}} disabled />
      </RefSection>

      {/* =================================================================
          20. FORM ACTIONS
          ================================================================= */}
      <RefSection
        id="form-actions"
        title="Form Actions (✅ approved)"
        description={
          <>
            <code className="ui-ref-code">components/ui/FormActions.tsx</code> -- the canonical name for the
            Save/Cancel (or similar) grouping most forms already hand-write inline as{" "}
            <code className="ui-ref-code">&lt;div className=&quot;app-button-row&quot;&gt;</code>. Same layout,
            same class, now with a documented name -- it owns no button logic of its own, so callers still choose
            which <code className="ui-ref-code">AppButton</code> variants belong here and in what order.
          </>
        }
      >
        <PageSection variant="section">
          <PageHeader
            title="Ordinary form -- Cancel, then Save"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
          />
          <FormActions>
            <AppButton>Cancel</AppButton>
            <AppButton variant="primary">Save</AppButton>
          </FormActions>
        </PageSection>

        <PageSection variant="section">
          <PageHeader
            title="A destructive form -- Cancel, then a quiet destructive initiation"
            headingLevel="h3"
            titleStyle={{ fontSize: "var(--font-size-card-title)" }}
            description="The destructive action itself still stays outlined/quiet here (System 3) -- FormActions only groups the row; it never changes what each button means."
            descriptionClassName="app-subtle-text"
          />
          <FormActions>
            <AppButton>Cancel</AppButton>
            <AppButton variant="danger">Delete Draft</AppButton>
          </FormActions>
        </PageSection>

        <p className="app-subtle-text" style={{ margin: 0 }}>
          Wraps at narrow widths (the same <code className="ui-ref-code">.app-button-row</code> flex-wrap every
          existing consumer already relies on) -- try this section at 320/390px.
        </p>
      </RefSection>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Shared table/list renderer for Section 6's three examples -- one render
// path, two layouts, mirroring the pattern established by Attendees/Vendors/
// Vendor Requests.
// ----------------------------------------------------------------------------

function sampleRowActions(record: SampleRecord, rowActionsClassName?: string) {
  return (
    <RowActions className={rowActionsClassName}>
      <AppButton aria-label={`Edit ${record.name}`}>Edit</AppButton>
      <AppButton variant="primary" aria-label={`Contact ${record.name}`}>
        Contact
      </AppButton>
      {record.status !== "cancelled" ? (
        <AppButton variant="danger" aria-label={`Cancel ${record.name}'s request`}>
          Cancel
        </AppButton>
      ) : null}
    </RowActions>
  );
}

function SampleRoster({
  records,
  showNotes,
  asList,
}: {
  records: SampleRecord[];
  showNotes: boolean;
  asList: boolean;
}) {
  if (records.length === 0) {
    return <Alert tone="neutral">No sample records match the current search or filters.</Alert>;
  }

  if (asList) {
    return (
      <ResponsiveList>
        {records.map((r) => (
          <li key={r.id} className="responsive-list-item">
            <div className="responsive-list-item-header">
              <div className="responsive-list-item-title">{r.name}</div>
              <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
            </div>
            <div className="responsive-list-item-badges">
              <span style={sampleCategoryBadgeStyle(r.category)}>{CATEGORY_LABEL[r.category]}</span>
            </div>
            <div className="responsive-list-item-meta">
              <span>{r.email || "No email on file"}</span>
              <span>{r.phone || "No phone on file"}</span>
              <span>Site: {r.site || "Unassigned"}</span>
            </div>
            {showNotes && r.detail ? <div className="data-table-cell-meta">{r.detail}</div> : null}
            {sampleRowActions(r)}
          </li>
        ))}
      </ResponsiveList>
    );
  }

  return (
    <DataTable caption="Sample records">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Category</th>
          <th scope="col">Status</th>
          <th scope="col">Site</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={r.id}>
            <td>
              <div className="data-table-cell-primary">{r.name}</div>
              <div className="data-table-cell-meta">
                {[r.email || "No email on file", r.phone || "No phone on file"].join(" · ")}
                {showNotes && r.detail ? ` · ${r.detail}` : ""}
              </div>
            </td>
            <td>
              <span style={sampleCategoryBadgeStyle(r.category)}>{CATEGORY_LABEL[r.category]}</span>
            </td>
            <td>
              <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
            </td>
            <td>{r.site || "Unassigned"}</td>
            <td>{sampleRowActions(r)}</td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

// ----------------------------------------------------------------------------
// Table & Action Treatment Comparison (design workbench, no winner declared).
// Two candidate layouts below are REFERENCE-ONLY PROTOTYPES -- they reuse
// DataTable/ResponsiveList/RowActions/AppButton/StatusBadge exactly as
// shipped, extended only through those components' own className/style
// extension points (never by editing components/ui/* itself). Anything that
// needed a genuinely new visual treatment (note clamping, a wider touch
// target, nowrap actions) is a small, clearly-named `.ui-ref-*` class --
// see the callouts in the comparison section for what is and isn't a real
// shared primitive today.
// ----------------------------------------------------------------------------

/**
 * Candidate 2: Desktop / pointer-optimized. Fewer columns (category and
 * site fold into the record cell as secondary information, same fields as
 * the baseline -- nothing removed), notes clamp to two lines instead of
 * running the row tall (full text stays in the DOM for assistive tech and
 * find-in-page), and actions stay on one row via a nowrap RowActions
 * (falls back to the table's own horizontal scroll rather than wrapping
 * into a stack) since a pointer/mouse user has room to reach across a row.
 */
function DesktopPointerCandidate({ records }: { records: SampleRecord[] }) {
  return (
    <DataTable caption="Desktop/pointer-optimized candidate (reference-only prototype layout)">
      <thead>
        <tr>
          <th scope="col">Record</th>
          <th scope="col">Status</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={r.id}>
            <td>
              <div className="data-table-cell-primary">
                {r.name}
                <span style={sampleCategoryBadgeStyle(r.category)}>{CATEGORY_LABEL[r.category]}</span>
              </div>
              <div className="data-table-cell-meta">
                {[r.email || "No email on file", r.phone || "No phone on file", r.site ? `Site ${r.site}` : "Unassigned site"].join(
                  " · ",
                )}
              </div>
              {r.detail ? <div className="data-table-cell-meta ui-ref-notes-clamp">{r.detail}</div> : null}
            </td>
            <td>
              <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
            </td>
            <td>{sampleRowActions(r, "ui-ref-actions-nowrap")}</td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

/**
 * Candidate 3: Touch-optimized. Not "the desktop table, shrunk" -- a card
 * per record (like ResponsiveList) with exactly one always-visible primary
 * action sized well past the 42px touch-target-min token, and the routine
 * secondary actions (Edit/Cancel) behind a native <details>/<summary>
 * disclosure -- the same accessible, no-JS-state, keyboard-and-
 * screen-reader-friendly pattern TableToolbarDisclosure already uses, just
 * applied per row instead of per toolbar. The "More actions" trigger is
 * always visible text, never a hover state or a swipe gesture -- there is
 * no capability here that isn't also reachable by tap or by keyboard.
 */
function TouchOptimizedCandidate({ records }: { records: SampleRecord[] }) {
  return (
    <ResponsiveList>
      {records.map((r) => (
        <li key={r.id} className="responsive-list-item">
          <div className="responsive-list-item-header">
            <div className="responsive-list-item-title">{r.name}</div>
            <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
          </div>
          <div className="responsive-list-item-badges">
            <span style={sampleCategoryBadgeStyle(r.category)}>{CATEGORY_LABEL[r.category]}</span>
          </div>
          <div className="responsive-list-item-meta">
            <span>{r.email || "No email on file"}</span>
            <span>{r.phone || "No phone on file"}</span>
            <span>Site: {r.site || "Unassigned"}</span>
          </div>
          {r.detail ? <div className="data-table-cell-meta ui-ref-notes-clamp">{r.detail}</div> : null}

          <AppButton variant="primary" className="ui-ref-touch-primary" aria-label={`Contact ${r.name}`}>
            Contact
          </AppButton>

          <details className="ui-ref-touch-more">
            <summary className="table-toolbar-disclosure-summary">More actions</summary>
            <RowActions className="ui-ref-touch-more-actions">
              <AppButton aria-label={`Edit ${r.name}`}>Edit</AppButton>
              {r.status !== "cancelled" ? (
                <AppButton variant="danger" aria-label={`Cancel ${r.name}'s request`}>
                  Cancel
                </AppButton>
              ) : null}
            </RowActions>
          </details>
        </li>
      ))}
    </ResponsiveList>
  );
}

// ----------------------------------------------------------------------------
// Mid-Size UI Scale prototype (Section 14). One representative-example
// panel, rendered inside a scale-scoping wrapper class (.ui-ref-scale-current
// / .ui-ref-scale-mid) so the SAME markup demonstrates both states -- the
// scoping class shadows a handful of CSS custom properties (font-size-*,
// touch-target-min) for its own subtree only; :root and every production
// page are untouched. See app/globals.css for the exact values.
// ----------------------------------------------------------------------------

function ScaleExamplePanel() {
  const nameFieldId = useId();
  const statusFieldId = useId();

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      <div>
        <div className="app-subtle-text" style={{ marginBottom: "var(--space-2)" }}>
          Page title (.shell-page-title)
        </div>
        <span className="shell-page-title" style={{ display: "block" }}>
          Admin UI Reference
        </span>
      </div>

      <div>
        <div className="app-subtle-text" style={{ marginBottom: "var(--space-2)" }}>
          Section title (.app-section-title)
        </div>
        <span className="app-section-title" style={{ display: "block", margin: 0 }}>
          Vendor Dispatch Lists
        </span>
      </div>

      <div>
        <div className="app-subtle-text" style={{ marginBottom: "var(--space-2)" }}>
          Body text
        </div>
        <p style={{ margin: 0, fontSize: "var(--font-size-body)", lineHeight: "var(--line-height-normal)" }}>
          A vendor service request links a member&rsquo;s ask to a specific vendor and site.
        </p>
      </div>

      <div>
        <div className="app-subtle-text" style={{ marginBottom: "var(--space-2)" }}>
          Sidebar nav sample (illustrative only -- not the live nav)
        </div>
        <div
          className="shell-nav"
          style={{
            maxWidth: 220,
            border: "var(--border-width-default) solid var(--color-border-default)",
            borderRadius: "var(--radius-medium)",
            padding: "var(--space-3)",
          }}
        >
          <div className="shell-nav-section">
            <div className="shell-nav-section-title">Operations</div>
            <div className="shell-nav-list">
              <span className="shell-nav-item shell-nav-item-active">Attendees Management</span>
              <span className="shell-nav-item">Vendor Management</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="app-subtle-text" style={{ marginBottom: "var(--space-2)" }}>
          Button row
        </div>
        <div className="app-button-row">
          <AppButton variant="primary">Save</AppButton>
          <AppButton>Cancel</AppButton>
          <AppButton variant="danger">Cancel Registration</AppButton>
        </div>
      </div>

      <div>
        <div className="app-subtle-text" style={{ marginBottom: "var(--space-2)" }}>
          Form controls
        </div>
        <div className="app-form-grid-2">
          <div>
            <label className="table-toolbar-label" htmlFor={nameFieldId}>
              Business name
            </label>
            <input id={nameFieldId} className="app-form-input" placeholder="Business name" />
          </div>
          <div>
            <label className="table-toolbar-label" htmlFor={statusFieldId}>
              Status
            </label>
            <select id={statusFieldId} className="app-form-input" defaultValue="pending">
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div>
        <div className="app-subtle-text" style={{ marginBottom: "var(--space-2)" }}>
          DataTable row
        </div>
        <DataTable caption="Scale example rows">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_RECORDS.slice(0, 2).map((r) => (
              <tr key={r.id}>
                <td>
                  <div className="data-table-cell-primary">{r.name}</div>
                  <div className="data-table-cell-meta">{r.email || "No email on file"}</div>
                </td>
                <td>
                  <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>

      <div>
        <div className="app-subtle-text" style={{ marginBottom: "var(--space-2)" }}>
          Status &amp; category badges
        </div>
        <div className="app-button-row">
          <StatusBadge tone="warning">Pending</StatusBadge>
          <StatusBadge tone="success">Complete</StatusBadge>
          <span style={sampleCategoryBadgeStyle("vendor")}>{CATEGORY_LABEL.vendor}</span>
        </div>
        <div className="app-subtle-text" style={{ marginTop: "var(--space-2)" }}>
          The category badge (right) does not scale -- it is hardcoded pixel text (see Section 7), the same gap
          this prototype otherwise leaves untouched.
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Table Row Actions treatments (Section 15, Part B). Each renders the real,
// now-canonical DataTable/RowActions/AppButton/AppLinkButton/StatusBadge
// primitives with no className overrides at all -- the ghost ordinary,
// outlined destructive, and link-style navigation treatments are native to
// AppButton/AppLinkButton as of the System 3 approval (app/globals.css's
// STANDARD APP BUTTON SYSTEM block). Only which of these three LAYOUTS is
// canonical remains undecided (Part E).
// ----------------------------------------------------------------------------

/**
 * Treatment 1: one visually prominent primary action (solid Contact),
 * quieter secondary actions (ghost Edit, outlined Cancel) that stay
 * available without competing with it.
 */
function RowActionsTreatmentProminent({ records }: { records: SampleRecord[] }) {
  return (
    <DataTable caption="Row actions: prominent primary, quiet secondary">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Status</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={r.id}>
            <td>
              <div className="data-table-cell-primary">{r.name}</div>
              <div className="data-table-cell-meta">{r.email || "No email on file"}</div>
            </td>
            <td>
              <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
            </td>
            <td>
              <RowActions>
                <AppButton variant="primary" aria-label={`Contact ${r.name}`}>
                  Contact
                </AppButton>
                <AppButton aria-label={`Edit ${r.name}`}>Edit</AppButton>
                {r.status !== "cancelled" ? (
                  <AppButton variant="danger" aria-label={`Cancel ${r.name}'s request`}>
                    Cancel
                  </AppButton>
                ) : null}
              </RowActions>
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

/**
 * Treatment 3: the same "one visible primary action, everything else
 * behind a native, always-visible disclosure" pattern Section 6's
 * TouchOptimizedCandidate already uses per row-card -- shown here inside
 * a DataTable row instead, to compare how the same semantics read on a
 * pointer-oriented desktop layout versus a touch-oriented card.
 */
function RowActionsTreatmentDisclosure({ records }: { records: SampleRecord[] }) {
  return (
    <DataTable caption="Row actions: primary action plus a More actions disclosure">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Status</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={r.id}>
            <td>
              <div className="data-table-cell-primary">{r.name}</div>
              <div className="data-table-cell-meta">{r.email || "No email on file"}</div>
            </td>
            <td>
              <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
            </td>
            <td>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
                <AppButton variant="primary" aria-label={`Contact ${r.name}`}>
                  Contact
                </AppButton>
                <details className="ui-ref-touch-more">
                  <summary className="table-toolbar-disclosure-summary">More actions</summary>
                  <RowActions className="ui-ref-touch-more-actions">
                    <AppButton aria-label={`Edit ${r.name}`}>Edit</AppButton>
                    {r.status !== "cancelled" ? (
                      <AppButton variant="danger" aria-label={`Cancel ${r.name}'s request`}>
                        Cancel
                      </AppButton>
                    ) : null}
                  </RowActions>
                </details>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

/**
 * A single representative row demonstrating navigation/handoff actions
 * (View in Check-In, View in Parking -- leave this record, go operate on
 * it elsewhere) rendered distinctly from a same-page mutation (Edit).
 * AppLinkButton's default link-style treatment carries this natively --
 * no override needed.
 */
function OperationalHandoffExample() {
  const record = SAMPLE_RECORDS[0];

  return (
    <DataTable caption="Navigation/handoff vs. mutation actions">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Status</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <div className="data-table-cell-primary">{record.name}</div>
            <div className="data-table-cell-meta">Site {record.site}</div>
          </td>
          <td>
            <StatusBadge tone={STATUS_TONE[record.status]}>{STATUS_LABEL[record.status]}</StatusBadge>
          </td>
          <td>
            <RowActions>
              <AppLinkButton href="#tables" aria-label={`View ${record.name} in Check-In`}>
                View in Check-In →
              </AppLinkButton>
              <AppLinkButton href="#tables" aria-label={`View ${record.name} in Parking`}>
                View in Parking →
              </AppLinkButton>
              <AppButton aria-label={`Edit ${record.name}`}>Edit</AppButton>
            </RowActions>
          </td>
        </tr>
      </tbody>
    </DataTable>
  );
}

// ----------------------------------------------------------------------------
// Button Tactile Treatment (Section 16). The hover-elevation/pressed-
// depression this section used to demonstrate as an opt-in `.ui-ref-3d-*`
// className comparison is now baked directly into .app-button/
// .app-button-primary/.app-button-danger/.app-button-stop themselves
// (Central UI Standard) -- every element below is the real, unmodified
// AppButton/AppLinkButton/DataTable/RowActions/StatusBadge with no
// reference-only class at all. Navigation/handoff never gains any depth
// treatment (a.app-button has none of the new rules).
// ----------------------------------------------------------------------------

/** Save (primary) / Edit (ordinary) / Cancel Registration (danger) / Save (disabled) / View in Parking (nav). */
function DepthActionRow({ onCancelClick }: { onCancelClick?: () => void }) {
  return (
    <div className="app-button-row">
      <AppButton variant="primary">Save</AppButton>
      <AppButton>Edit</AppButton>
      <AppButton variant="danger" onClick={onCancelClick}>
        Cancel Registration
      </AppButton>
      <AppButton disabled>Save</AppButton>
      <AppLinkButton href="#tables">View in Parking →</AppLinkButton>
    </div>
  );
}

/** The solid destructive-confirmation treatment, standalone (variant="stop"). */
function DepthStopExample() {
  return <AppButton variant="stop">Cancel Registration</AppButton>;
}

/** A representative table-row action set (Contact/Edit/Cancel). */
function DepthTableRowActions({ records }: { records: SampleRecord[] }) {
  return (
    <DataTable caption="Representative row actions">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Status</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={r.id}>
            <td>
              <div className="data-table-cell-primary">{r.name}</div>
              <div className="data-table-cell-meta">{r.email || "No email on file"}</div>
            </td>
            <td>
              <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
            </td>
            <td>
              <RowActions>
                <AppButton variant="primary" aria-label={`Contact ${r.name}`}>
                  Contact
                </AppButton>
                <AppButton aria-label={`Edit ${r.name}`}>Edit</AppButton>
                {r.status !== "cancelled" ? (
                  <AppButton variant="danger" aria-label={`Cancel ${r.name}'s request`}>
                    Cancel
                  </AppButton>
                ) : null}
              </RowActions>
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
