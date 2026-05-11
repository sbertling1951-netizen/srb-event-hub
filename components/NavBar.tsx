"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navGroups = [
  {
    title: "Main",
    items: [
      ["Home", "/"],
      ["Agenda", "/agenda"],
      ["Attendees", "/attendees"],
      ["Nearby", "/nearby"],
      ["Announcements", "/announcements"],
      ["Map", "/map"],
    ],
  },
  {
    title: "Admin",
    items: [
      ["Import CSV", "/admin/imports"],
      ["Parking Admin", "/admin/parking"],
    ],
  },
] satisfies Array<{
  title: string;
  items: Array<[string, string]>;
}>;

export default function NavBar() {
  const pathname = usePathname();
  const visibleNavGroups = navGroups.filter(
    (group) => group.title !== "Admin" || pathname?.startsWith("/admin"),
  );

  function isActiveHref(href: string) {
    return href === "/" ? pathname === "/" : pathname?.startsWith(href);
  }

  return (
    <nav>
      {visibleNavGroups.map((group) => (
        <div key={group.title}>
          <div className="nav-group-title">{group.title}</div>
          {group.items.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className={isActiveHref(href) ? "active" : ""}
            >
              {label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
