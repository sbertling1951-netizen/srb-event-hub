"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";

import {
  type AdminTenantAuthorityResult,
  checkAdminTenantAuthority,
} from "@/lib/adminTenantAuthority";
import { ensureAdminIdentityLinked } from "@/lib/ensureAdminIdentityLinked";
import { getCurrentAdminAccess } from "@/lib/getCurrentAdminAccess";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { supabase } from "@/lib/supabase";

type AdminContextType = {
  admin: Awaited<ReturnType<typeof getCurrentAdminAccess>> | null;
  tenantAuthority: AdminTenantAuthorityResult | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const AdminContext = createContext<AdminContextType>({
  admin: null,
  tenantAuthority: null,
  loading: true,
  refresh: async () => {},
});

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith("/admin") ?? false;

  const [admin, setAdmin] = useState<AdminContextType["admin"]>(null);
  const [tenantAuthority, setTenantAuthority] =
    useState<AdminTenantAuthorityResult | null>(null);
  const [loading, setLoading] = useState(isAdminRoute);

  async function loadAdmin() {
    try {
      setLoading(true);
      setTenantAuthority(null);
      const result = await getCurrentAdminAccess();
      const resolvedTenantAuthority = result
        ? await checkAdminTenantAuthority()
        : null;

      setAdmin((prev) => {
        if (prev?.adminUser?.id === result?.adminUser?.id) {
          return prev;
        }

        return result;
      });
      setTenantAuthority(resolvedTenantAuthority);

      if (typeof window !== "undefined") {
        if (result) {
          sessionStorage.setItem(STORAGE_KEYS.adminAccess, JSON.stringify(result));
        } else {
          sessionStorage.removeItem(STORAGE_KEYS.adminAccess);
        }
      }
    } catch (err) {
      console.error("loadAdmin error:", err);

      setAdmin(null);
      setTenantAuthority(null);

      if (typeof window !== "undefined") {
        sessionStorage.removeItem(STORAGE_KEYS.adminAccess);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    if (!isAdminRoute) {
      setAdmin(null);
      setTenantAuthority(null);
      setLoading(false);

      return () => {
        mounted = false;
      };
    }

    async function bootstrap() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) {
        return;
      }

      if (session) {
        void ensureAdminIdentityLinked();
        await loadAdmin();
      } else {
        setAdmin(null);
        setTenantAuthority(null);
        setLoading(false);
      }
    }

    void bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) {
        return;
      }

      if (event === "INITIAL_SESSION") {
        return;
      }

      if (event === "SIGNED_IN") {
        void ensureAdminIdentityLinked();
        void loadAdmin();
        return;
      }

      if (event === "TOKEN_REFRESHED") {
        return;
      }

      setAdmin(null);
      setTenantAuthority(null);

      if (typeof window !== "undefined") {
        sessionStorage.removeItem(STORAGE_KEYS.adminAccess);
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [isAdminRoute]);

  return (
    <AdminContext.Provider
      value={{ admin, tenantAuthority, loading, refresh: loadAdmin }}
    >
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  return useContext(AdminContext);
}
