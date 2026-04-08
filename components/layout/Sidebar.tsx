"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type NavItem = {
  label: string;
  href: string;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

type EventContext = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  location?: string | null;
  venue_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

const SIDEBAR_WIDTH = 260;
const MOBILE_BREAKPOINT = 900;

function formatDateRange(startDate?: string | null, endDate?: string | null) {
  if (!startDate && !endDate) return "";
  if (startDate && endDate) return `${startDate} – ${endDate}`;
  return startDate || endDate || "";
}

export default function Sidebar() {
  const pathname = usePathname();

  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(true);
  const [open, setOpen] = useState(false);
  const [memberEvent, setMemberEvent] = useState<EventContext | null>(null);
  const [adminEvent, setAdminEvent] = useState<EventContext | null>(null);
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [userMode, setUserMode] = useState<"member" | "admin" | "none">("none");
  const [isShortScreen, setIsShortScreen] = useState(false);

  const isAdminRoute = pathname.startsWith("/admin");
  const isMemberRoute =
    pathname.startsWith("/member") ||
    pathname.startsWith("/coach-map") ||
    pathname.startsWith("/agenda") ||
    pathname.startsWith("/announcements") ||
    pathname.startsWith("/attendees") ||
    pathname.startsWith("/nearby") ||
    pathname === "/";

  const isPreAuthPage =
    pathname === "/" ||
    pathname === "/member/login" ||
    pathname === "/admin/login";

  const effectiveUserMode = mounted
    ? userMode !== "none"
      ? userMode
      : !isPreAuthPage && isAdminRoute
        ? "admin"
        : !isPreAuthPage && isMemberRoute
          ? "member"
          : "none"
    : "none";

  const showLoggedInLogout = !isPreAuthPage && effectiveUserMode !== "none";

  useEffect(() => {
    setMounted(true);

    const media = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);

    function applyLayout(mobile: boolean) {
      setIsMobile(mobile);
      setOpen(!mobile);
      setIsShortScreen(window.innerHeight < 820);
    }

    applyLayout(media.matches);

    function handleChange(e: MediaQueryListEvent) {
      applyLayout(e.matches);
    }

    function handleWindowResize() {
      setIsShortScreen(window.innerHeight < 820);
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    }

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleChange);
    } else {
      media.addListener(handleChange);
    }

    window.addEventListener("resize", handleWindowResize);

    return () => {
      if (typeof media.removeEventListener === "function") {
        media.removeEventListener("change", handleChange);
      } else {
        media.removeListener(handleChange);
      }

      window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;

    function loadContexts() {
      try {
        const rawMemberEvent = localStorage.getItem(
          "fcoc-member-event-context",
        );
        const rawAdminEvent = localStorage.getItem("fcoc-admin-event-context");
        const rawHasArrived = localStorage.getItem("fcoc-member-has-arrived");
        const rawUserMode = localStorage.getItem("fcoc-user-mode");

        setMemberEvent(rawMemberEvent ? JSON.parse(rawMemberEvent) : null);
        setAdminEvent(rawAdminEvent ? JSON.parse(rawAdminEvent) : null);
        setIsCheckedIn(rawHasArrived === "true");
        setUserMode(
          rawUserMode === "member" || rawUserMode === "admin"
            ? rawUserMode
            : "none",
        );
      } catch (err) {
        console.error("Sidebar load error:", err);
        setMemberEvent(null);
        setAdminEvent(null);
        setIsCheckedIn(false);
        setUserMode("none");
      }
    }

    loadContexts();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-member-event-context" ||
        e.key === "fcoc-admin-event-context" ||
        e.key === "fcoc-member-has-arrived" ||
        e.key === "fcoc-member-event-changed" ||
        e.key === "fcoc-admin-event-changed" ||
        e.key === "fcoc-user-mode" ||
        e.key === "fcoc-user-mode-changed"
      ) {
        loadContexts();
      }
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener("popstate", loadContexts);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("popstate", loadContexts);
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;

    if (isMobile && open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobile, open, mounted]);

  async function handleSidebarExit() {
    if (showLoggedInLogout) {
      const eventName =
        memberEvent?.name ||
        memberEvent?.eventName ||
        adminEvent?.name ||
        adminEvent?.eventName ||
        "this event";

      const confirmed = window.confirm(
        `Do you want to logout of ${eventName}?`,
      );
      if (!confirmed) return;

      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.error("Supabase signOut failed:", err);
      }

      localStorage.clear();
      window.location.href = "/";
      return;
    }

    localStorage.removeItem("fcoc-user-mode");
    localStorage.removeItem("fcoc-user-mode-changed");
    localStorage.removeItem("fcoc-member-event-context");
    localStorage.removeItem("fcoc-member-event-changed");
    localStorage.removeItem("fcoc-admin-event-context");
    localStorage.removeItem("fcoc-admin-event-changed");
    localStorage.removeItem("fcoc-member-attendee-id");
    localStorage.removeItem("fcoc-member-email");
    localStorage.removeItem("fcoc-member-entry-id");
    localStorage.removeItem("fcoc-member-has-arrived");
    localStorage.removeItem("fcoc-admin-email");

    window.location.href = "/";
  }

  const memberItems: NavItem[] = useMemo(() => {
    return isCheckedIn
      ? [
          { label: "Home", href: "/" },
          { label: "Agenda", href: "/agenda" },
          { label: "Announcements", href: "/announcements" },
          { label: "Coach Map", href: "/coach-map" },
          { label: "Attendee Locator", href: "/attendees" },
          { label: "Nearby", href: "/nearby" },
          { label: "My Check-In", href: "/member/checkin" },
        ]
      : [
          { label: "My Check-In", href: "/member/checkin" },
          { label: "Home", href: "/" },
          { label: "Agenda", href: "/agenda" },
          { label: "Announcements", href: "/announcements" },
          { label: "Coach Map", href: "/coach-map" },
          { label: "Attendee Locator", href: "/attendees" },
          { label: "Nearby", href: "/nearby" },
        ];
  }, [isCheckedIn]);

  const adminItems: NavItem[] = [
    { label: "Dashboard", href: "/admin/dashboard" as Route },
    { label: "Announcements", href: "/admin/announcements" as Route },
    { label: "Check-In", href: "/admin/checkin" as Route },
    { label: "Parking Admin", href: "/admin/parking" as Route },
    { label: "Events", href: "/admin/events" as Route },
    { label: "Master Maps", href: "/admin/master-maps" as Route },
    { label: "Attendees", href: "/admin/attendees" },
    { label: "Reports", href: "/admin/reports" },
    { label: "Nearby Admin", href: "/admin/nearby" as Route },
    { label: "Agenda Admin", href: "/admin/agenda" as Route },
    { label: "Imports", href: "/admin/imports" },
    { label: "Agenda Import", href: "/admin/agenda/import" as Route },
  ];

  const sections: NavSection[] = useMemo(() => {
    if (effectiveUserMode === "admin") {
      return [
        {
          title: "Admin",
          items: adminItems,
        },
      ];
    }

    if (effectiveUserMode === "member") {
      return [
        {
          title: "Event",
          items: memberItems,
        },
      ];
    }

    return [];
  }, [effectiveUserMode, memberItems]);

  function isActiveRoute(itemHref: string) {
    return pathname === itemHref || pathname.startsWith(itemHref + "/");
  }

  if (!mounted) return null;

  const currentEvent = effectiveUserMode === "admin" ? adminEvent : memberEvent;
  const currentEventName =
    currentEvent?.name || currentEvent?.eventName || "No event selected";
  const currentEventLocation =
    currentEvent?.venue_name || currentEvent?.location || "";
  const currentEventDates = formatDateRange(
    currentEvent?.start_date,
    currentEvent?.end_date,
  );

  return (
    <>
      {isMobile && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close navigation" : "Open navigation"}
          style={{
            position: "fixed",
            top: "calc(env(safe-area-inset-top, 0px) + 12px)",
            left: "calc(env(safe-area-inset-left, 0px) + 12px)",
            zIndex: 9999,
            width: 48,
            height: 48,
            background: "#0b5cff",
            color: "#fff",
            border: "none",
            borderRadius: 999,
            cursor: "pointer",
            boxShadow: "0 3px 10px rgba(0,0,0,0.25)",
            fontSize: 22,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {open ? "×" : "☰"}
        </button>
      )}

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

      <aside
        style={{
          position: "fixed",
          top: 0,
          left: isMobile ? (open ? 0 : -SIDEBAR_WIDTH - 16) : 0,
          width: SIDEBAR_WIDTH,
          height: "100dvh",
          maxHeight: "100dvh",
          background: "#1f2937",
          color: "white",
          padding: isShortScreen ? 12 : 16,
          transition: isMobile ? "left 0.25s ease" : "none",
          zIndex: 1100,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          boxShadow: isMobile && open ? "6px 0 18px rgba(0,0,0,0.25)" : "none",
          overflow: "hidden",
        }}
      >
        {!isPreAuthPage ? (
          <div style={{ flexShrink: 0 }}>
            <h2
              style={{
                marginTop: 0,
                marginBottom: isShortScreen ? 8 : 10,
                fontSize: isShortScreen ? 20 : 24,
              }}
            >
              FCOC
            </h2>

            <div
              style={{
                marginBottom: isShortScreen ? 10 : 14,
                padding: isShortScreen ? 8 : 10,
                borderRadius: 10,
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  opacity: 0.7,
                  marginBottom: 4,
                }}
              >
                {effectiveUserMode === "admin"
                  ? "Admin Event"
                  : "Current Event"}
              </div>

              <div
                style={{
                  fontWeight: 700,
                  lineHeight: 1.25,
                  fontSize: isShortScreen ? 13 : 14,
                }}
              >
                {currentEventName}
              </div>

              {currentEventLocation && (
                <div style={{ fontSize: 12, color: "#d1d5db", marginTop: 4 }}>
                  {currentEventLocation}
                </div>
              )}

              {currentEventDates && (
                <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
                  {currentEventDates}
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            paddingRight: 4,
            WebkitOverflowScrolling: "touch",
          }}
        >
          {sections.map((section) => (
            <div key={section.title} style={{ marginBottom: 18 }}>
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
                      padding: isShortScreen ? "7px 9px" : "8px 10px",
                      marginBottom: 4,
                      borderRadius: 6,
                      textDecoration: "none",
                      color: active ? "#fff" : "#d1d5db",
                      background: active ? "#0b5cff" : "transparent",
                      fontSize: isShortScreen ? 13 : 14,
                    }}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        <div
          style={{
            flexShrink: 0,
            paddingTop: 12,
            marginTop: 8,
            borderTop: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <button
            type="button"
            onClick={handleSidebarExit}
            style={{
              width: "100%",
              padding: isShortScreen ? "9px 10px" : "10px 12px",
              borderRadius: 8,
              border: "1px solid #374151",
              background: "#111827",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: isShortScreen ? 13 : 14,
            }}
          >
            {showLoggedInLogout ? "Logout" : "Clear"}
          </button>
        </div>
      </aside>
    </>
  );
}
