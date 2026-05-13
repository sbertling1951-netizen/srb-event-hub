"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import {
  getCurrentAdminAccess,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";
import {
  getCurrentMemberEvent,
  getStoredMemberHasArrived,
  getStoredUserMode,
} from "@/lib/getCurrentMemberEvent";
import { APP_EVENT_NAMES, STORAGE_KEYS } from "@/lib/storageKeys";
import { supabase } from "@/lib/supabase";
import { getTenantLabel } from "@/lib/tenantLabels";

type NavItem = {
  label: string;
  href: string;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const ICON_MAP: Record<string, string> = {
  // Member (match dashboard exactly)
  "/member": "🏠",
  "/member/agenda": "📅",
  "/member/announcements": "📣",
  "/member/attendees": "👥",
  "/coach-map": "🗺️",
  "/member/checkin": "🪪",
  "/member/nearby": "📍",
  "/member/vendor-signup": "🛠️",

  // Admin (clean + distinct, not all same)
  "/admin/dashboard": "🏠",
  "/admin/events": "📅",
  "/admin/agenda": "📅",
  "/admin/announcements": "📣",
  "/admin/attendees": "👥",
  "/admin/checkin": "🪪",
  "/admin/parking": "🅿️",
  "/admin/print": "🖨️",
  "/admin/vendors": "🛠️",
  "/admin/map-admin": "🗺️",
  "/admin/admin-users": "🔐",
  "/admin/permissions": "⚙️",
  "/admin/checklist": "📋",
  "/admin/event-staff": "👥",
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

type AdminAccessState = Awaited<ReturnType<typeof getCurrentAdminAccess>>;

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
  const router = useRouter();
  const appTitle = getTenantLabel("app_title");
  const mapNavLabel = getTenantLabel("map_nav_label");

  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(true);
  const [open, setOpen] = useState(false);
  const [memberEvent, setMemberEvent] = useState<EventContext | null>(null);
  const [adminEvent, setAdminEvent] = useState<EventContext | null>(null);
  const [_isCheckedIn, setIsCheckedIn] = useState(false);
  const [userMode, setUserMode] = useState<"member" | "admin" | "none">("none");
  const [isShortScreen, setIsShortScreen] = useState(false);
  const [adminAccess, setAdminAccess] = useState<AdminAccessState>(null);
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const [adminPrivilegeGroup, setAdminPrivilegeGroup] = useState("");
  const [logoutConfirmMessage, setLogoutConfirmMessage] = useState<
    string | null
  >(null);

  function loadContextsFromStorage() {
    try {
      const memberEventContext = getCurrentMemberEvent();
      const rawAdminEvent = localStorage.getItem(
        STORAGE_KEYS.adminEventContext,
      );
      const hasArrived = getStoredMemberHasArrived();
      const storedUserMode = getStoredUserMode();

      setMemberEvent(memberEventContext);
      setAdminEvent(rawAdminEvent ? JSON.parse(rawAdminEvent) : null);
      setIsCheckedIn(hasArrived === "true");
      setUserMode(
        storedUserMode === "member" || storedUserMode === "admin"
          ? storedUserMode
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
        e.key === STORAGE_KEYS.memberEventContext ||
        e.key === STORAGE_KEYS.adminEventContext ||
        e.key === STORAGE_KEYS.memberHasArrived ||
        e.key === STORAGE_KEYS.memberEventChanged ||
        e.key === STORAGE_KEYS.adminEventChanged ||
        e.key === STORAGE_KEYS.userMode ||
        e.key === STORAGE_KEYS.userModeChanged
      ) {
        loadContextsFromStorage();
      }
    }

    function handleAdminEventUpdated() {
      loadContextsFromStorage();
    }

    function clearVisibleSidebarStateIfLoggedOut() {
      const mode = getStoredUserMode();
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
      APP_EVENT_NAMES.adminEventUpdated,
      handleAdminEventUpdated,
    );
    window.addEventListener("popstate", loadContextsFromStorage);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        APP_EVENT_NAMES.adminEventUpdated,
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
      const mode = getStoredUserMode();
      if (mode !== "admin") {
        setAdminAccess(null);
        setAdminDisplayName("");
        setAdminPrivilegeGroup("");
        return;
      }
      const admin = await getCurrentAdminAccess();
      setAdminAccess(admin);

      const displayName = admin?.display_name || admin?.email || "";
      const privilegeGroup = admin?.privilege_group || "";

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
        e.key === STORAGE_KEYS.adminEventContext ||
        e.key === STORAGE_KEYS.adminEventChanged ||
        e.key === STORAGE_KEYS.userMode ||
        e.key === STORAGE_KEYS.userModeChanged
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
      APP_EVENT_NAMES.adminEventUpdated,
      handleAdminEventUpdated,
    );
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        APP_EVENT_NAMES.adminEventUpdated,
        handleAdminEventUpdated,
      );
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [mounted]);

  function clearKnownAppStorageKeys() {
    Object.values(STORAGE_KEYS).forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
  }

  function clearAllAppState() {
    try {
      clearKnownAppStorageKeys();

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

      window.dispatchEvent(new Event(APP_EVENT_NAMES.adminEventUpdated));
      window.dispatchEvent(new Event(APP_EVENT_NAMES.memberEventUpdated));
    } catch (err) {
      console.error("Failed to clear app state:", err);
    }
  }

  function handleSidebarExit() {
    if (showLoggedInLogout) {
      const eventName =
        memberEvent?.name ||
        memberEvent?.eventName ||
        adminEvent?.name ||
        adminEvent?.eventName ||
        "this event";

      setLogoutConfirmMessage(`Do you want to logout of ${eventName}?`);
      return;
    }

    clearAllAppState();
    router.replace("/");
  }

  function confirmSidebarLogout() {
    setLogoutConfirmMessage(null);

    // Clear local app state first so route guards stop seeing a logged-in mode.
    // Then redirect immediately. Supabase sign-out can hang on localhost/network,
    // so do not let it block the user from leaving the protected area.
    clearAllAppState();

    try {
      void supabase.auth.signOut();
    } catch (err) {
      console.error("Supabase signOut failed:", err);
    }

    router.replace("/");
  }

  const memberItems: NavItem[] = useMemo(() => {
    return [
      { label: "Dashboard", href: "/member" },
      { label: "Agenda", href: "/member/agenda" },
      { label: "Announcements", href: "/member/announcements" },
      { label: "Attendee Locator", href: "/member/attendees" },
      { label: mapNavLabel, href: "/coach-map" },
      { label: "My Check-In", href: "/member/checkin" },
      { label: "Nearby", href: "/member/nearby" },
      { label: "Vendors / Service Requests", href: "/member/vendor-signup" },
    ];
  }, [mapNavLabel]);

  const sections: NavSection[] = useMemo(() => {
    if (effectiveUserMode === "admin") {
      const adminSection: NavItem[] = [
        hasPermission(adminAccess, "can_view_admin_dashboard") && {
          label: "Dashboard",
          href: "/admin/dashboard",
        },
        hasPermission(adminAccess, "can_manage_events") && {
          label: "Event Admin",
          href: "/admin/events",
        },
        hasPermission(adminAccess, "can_manage_admins") && {
          label: "Admin Users",
          href: "/admin/admin-users",
        },
        hasPermission(adminAccess, "can_manage_admins") && {
          label: "Permissions",
          href: "/admin/permissions",
        },
      ].filter(Boolean) as NavItem[];

      const opsSection: NavItem[] = [
        (hasPermission(adminAccess, "can_manage_attendees") ||
          hasPermission(adminAccess, "can_manage_checkin") ||
          hasPermission(adminAccess, "can_manage_parking")) && {
          label: "Attendees Management",
          href: "/admin/attendees",
        },
        hasPermission(adminAccess, "can_manage_checkin") && {
          label: "Check-In",
          href: "/admin/checkin",
        },
        hasPermission(adminAccess, "can_manage_parking") && {
          label: "Parking Admin",
          href: "/admin/parking",
        },
        hasPermission(adminAccess, "can_manage_reports") && {
          label: "Print Center",
          href: "/admin/print",
        },
        hasPermission(adminAccess, "can_manage_vendors") && {
          label: "Vendor Management",
          href: "/admin/vendors",
        },
      ].filter(Boolean) as NavItem[];

      const contentSection: NavItem[] = [
        hasPermission(adminAccess, "can_manage_agenda") && {
          label: "Agenda Admin",
          href: "/admin/agenda",
        },
        hasPermission(adminAccess, "can_manage_announcements") && {
          label: "Announcements",
          href: "/admin/announcements",
        },
        hasPermission(adminAccess, "can_manage_master_maps") && {
          label: "Map Admin",
          href: "/admin/map-admin",
        },
      ].filter(Boolean) as NavItem[];

      const staffSection: NavItem[] = [
        (hasPermission(adminAccess, "can_manage_event_staff") ||
          hasPermission(adminAccess, "can_manage_admins")) && {
          label: "Event Staff",
          href: "/admin/event-staff",
        },
        hasPermission(adminAccess, "can_manage_events") && {
          label: "Pre-Event Checklist",
          href: "/admin/checklist",
        },
      ].filter(Boolean) as NavItem[];

      return [
        ...(adminSection.length
          ? [{ title: "Admin", items: adminSection }]
          : []),
        ...(opsSection.length
          ? [{ title: "Operations", items: opsSection }]
          : []),
        ...(contentSection.length
          ? [{ title: "Content", items: contentSection }]
          : []),
        ...(staffSection.length
          ? [{ title: "Staff & Setup", items: staffSection }]
          : []),
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
  }, [effectiveUserMode, memberItems, adminAccess]);

  function isActiveRoute(itemHref: string) {
    return pathname === itemHref || pathname.startsWith(itemHref + "/");
  }

  if (!mounted) {
    return null;
  }

  if (pathname === "/member/login" || pathname === "/admin/login") {
    return (
      <button
        type="button"
        onClick={() => {
          clearAllAppState();
          router.replace("/");
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

  if (userMode === "none") {
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
              {appTitle}
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
                    {formatPrivilegeGroup(adminPrivilegeGroup)}
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
                        fontSize: 12,
                        fontWeight: 900,
                        padding: "4px 8px",
                        borderRadius: 999,
                        color: "#fff",
                        whiteSpace: "nowrap",
                        background: getBadgeColor(adminPrivilegeGroup),
                      }}
                    >
                      {getPrivilegeBadge(adminPrivilegeGroup)}
                    </div>
                  </div>
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
                  opacity: 0.75,
                  marginBottom: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>
                  {section.title === "Admin"
                    ? "⚙️"
                    : section.title === "Operations"
                      ? "🧭"
                      : section.title === "Content"
                        ? "📰"
                        : section.title === "Staff & Setup"
                          ? "👥"
                          : ""}
                </span>
                <span>{section.title}</span>
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
                      paddingLeft: active
                        ? isShortScreen
                          ? "6px"
                          : "7px"
                        : isShortScreen
                          ? "9px"
                          : "10px",
                      marginBottom: 4,
                      borderRadius: 6,
                      textDecoration: "none",
                      color: active ? "#fff" : "#d1d5db",
                      background: active ? "#0b5cff" : "transparent",
                      fontSize: isShortScreen ? 13 : 14,
                      boxShadow: active
                        ? "0 0 0 1px rgba(11,92,255,0.6), 0 4px 10px rgba(11,92,255,0.35)"
                        : "none",
                      transform: active ? "translateX(2px)" : "none",
                      transition: "all 0.15s ease",
                      // borderLeft modification:
                      borderLeft: active
                        ? `3px solid ${getSectionColor(section.title)}`
                        : "3px solid transparent",
                      // Add borderColor:
                      borderColor: active
                        ? getSectionColor(section.title)
                        : "transparent",
                    }}
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        fontWeight: active ? 700 : 600,
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 22,
                          height: 22,
                          fontSize: 16,
                          transform: active ? "scale(1.15)" : "scale(1)",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {ICON_MAP[item.href] || "📌"}
                      </span>

                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        {item.label}
                      </span>
                    </span>
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
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "#0f172a",
              color: "#ffffff",
              WebkitTextFillColor: "#ffffff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.35)",
                fontSize: 13,
                fontWeight: 900,
                lineHeight: 1,
              }}
            >
              ⏻
            </span>
            <span>Logout</span>
          </button>
        </div>
      </aside>
      <ConfirmDialog
        open={!!logoutConfirmMessage}
        title="Logout"
        message={logoutConfirmMessage || ""}
        confirmLabel="Logout"
        cancelLabel="Stay Logged In"
        danger={true}
        onConfirm={confirmSidebarLogout}
        onCancel={() => setLogoutConfirmMessage(null)}
      />
    </>
  );
}

// Section color helper for fallback (for TS/JS scope)
function getSectionColor(title: string) {
  switch (title) {
    case "Admin":
      return "#f87171"; // red
    case "Operations":
      return "#60a5fa"; // blue
    case "Content":
      return "#34d399"; // green
    case "Staff & Setup":
      return "#fbbf24"; // amber
    default:
      return "#9ca3af";
  }
}
