

"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  getCurrentAdminEvent,
  subscribeToAdminEventChange,
} from "@/lib/adminEventContext";

export interface AdminWorkspace {
  currentEvent: ReturnType<typeof getCurrentAdminEvent>;
  hasEvent: boolean;
  status: "ready" | "unavailable";
  refresh: () => void;
}

const AdminWorkspaceContext = createContext<AdminWorkspace | null>(null);

export function AdminWorkspaceProvider({ children }: { children: ReactNode }) {
  const readWorkspace = (): Omit<AdminWorkspace, "refresh"> => {
    const currentEvent = getCurrentAdminEvent();

    return {
      currentEvent,
      hasEvent: !!currentEvent,
      status: currentEvent ? "ready" : "unavailable",
    };
  };

  const [workspace, setWorkspace] = useState(readWorkspace);

  const refresh = () => {
    setWorkspace(readWorkspace());
  };

  useEffect(() => subscribeToAdminEventChange(refresh), []);

  const value = useMemo(
    () => ({
      ...workspace,
      refresh,
    }),
    [workspace],
  );

  return (
    <AdminWorkspaceContext.Provider value={value}>
      {children}
    </AdminWorkspaceContext.Provider>
  );
}

export function useAdminWorkspace(): AdminWorkspace {
  const context = useContext(AdminWorkspaceContext);

  if (!context) {
    throw new Error(
      "useAdminWorkspace must be used within an AdminWorkspaceProvider",
    );
  }

  return context;
}
