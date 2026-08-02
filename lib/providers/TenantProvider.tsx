"use client";

import { createContext, type ReactNode, useContext } from "react";

import { type TenantPresentation } from "@/lib/tenantContext";

interface TenantProviderValue {
  tenant: TenantPresentation | null;
}

const TenantContextState = createContext<TenantProviderValue>({
  tenant: null,
});

export function TenantProvider({
  children,
  tenant,
}: {
  children: ReactNode;
  tenant: TenantPresentation | null;
}) {
  return (
    <TenantContextState.Provider value={{ tenant }}>
      {children}
    </TenantContextState.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContextState);
}
