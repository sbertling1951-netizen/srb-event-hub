import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ADMIN_EVENT_UPDATED,
  clearCurrentAdminEvent,
  getCurrentAdminEvent,
  setCurrentAdminEvent,
} from "@/lib/adminEventContext";

export { clearCurrentAdminEvent, getCurrentAdminEvent, setCurrentAdminEvent };

export type AdminWorkspaceStatus = "loading" | "ready" | "unavailable";

export interface AdminWorkspaceSnapshot {
  event: ReturnType<typeof getCurrentAdminEvent>;
  status: AdminWorkspaceStatus;
  hasEvent: boolean;
}

export function getAdminWorkspace(): AdminWorkspaceSnapshot {
  const event = getCurrentAdminEvent();

  return {
    event,
    status: event ? "ready" : "unavailable",
    hasEvent: !!event,
  };
}

interface AdminWorkspaceContextValue extends AdminWorkspaceSnapshot {
  refresh: () => void;
}

const AdminWorkspaceContext =
  createContext<AdminWorkspaceContextValue | null>(null);

export function AdminWorkspaceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [workspace, setWorkspace] = useState(getAdminWorkspace);

  const refresh = () => {
    setWorkspace(getAdminWorkspace());
  };

  useEffect(() => subscribeToAdminWorkspace(refresh), []);

  const value = useMemo(
    () => ({ ...workspace, refresh }),
    [workspace],
  );

  return (
    <AdminWorkspaceContext.Provider value={value}>
      {children}
    </AdminWorkspaceContext.Provider>
  );
}

export function useAdminWorkspace() {
  const context = useContext(AdminWorkspaceContext);

  if (!context) {
    throw new Error(
      "useAdminWorkspace must be used within an AdminWorkspaceProvider",
    );
  }

  return context;
}

export function subscribeToAdminWorkspace(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener(ADMIN_EVENT_UPDATED, callback);

  return () => {
    window.removeEventListener(ADMIN_EVENT_UPDATED, callback);
  };
}

