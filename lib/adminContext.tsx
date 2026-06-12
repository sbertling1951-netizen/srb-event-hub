"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import { getCurrentAdminAccess } from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

type AdminContextType = {
  admin: Awaited<ReturnType<typeof getCurrentAdminAccess>> | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const AdminContext = createContext<AdminContextType>({
  admin: null,
  loading: true,
  refresh: async () => {},
});

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const instanceId = useRef(Math.random().toString(36).slice(2));

  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith("/admin") ?? false;

  const [admin, setAdmin] = useState<AdminContextType["admin"]>(null);
  const [loading, setLoading] = useState(isAdminRoute);

  async function loadAdmin() {
    console.count("LOAD ADMIN");
    try {
      setLoading(true);
      const result = await getCurrentAdminAccess();
      console.count("SET ADMIN CALLED");

      setAdmin((prev) => {
        if (
          prev?.adminUser?.id === result?.adminUser?.id &&
          prev?.currentEventId === result?.currentEventId
        ) {
          console.log("ADMIN GUARD HELD");
          return prev;
        }

        console.log("ADMIN GUARD FAILED", {
          prevUserId: prev?.adminUser?.id,
          nextUserId: result?.adminUser?.id,
          prevEventId: prev?.currentEventId,
          nextEventId: result?.currentEventId,
        });
        return result;
      });

      if (typeof window !== "undefined") {
        if (result) {
          sessionStorage.setItem("fcoc-admin-access", JSON.stringify(result));
        } else {
          sessionStorage.removeItem("fcoc-admin-access");
        }
      }
    } catch (err) {
      console.error("loadAdmin error:", err);

      setAdmin(null);

      if (typeof window !== "undefined") {
        sessionStorage.removeItem("fcoc-admin-access");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    if (!isAdminRoute) {
      setAdmin(null);
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
        await loadAdmin();
      } else {
        setAdmin(null);
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
        console.log("AUTH EVENT ignored INITIAL_SESSION");
        return;
      }

      if (event === "SIGNED_IN") {
        console.count("AUTH EVENT SIGNED_IN");
        void loadAdmin();
        return;
      }

      if (event === "TOKEN_REFRESHED") {
        console.log("AUTH EVENT ignored TOKEN_REFRESHED");
        return;
      }

      setAdmin(null);

      if (typeof window !== "undefined") {
        sessionStorage.removeItem("fcoc-admin-access");
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [isAdminRoute]);

  return (
    <AdminContext.Provider value={{ admin, loading, refresh: loadAdmin }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  return useContext(AdminContext);
}
