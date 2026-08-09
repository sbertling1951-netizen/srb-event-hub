import type { ShellNavSection } from "@/components/shell/types";

export type MemberNavInput = {
  /**
   * Tenant-derived label for the coach-map nav item -- the same
   * `getTenantLabel("map_nav_label")` value `components/layout/
   * Sidebar.tsx` already reads (as `mapNavLabel`). Passed in, not read
   * internally, so this stays a pure function over already-resolved
   * input rather than a second place that touches tenant labels.
   */
  mapNavLabel: string;
};

/**
 * Single canonical Member navigation model (§G, Stage 2B). Pure function
 * over already-resolved input -- performs no fetch, no storage access, no
 * authority resolution. Same labels, same hrefs, same ordering as
 * `components/layout/Sidebar.tsx`'s existing Member section.
 *
 * Consumed today by `MemberShellAdapter`. `Sidebar.tsx` cannot yet import
 * this: ADR-011 §18 forbids any change to that file without its own
 * separate authorization, so its equivalent array remains a literal,
 * currently-identical duplicate pending that future, separately
 * authorized work. If this model and Sidebar's own array ever diverge,
 * this file -- not Sidebar's -- is the one to trust and correct Sidebar
 * against.
 */
export function buildMemberNavSections(input: MemberNavInput): ShellNavSection[] {
  return [
    {
      id: "event",
      items: [
        { id: "home", label: "Dashboard", href: "/member" },
        { id: "agenda", label: "Agenda", href: "/member/agenda" },
        { id: "announcements", label: "Announcements", href: "/member/announcements" },
        { id: "photos", label: "Photos", href: "/member/photos" },
        { id: "evaluation", label: "Evaluation", href: "/member/evaluation" },
        { id: "attendees", label: "Attendee Locator", href: "/member/attendees" },
        { id: "coach-map", label: input.mapNavLabel, href: "/coach-map" },
        { id: "checkin", label: "My Check-In", href: "/member/checkin" },
        { id: "participants", label: "Participants", href: "/member/participants" },
        { id: "nearby", label: "Nearby", href: "/member/nearby" },
        { id: "vendor-signup", label: "Vendors / Service Requests", href: "/member/vendor-signup" },
      ],
    },
  ];
}
