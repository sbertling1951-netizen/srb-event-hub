"use client";

import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { flushSync } from "react-dom";

import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { AppLinkButton } from "@/components/ui/AppButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAdmin } from "@/lib/adminContext";
import { clearCurrentAdminEvent, getCurrentAdminEvent, subscribeToAdminEventChange } from "@/lib/adminEventContext";
import { listMyTenantAdminAccess } from "@/lib/adminTenantAuthority";
import { type AdminTenantChoice, canEnterAdminTenantWorkspace, readAdminTenantSelection, resolveAdminTenantSelection, writeAdminTenantSelection } from "@/lib/adminTenantContext";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { supabase } from "@/lib/supabase";
import { listTenantsForAdministration } from "@/lib/tenantAdministration";

type Workspace = {
  choices: AdminTenantChoice[];
  tenant: AdminTenantChoice | null;
  loading: boolean;
  error: string | null;
  checkedPath: string;
  checkedUserId: string | null;
  checkedEventId: string | null;
  eventValid: boolean;
  switchTenant: (id: string) => void;
};
const Context = createContext<Workspace | null>(null);
export function useAdminTenantWorkspace() { return useContext(Context); }

const PLATFORM_ROUTES = new Set([
  "/admin/tenants", "/admin/tenant-admins", "/admin/admin", "/admin/admin-users",
  "/admin/permissions", "/admin/passport-refunds", "/admin/master-maps",
]);
const EVENT_CHOICE_ROUTES = new Set(["/admin/dashboard", "/admin/events", "/admin/events/new"]);

export function AdminTenantWorkspaceProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const { admin, loading: adminLoading } = useAdmin();
  const userId = admin?.adminUser.user_id ?? null;
  const [state, setState] = useState<Omit<Workspace, "switchTenant">>({ choices: [], tenant: null, loading: true, error: null, checkedPath: "", checkedUserId: null, checkedEventId: null, eventValid: false });
  const [eventId, setEventId] = useState(() => getCurrentAdminEvent()?.id ?? null);
  useEffect(() => subscribeToAdminEventChange(() => setEventId(getCurrentAdminEvent()?.id ?? null)), []);
  const isAdminRoute = pathname.startsWith("/admin") && pathname !== "/admin/login";

  useEffect(() => {
    if (!isAdminRoute || adminLoading || !userId || !admin) { return; }
    let active = true;
    setState({ choices: [], tenant: null, loading: true, error: null, checkedPath: "", checkedUserId: null, checkedEventId: null, eventValid: false });
    void (async () => {
      try {
        // RLS owns effective Event authority. Only minimal ownership data is
        // read here, never another Tenant's operational records.
        const events = await supabase.from("events").select("id,tenant_id");
        if (events.error) { throw events.error; }
        let choices: AdminTenantChoice[];
        if (admin.isSuperAdmin) {
          choices = (await listTenantsForAdministration()).map((row) => ({ id: row.id, name: row.display_name, isActive: row.is_active }));
        } else {
          const appointments = await listMyTenantAdminAccess();
          const ids = [...new Set([...appointments.map((row) => row.tenant_id), ...(events.data ?? []).map((row) => row.tenant_id as string)])];
          const tenants = ids.length ? await supabase.from("tenants").select("id,display_name,is_active").in("id", ids).eq("is_active", true) : { data: [], error: null };
          if (tenants.error) { throw tenants.error; }
          choices = (tenants.data ?? []).map((row) => ({ id: row.id, name: row.display_name, isActive: row.is_active }));
        }
        const event = getCurrentAdminEvent();
        const ownerId = (events.data ?? []).find((row) => row.id === event?.id)?.tenant_id ?? null;
        const tenant = resolveAdminTenantSelection(choices, userId, readAdminTenantSelection(), ownerId);
        if (!active) { return; }
        if (tenant) { writeAdminTenantSelection(userId, tenant.id); }
        const valid = !!tenant && (!event || ownerId === tenant.id);
        if (event && !valid) { clearCurrentAdminEvent(); }
        setState({ choices, tenant, loading: false, error: null, checkedPath: pathname, checkedUserId: userId, checkedEventId: eventId, eventValid: valid && !!event });
      } catch (error) {
        if (active) { setState({ choices: [], tenant: null, loading: false, error: error instanceof Error ? error.message : "Could not verify tenant access.", checkedPath: pathname, checkedUserId: userId, checkedEventId: eventId, eventValid: false }); }
      }
    })();
    return () => { active = false; };
  }, [isAdminRoute, pathname, adminLoading, userId, admin, eventId]);

  useEffect(() => {
    if (!isAdminRoute) { return; }
    const changed = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.adminTenantContext || event.key === null) {
        // Unmount old-Tenant pages immediately; reload also retires every
        // in-flight page result. The switch confirmation covers open tabs.
        flushSync(() => setState((current) => ({ ...current, loading: true })));
        window.location.reload();
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [isAdminRoute]);

  const switchTenant = (id: string) => {
    if (!userId || !state.choices.some((choice) => choice.id === id) || id === state.tenant?.id) { return; }
    // The explicit switch confirmation authorizes leaving the current
    // draft. Unmount it before navigation so old async callbacks cannot land.
    flushSync(() => setState((current) => ({ ...current, loading: true })));
    writeAdminTenantSelection(userId, id);
    clearCurrentAdminEvent();
    window.location.assign("/admin/dashboard");
  };
  const platformPage = !!admin?.isSuperAdmin && (PLATFORM_ROUTES.has(pathname) || pathname.startsWith("/admin/master-maps/"));
  const checking = adminLoading || state.loading || state.checkedPath !== pathname || state.checkedUserId !== userId || state.checkedEventId !== eventId;
  const blocked = isAdminRoute && (adminLoading || (!!userId && (checking || !!state.error || !canEnterAdminTenantWorkspace({ platformPage, tenant: state.tenant, eventChoicePage: EVENT_CHOICE_ROUTES.has(pathname), eventValid: state.eventValid }))));
  let message = "Choose a tenant to begin.";
  if (checking) { message = "Checking tenant access…"; }
  else if (state.error) { message = "Could not verify tenant access. Refresh to try again."; }
  else if (state.tenant && !state.tenant.isActive) { message = `${state.tenant.name} is inactive. Operational tools are unavailable. Platform administrators can inspect its settings in Tenant Administration.`; }
  else if (state.tenant) { message = `No working event selected for ${state.tenant.name}. Choose an event from Event Admin. If this tenant has no events, its event tools remain empty.`; }

  return <Context.Provider value={{ ...state, loading: checking, eventValid: !checking && state.eventValid, switchTenant }}>
    {blocked ? <AdminShellAdapter pageTitle="Tenant workspace"><EmptyState message={message} />
      {!state.loading && !state.error && state.tenant?.isActive ? <AppLinkButton href="/admin/events">Event Admin</AppLinkButton> : null}
      {!state.loading && admin?.isSuperAdmin ? <AppLinkButton href="/admin/tenants">Tenant Administration</AppLinkButton> : null}
    </AdminShellAdapter> : children}
  </Context.Provider>;
}
