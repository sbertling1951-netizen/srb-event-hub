"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  getCurrentAdminAccess,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";
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
  if (!startDate && !endDate) {
    return "";
  }
  if (startDate && endDate) {
    return `${startDate} – ${endDate}`;
  }
  return startDate || endDate || "";
}

function getPrivilegeBadge(value?: string | null) {
  switch (value) {
    case "super_admin":
      return "SA";
    case "event_admin":
      return "EA";
    case "checkin":
      return "CI";
    case "parking":
      return "PK";
    case "content_admin":
      return "CA";
    case "read_only":
      return "RO";
    default:
      return "";
  }
}

// 👇 ADD IT RIGHT HERE
function getBadgeColor(value?: string | null) {
  switch (value) {
    case "super_admin":
      return "#dc2626"; // red
    case "event_admin":
      return "#2563eb"; // blue
    case "checkin":
      return "#16a34a"; // green
    case "parking":
      return "#ea580c"; // orange
    case "content_admin":
      return "#7c3aed"; // purple
    case "read_only":
      return "#6b7280"; // gray
    default:
      return "#374151";
  }
}
function formatPrivilegeGroup(value?: string | null) {
  if (!value) {
    return "";
  }
  switch (value) {
    case "super_admin":
      return "Super Admin";
    case "event_admin":
      return "Event Admin";
    case "checkin":
      return "Check-In";
    case "parking":
      return "Parking";
    case "content_admin":
      return "Content Admin";
    case "read_only":
      return "Read Only";
    default:
      return value.replace(/_/g, " ");
  }
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
  const [adminAccess, setAdminAccess] = useState<any>(null);
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const [adminPrivilegeGroup, setAdminPrivilegeGroup] = useState("");

  function loadContextsFromStorage() {
    try {
      const rawMemberEvent = localStorage.getItem("fcoc-member-event-context");
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

  const isAdminRoute = pathname.startsWith("/admin");
  const isMemberRoute =
    pathname.startsWith("/member") ||
    pathname.startsWith("/coach-map") ||
    pathname.startsWith("/member/agenda") ||
    pathname.startsWith("/member/announcements") ||
    pathname.startsWith("/member/attendees") ||
    pathname.startsWith("/member/nearby");

  const isPreAuthPage =
    pathname === "/" ||
    pathname === "/member/login" ||
    pathname === "/admin/login";

  const effectiveUserMode = mounted ? userMode : "none";

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
    if (!mounted) {
      return;
    }

    loadContextsFromStorage();

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
        loadContextsFromStorage();
      }
    }

    function handleAdminEventUpdated() {
      loadContextsFromStorage();
    }

    function clearVisibleSidebarStateIfLoggedOut() {
      const mode = localStorage.getItem("fcoc-user-mode");
      if (mode === "admin" || mode === "member") {
        loadContextsFromStorage();
        return;
      }

      setMemberEvent(null);
      setAdminEvent(null);
      setIsCheckedIn(false);
      setUserMode("none");
      setAdminAccess(null);
      setAdminDisplayName("");
      setAdminPrivilegeGroup("");
      setOpen(false);
    }

    function handlePageShow() {
      clearVisibleSidebarStateIfLoggedOut();
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      "fcoc-admin-event-updated",
      handleAdminEventUpdated,
    );
    window.addEventListener("popstate", loadContextsFromStorage);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        "fcoc-admin-event-updated",
        handleAdminEventUpdated,
      );
      window.removeEventListener("popstate", loadContextsFromStorage);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    loadContextsFromStorage();
  }, [mounted, pathname]);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyTouchAction = document.body.style.touchAction;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    if (isMobile && open) {
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";
      document.documentElement.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
      document.documentElement.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.touchAction = previousBodyTouchAction;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [isMobile, open, mounted]);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    async function loadAdminAccess() {
      const mode = localStorage.getItem("fcoc-user-mode");
      if (mode !== "admin") {
        setAdminAccess(null);
        setAdminDisplayName("");
        setAdminPrivilegeGroup("");
        return;
      }
      const admin = await getCurrentAdminAccess();
      setAdminAccess(admin);

      const adminRecord = admin as Record<string, unknown> | null;
      const displayName =
        typeof adminRecord?.display_name === "string"
          ? adminRecord.display_name
          : typeof adminRecord?.email === "string"
            ? adminRecord.email
            : "";

      const privilegeGroup =
        typeof adminRecord?.privilege_group === "string"
          ? adminRecord.privilege_group
          : "";

      setAdminDisplayName(displayName);
      setAdminPrivilegeGroup(privilegeGroup);
    }

    void loadAdminAccess();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void loadAdminAccess();
    });

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-admin-event-context" ||
        e.key === "fcoc-admin-event-changed" ||
        e.key === "fcoc-user-mode" ||
        e.key === "fcoc-user-mode-changed"
      ) {
        void loadAdminAccess();
      }
    }

    function handleAdminEventUpdated() {
      void loadAdminAccess();
      loadContextsFromStorage();
    }

    function handlePageShow() {
      void loadAdminAccess();
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      "fcoc-admin-event-updated",
      handleAdminEventUpdated,
    );
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        "fcoc-admin-event-updated",
        handleAdminEventUpdated,
      );
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [mounted]);

  function clearAllAppState() {
    try {
      localStorage.clear();
      sessionStorage.clear();

      setMemberEvent(null);
      setAdminEvent(null);
      setIsCheckedIn(false);
      setUserMode("none");
      setAdminAccess(null);
      setAdminDisplayName("");
      setAdminPrivilegeGroup("");
      setOpen(false);
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
      document.documentElement.style.overflow = "";

      window.dispatchEvent(new Event("fcoc-admin-event-updated"));
      window.dispatchEvent(new Event("fcoc-member-event-updated"));
    } catch (err) {
      console.error("Failed to clear app state:", err);
    }
  }

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
      if (!confirmed) {
        return;
      }

      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.error("Supabase signOut failed:", err);
      }

      clearAllAppState();
      window.location.replace("/");
      return;
    }

    clearAllAppState();
    window.location.replace("/");
  }

  const memberItems: NavItem[] = useMemo(() => {
    return isCheckedIn
      ? [
          { label: "Home", href: "/member" },
          { label: "Agenda", href: "/member/agenda" },
          { label: "Announcements", href: "/member/announcements" },
          { label: "Coach Map", href: "/coach-map" },
          { label: "Attendee Locator", href: "/member/attendees" },
          { label: "Nearby", href: "/member/nearby" },
          { label: "My Check-In", href: "/member/checkin" },
        ]
      : [
          { label: "My Check-In", href: "/member/checkin" },
          { label: "Home", href: "/member" },
          { label: "Agenda", href: "/member/agenda" },
          { label: "Announcements", href: "/member/announcements" },
          { label: "Coach Map", href: "/coach-map" },
          { label: "Attendee Locator", href: "/member/attendees" },
          { label: "Nearby", href: "/member/nearby" },
        ];
  }, [isCheckedIn]);

  const canManageEventStaff =
    !!adminAccess &&
    (hasPermission(adminAccess, "can_manage_admins") ||
      hasPermission(adminAccess, "can_manage_event_admins"));

  const canManageAdminUsers =
    !!adminAccess && hasPermission(adminAccess, "can_manage_admins");

  const sections: NavSection[] = useMemo(() => {
    if (effectiveUserMode === "admin") {
      const adminItems: NavItem[] = [
        { label: "Dashboard", href: "/admin/dashboard" },
        { label: "Announcements", href: "/admin/announcements" },
        { label: "Check-In", href: "/admin/checkin" },
        { label: "Parking Admin", href: "/admin/parking" },
        { label: "Events", href: "/admin/events" },
        { label: "Map Admin", href: "/admin/map-admin" },
        { label: "Attendees Management", href: "/admin/attendees" },
        { label: "Pre-Rally Checklist", href: "/admin/checklist" },
        { label: "Print Center", href: "/admin/print" },
        { label: "Agenda Admin", href: "/admin/agenda" },
        ...(canManageEventStaff
          ? [{ label: "Event Staff", href: "/admin/event-staff" }]
          : []),
        ...(canManageAdminUsers
          ? [{ label: "Admin Users", href: "/admin/admin-users" }]
          : []),
      ];

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
  }, [
    effectiveUserMode,
    memberItems,
    canManageEventStaff,
    canManageAdminUsers,
  ]);

  function isActiveRoute(itemHref: string) {
    return pathname === itemHref || pathname.startsWith(itemHref + "/");
  }

  if (!mounted) {
    return null;
  }

  if (userMode === "none") {
    if (pathname === "/member/login" || pathname === "/admin/login") {
      return (
        <button
          type="button"
          onClick={() => {
            clearAllAppState();
            window.location.replace("/");
          }}
          style={{
            position: "fixed",
            top: "calc(env(safe-area-inset-top, 0px) + 12px)",
            right: "calc(env(safe-area-inset-right, 0px) + 12px)",
            zIndex: 9999,
            padding: "10px 14px",
            borderRadius: 999,
            border: "1px solid #cbd5e1",
            background: "white",
            color: "#111827",
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 3px 10px rgba(0,0,0,0.18)",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          Change Login Type
        </button>
      );
    }

    return null;
  }

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
            WebkitTapHighlightColor: "transparent",
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
            touchAction: "none",
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
          transition: isMobile ? "left 0.25s ease" : "none",
          zIndex: 1100,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          boxShadow: isMobile && open ? "6px 0 18px rgba(0,0,0,0.25)" : "none",
          overflow: "hidden",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          paddingTop: isMobile
            ? "calc(env(safe-area-inset-top, 0px) + 12px)"
            : isShortScreen
              ? 12
              : 16,
          paddingBottom: isMobile
            ? "calc(env(safe-area-inset-bottom, 0px) + 12px)"
            : isShortScreen
              ? 12
              : 16,
          willChange: isMobile ? "left" : undefined,
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

              {effectiveUserMode === "admin" && adminDisplayName && (
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 8,
                    borderTop: "1px solid rgba(255,255,255,0.08)",
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
                    Signed In As
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 700,
                        lineHeight: 1.25,
                        fontSize: isShortScreen ? 13 : 14,
                      }}
                    >
                      {adminDisplayName}
                    </div>

                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        padding: "2px 6px",
                        borderRadius: 999,
                        color: "#fff",
                        whiteSpace: "nowrap",
                        background: getBadgeColor(adminPrivilegeGroup),
                      }}
                    >
                      {getPrivilegeBadge(adminPrivilegeGroup)}
                    </div>
                  </div>

                  {adminPrivilegeGroup && (
                    <div
                      style={{ fontSize: 12, color: "#d1d5db", marginTop: 4 }}
                    >
                      {formatPrivilegeGroup(adminPrivilegeGroup)}
                    </div>
                  )}
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
            overflowX: "hidden",
            paddingRight: 4,
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
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
                      if (isMobile) {
                        setOpen(false);
                      }
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
              WebkitTapHighlightColor: "transparent",
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
