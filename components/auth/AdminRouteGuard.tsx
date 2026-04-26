"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  getCurrentAdminAccess,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";

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

const ADMIN_CACHE_KEY = "fcoc-admin-access";
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

    async function verifyAdmin() {
      try {
        setChecking(true);
        setDeniedMessage(null);
        const mode = localStorage.getItem("fcoc-user-mode");
        if (mode !== "admin") {
          clearCachedAdminState();
          if (mounted) {
            setAllowed(false);
            setChecking(false);
            router.replace("/");
          }
          return;
        }

        const admin = await getCurrentAdminAccess();

        if (!admin?.adminUser?.user_id) {
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
        console.error("AdminRouteGuard error:", err);
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
      }
    }

    void verifyAdmin();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-admin-event-context" ||
        e.key === "fcoc-admin-event-changed" ||
        e.key === "fcoc-user-mode" ||
        e.key === "fcoc-user-mode-changed"
      ) {
        void verifyAdmin();
      }
    }

    function handlePageShow() {
      void verifyAdmin();
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      mounted = false;
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("pageshow", handlePageShow);
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
