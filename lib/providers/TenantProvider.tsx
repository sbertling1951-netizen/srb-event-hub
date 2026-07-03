"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getCurrentTenant, type TenantContext } from "@/lib/tenantContext";

interface TenantProviderValue {
  tenant: TenantContext | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const TenantContextState = createContext<TenantProviderValue>({
  tenant: null,
  loading: true,
  refresh: async () => {},
});

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenant] = useState<TenantContext | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);

    try {
      const result = await getCurrentTenant();
      setTenant(result);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo(
    () => ({
      tenant,
      loading,
      refresh,
    }),
    [tenant, loading],
  );

  return (
    <TenantContextState.Provider value={value}>
      {children}
    </TenantContextState.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContextState);
}
