"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  getCurrentAdminAccess,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";
import { getStoredUserMode } from "@/lib/getCurrentMemberEvent";
import { STORAGE_KEYS } from "@/lib/storageKeys";

type Props = {
  children: React.ReactNode;
  requiredPermission?: string;
  fallbackPath?: string;
};

type CachedAdminState = {
  userId: string;
  isAdmin: boolean;
  checkedAt: number;
};

const ADMIN_CACHE_KEY = STORAGE_KEYS.adminAccess;
const ADMIN_CACHE_MAX_AGE_MS = 1000 * 60 * 15; // 15 minutes

function readCachedAdminState(): CachedAdminState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = sessionStorage.getItem(ADMIN_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CachedAdminState;
    if (!parsed?.userId) {
      return null;
    }

    const isFresh = Date.now() - parsed.checkedAt < ADMIN_CACHE_MAX_AGE_MS;
    if (!isFresh) {
      sessionStorage.removeItem(ADMIN_CACHE_KEY);
      return null;
    }

    return parsed;
  } catch {
    sessionStorage.removeItem(ADMIN_CACHE_KEY);
    return null;
  }
}

function writeCachedAdminState(value: CachedAdminState) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    sessionStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify(value));
  } catch {}
}

function clearCachedAdminState() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    sessionStorage.removeItem(ADMIN_CACHE_KEY);
  } catch {}
}

export default function AdminRouteGuard({
  children,
  requiredPermission,
  fallbackPath = "/admin/login",
}: Props) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [deniedMessage, setDeniedMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let running = false;

    async function verifyAdmin() {
      if (running) {
        return;
      }
      running = true;

      try {
        setChecking(true);
        setDeniedMessage(null);
        const mode = getStoredUserMode();
        console.log("[AdminGuard] mode:", mode);
        if (mode !== "admin") {
          console.log("[AdminGuard] redirect: not in admin mode");
          clearCachedAdminState();
          if (mounted) {
            setAllowed(false);
            setChecking(false);
            router.replace("/");
          }
          return;
        }

        let admin = null;
        try {
          admin = await getCurrentAdminAccess();
        } catch (err) {
          console.error(
            "[AdminGuard] getCurrentAdminAccess failed:",
            err instanceof Error
              ? err.message
              : typeof err === "string"
                ? err
                : JSON.stringify(err),
          );

          // Do NOT throw — just treat as failed access
          admin = null;
        }
        console.log("[AdminGuard] admin result:", admin);

        if (!admin?.adminUser?.user_id) {
          console.log("[AdminGuard] redirect: missing adminUser.user_id");
          clearCachedAdminState();
          if (mounted) {
            setAllowed(false);
            setChecking(false);
            router.replace(fallbackPath);
          }
          return;
        }

        const cached = readCachedAdminState();
        if (
          !cached ||
          cached.userId !== admin.adminUser.user_id ||
          !cached.isAdmin
        ) {
          writeCachedAdminState({
            userId: admin.adminUser.user_id,
            isAdmin: true,
            checkedAt: Date.now(),
          });
        }

        if (requiredPermission && !hasPermission(admin, requiredPermission)) {
          clearCachedAdminState();
          if (mounted) {
            setAllowed(false);
            setChecking(false);
            setDeniedMessage("You do not have permission to view this page.");
          }
          return;
        }

        if (!mounted) {
          return;
        }
        setAllowed(true);
      } catch (err) {
        console.error(
          "AdminRouteGuard error:",
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : JSON.stringify(err),
        );
        console.log("[AdminGuard] redirect: exception path");
        clearCachedAdminState();
        if (mounted) {
          setAllowed(false);
          setChecking(false);
          router.replace(fallbackPath);
        }
        return;
      } finally {
        if (mounted) {
          setChecking(false);
        }
        running = false;
      }
    }

    void verifyAdmin();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === STORAGE_KEYS.adminEventContext ||
        e.key === STORAGE_KEYS.adminEventChanged ||
        e.key === STORAGE_KEYS.userMode ||
        e.key === STORAGE_KEYS.userModeChanged
      ) {
        void verifyAdmin();
      }
    }

    function handlePageShow() {
      void verifyAdmin();
    }

    function handleUnhandledRejection(e: PromiseRejectionEvent) {
      try {
        const reason = e.reason;
        const message =
          reason instanceof Error
            ? reason.message
            : typeof reason === "string"
              ? reason
              : JSON.stringify(reason);

        console.error("[AdminGuard] Unhandled rejection:", message);
      } catch (err) {
        console.error("[AdminGuard] Unhandled rejection (unknown)");
      }

      // prevent React/Next from showing opaque [object Event]
      e.preventDefault();
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      mounted = false;
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection,
      );
    };
  }, [router, requiredPermission, fallbackPath]);

  if (checking && !allowed) {
    return (
      <div style={{ padding: 24 }}>
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 18,
          }}
        >
          Checking access...
        </div>
      </div>
    );
  }

  if (!allowed && deniedMessage) {
    return (
      <div style={{ padding: 24 }}>
        <div
          role="alert"
          style={{
            border: "1px solid #e2b4b4",
            borderRadius: 10,
            background: "#fff3f3",
            color: "#8a1f1f",
            padding: 18,
          }}
        >
          {deniedMessage}
        </div>
      </div>
    );
  }

  if (!allowed) {
    return null;
  }

  return <>{children}</>;
}
