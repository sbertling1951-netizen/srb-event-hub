"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { getCurrentAdminAccess } from "@/lib/getCurrentAdminAccess";

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
  const [admin, setAdmin] = useState<AdminContextType["admin"]>(null);
  const [loading, setLoading] = useState(true);

  async function loadAdmin() {
    setLoading(true);
    const result = await getCurrentAdminAccess();
    setAdmin(result);
    setLoading(false);
  }

  useEffect(() => {
    void loadAdmin();
  }, []);

  return (
    <AdminContext.Provider value={{ admin, loading, refresh: loadAdmin }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  return useContext(AdminContext);
}
