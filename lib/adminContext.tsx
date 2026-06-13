"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";

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
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith("/admin") ?? false;

  const [admin, setAdmin] = useState<AdminContextType["admin"]>(null);
  const [loading, setLoading] = useState(isAdminRoute);

  async function loadAdmin() {
    console.log("LOAD ADMIN START");
    try {
      setLoading(true);
      const result = await getCurrentAdminAccess();
      console.log("LOAD ADMIN RESULT", {
        hasResult: !!result,
        adminId: result?.adminUser?.id,
        userId: result?.adminUser?.user_id,
      });
      console.count("SET ADMIN CALLED");

      setAdmin((prev) => {
        console.log("SETADMIN", {
          prevAdmin: !!prev,
          nextAdmin: !!result,
        });
        if (
          prev?.adminUser?.id === result?.adminUser?.id &&
          prev?.currentEventId === result?.currentEventId
        ) {
          return prev;
        }

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
        console.log("BOOTSTRAP FOUND SESSION");
        await loadAdmin();
      } else {
        console.log("BOOTSTRAP NO SESSION");
        setAdmin(null);
        setLoading(false);
      }
    }

    void bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("AUTH EVENT", event, !!session, Date.now());

      if (!mounted) {
        return;
      }

      if (event === "INITIAL_SESSION") {
        return;
      }

      if (event === "SIGNED_IN") {
        console.log("SIGNED_IN -> LOADADMIN");
        void loadAdmin();
        return;
      }

      if (event === "TOKEN_REFRESHED") {
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
