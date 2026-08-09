import type { ShellNavSection } from "@/components/shell/types";

/**
 * Vendor's own navigation model (§G: "Vendor may have its own role model
 * under the same ShellNav contract"). Static -- Vendor's item set carries
 * no permission gating, unlike Admin's. There is no legacy Vendor nav
 * array to deduplicate against; `VendorWorkspaceShell`'s former inline
 * `<Link>` list was fully replaced, not preserved as a parallel source,
 * when it became a `VendorShellAdapter` compatibility wrapper.
 */
export function buildVendorNavSections(): ShellNavSection[] {
  return [
    {
      id: "workspace",
      items: [
        { id: "home", label: "Vendor Home", href: "/vendor/workspace" },
        { id: "profile", label: "Edit Vendor Profile", href: "/vendor/workspace/profile" },
        { id: "contacts", label: "Contacts", href: "/vendor/workspace/contacts" },
        { id: "notices", label: "Notices", href: "/vendor/workspace/notices" },
        { id: "requests", label: "Requests", href: "/vendor/workspace/requests" },
        { id: "participation", label: "Event Participation", href: "/vendor/workspace/participation" },
      ],
    },
  ];
}
