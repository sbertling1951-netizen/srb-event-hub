"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Route } from "next";

type NavItem = {
  label: string;
  href: string;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const SIDEBAR_WIDTH = 260;

export default function Sidebar() {
  const pathname = usePathname() || "/";
  const [isMobile, setIsMobile] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleResize() {
      const mobile = window.innerWidth < 900;
      setIsMobile(mobile);
      setOpen(!mobile);
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function handleLogout() {
    // clear member identity
    localStorage.removeItem("fcoc-member-attendee-id");
    localStorage.removeItem("fcoc-member-email");
    localStorage.removeItem("fcoc-member-entry-id");

    // clear member session
    localStorage.removeItem("fcoc-member-event-context");
    localStorage.removeItem("fcoc-member-event-changed");

    // clear admin session
    localStorage.removeItem("fcoc-admin-event-context");
    localStorage.removeItem("fcoc-admin-event-changed");

    window.location.href = "/member/login";
  }

  const sections: NavSection[] = [
    {
      title: "Event",
      items: [
        { label: "Home", href: "/" },
        { label: "My Check-In", href: "/member/checkin" },
        { label: "Agenda", href: "/agenda" },
        { label: "Nearby", href: "/nearby" },
        { label: "Announcements", href: "/announcements" },
        { label: "Coach Map", href: "/coach-map" },
        { label: "Attendee Locator", href: "/attendees" },
      ],
    },
    {
      title: "Admin",
      items: [
        { label: "Dashboard", href: "/admin/dashboard" },
        { label: "Admin Announcements", href: "/admin/announcements" },
        { label: "Check-In", href: "/admin/checkin" },
        { label: "Parking Admin", href: "/admin/parking" },
        { label: "Events", href: "/admin/events" },
        { label: "Master Maps", href: "/admin/master-maps" },
        { label: "Nearby Admin", href: "/admin/nearby" },
        { label: "Attendee Import", href: "/admin/imports" },
        { label: "Agenda Admin", href: "/admin/agenda" },
        { label: "Agenda Import", href: "/admin/agenda/import" },
      ],
    },
  ];

  function isActiveRoute(itemHref: string) {
    return pathname === itemHref;
  }

  return (
    <>
      {/* Mobile toggle button */}
      {isMobile && (
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Open navigation"
          style={{
            position: "fixed",
            top: "calc(env(safe-area-inset-top, 0px) + 12px)",
            left: "calc(env(safe-area-inset-left, 0px) + 12px)",
            zIndex: 9999,
            padding: "10px 12px",
            background: "#0b5cff",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          }}
        >
          ☰
        </button>
      )}

      {/* Overlay */}
      {isMobile && open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            zIndex: 1090,
          }}
        />
      )}

      {/* Sidebar */}
      <aside
        style={{
          position: "fixed",
          top: 0,
          left: isMobile ? (open ? 0 : -SIDEBAR_WIDTH) : 0,
          width: SIDEBAR_WIDTH,
          height: "100vh",
          background: "#1f2937",
          color: "white",
          padding: 16,
          overflowY: "auto",
          transition: isMobile ? "left 0.25s ease" : "none",
          zIndex: 1100,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div>
          <h2 style={{ marginTop: 0, marginBottom: 18 }}>FCOC</h2>

          {sections.map((section) => (
            <div key={section.title} style={{ marginBottom: 20 }}>
              <div
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  opacity: 0.65,
                  marginBottom: 6,
                }}
              >
                {section.title}
              </div>

              {section.items.map((item) => {
                const active = isActiveRoute(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href as Route}
                    onClick={() => {
                      if (isMobile) setOpen(false);
                    }}
                    style={{
                      display: "block",
                      padding: "8px 10px",
                      marginBottom: 4,
                      borderRadius: 6,
                      textDecoration: "none",
                      color: active ? "#fff" : "#d1d5db",
                      background: active ? "#0b5cff" : "transparent",
                    }}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        {/* Logout */}
        <div style={{ marginTop: "auto", paddingTop: 16 }}>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #374151",
              background: "#111827",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Spacer for desktop */}
      {!isMobile && (
        <div
          style={{
            width: SIDEBAR_WIDTH,
            minWidth: SIDEBAR_WIDTH,
            flexShrink: 0,
          }}
        />
      )}
    </>
  );
}
