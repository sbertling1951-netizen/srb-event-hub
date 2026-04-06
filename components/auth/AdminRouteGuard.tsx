"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Props = {
  children: React.ReactNode;
};

type CachedAdminState = {
  userId: string;
  isAdmin: boolean;
  checkedAt: number;
};

const ADMIN_CACHE_KEY = "fcoc-admin-access";
const ADMIN_CACHE_MAX_AGE_MS = 1000 * 60 * 15; // 15 minutes

function readCachedAdminState(): CachedAdminState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = sessionStorage.getItem(ADMIN_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CachedAdminState;
    if (!parsed?.userId) return null;

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
  if (typeof window === "undefined") return;

  try {
    sessionStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify(value));
  } catch {}
}

function clearCachedAdminState() {
  if (typeof window === "undefined") return;

  try {
    sessionStorage.removeItem(ADMIN_CACHE_KEY);
  } catch {}
}

export default function AdminRouteGuard({ children }: Props) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function verifyAdmin() {
      try {
        setChecking(true);

        let {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        if (!session?.user) {
          const { data: refreshed, error: refreshError } =
            await supabase.auth.refreshSession();

          if (refreshError) {
            throw refreshError;
          }

          session = refreshed.session;
        }

        const user = session?.user;

        if (!user) {
          clearCachedAdminState();
          if (mounted) {
            setAllowed(false);
            setChecking(false);
            router.replace("/admin/login");
          }
          return;
        }

        const cached = readCachedAdminState();
        if (cached && cached.userId === user.id && cached.isAdmin) {
          if (!mounted) return;
          setAllowed(true);
          setChecking(false);
          return;
        }

        const { data, error } = await supabase
          .from("admin_users")
          .select("id,is_active,is_super_admin")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .limit(1);

        if (error) {
          throw error;
        }

        const isAdmin = !!(data && data.length > 0);

        if (!isAdmin) {
          clearCachedAdminState();
          if (mounted) {
            setAllowed(false);
            setChecking(false);
            router.replace("/admin/login");
          }
          return;
        }

        writeCachedAdminState({
          userId: user.id,
          isAdmin: true,
          checkedAt: Date.now(),
        });

        if (!mounted) return;
        setAllowed(true);
      } catch (err) {
        console.error("AdminRouteGuard error:", err);
        clearCachedAdminState();
        if (mounted) {
          setAllowed(false);
          setChecking(false);
          router.replace("/admin/login");
        }
        return;
      } finally {
        if (mounted) {
          setChecking(false);
        }
      }
    }

    void verifyAdmin();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUserId = session?.user?.id ?? null;
      const cached = readCachedAdminState();

      if (!currentUserId) {
        clearCachedAdminState();
        if (mounted) {
          setAllowed(false);
        }
        return;
      }

      if (cached && cached.userId !== currentUserId) {
        clearCachedAdminState();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [router]);

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

  if (!allowed) return null;

  return <>{children}</>;
}
