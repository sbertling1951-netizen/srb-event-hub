"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAdmin } from "@/lib/adminContext";
import {
  type AdminTaskAuthorityResult,
  checkAdminEventTaskAuthority,
} from "@/lib/adminTaskAuthority";
import {
  type AdminTenantAuthorityResult,
  checkAdminTenantAuthority,
} from "@/lib/adminTenantAuthority";
import {
  type AdminVendorCatalogAuthorityResult,
  checkAdminVendorCatalogAuthority,
} from "@/lib/adminVendorCatalogAuthority";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { hasPermission } from "@/lib/getCurrentAdminAccess";

type Props = {
  children: React.ReactNode;
  requiredPermission?: string;
  requiredTask?: string;
  requiredTenantAuthority?: boolean;
  requiredVendorCatalogAuthority?: boolean;
  requiredPlatformAuthority?: boolean;
  fallbackPath?: string;
};

export default function AdminRouteGuard({
  children,
  requiredPermission,
  requiredTask,
  requiredTenantAuthority,
  requiredVendorCatalogAuthority,
  requiredPlatformAuthority,
  fallbackPath = "/admin/login",
}: Props) {
  const router = useRouter();
  const { admin, loading } = useAdmin();

  const userId = admin?.adminUser?.user_id ?? null;

  // requiredTask only. null = checking (or not yet started) -- never a
  // stale prior result. A "generation" counter, not just the latest
  // state, guards against an in-flight check for a since-abandoned
  // Event resolving after a newer check has already started: only the
  // response matching the generation that is still current is applied,
  // so a slow Event A response can never overwrite Event B's outcome.
  const [taskAuthority, setTaskAuthority] =
    useState<AdminTaskAuthorityResult | null>(null);
  const checkGeneration = useRef(0);

  const runTaskCheck = useCallback(() => {
    if (!requiredTask) {
      return;
    }

    const generation = ++checkGeneration.current;
    const eventId = getCurrentAdminEvent()?.id ?? null;

    // Reset before the async check resolves: a prior Event's "allowed"
    // must never remain rendered while the new Event's authority is
    // still unresolved. This never selects, resolves, or changes the
    // Event itself -- it only reads the already-established context.
    setTaskAuthority(eventId ? null : { status: "no_event" });

    if (!eventId) {
      return;
    }

    void checkAdminEventTaskAuthority(requiredTask, eventId).then((result) => {
      if (checkGeneration.current === generation) {
        setTaskAuthority(result);
      }
    });
  }, [requiredTask]);

  // requiredTenantAuthority only. null = checking (or not yet started) --
  // never a stale prior result, same discipline as taskAuthority above.
  // This has no Event dimension at all: the Admin working-Event context
  // is never read by this block, and it is never re-checked on Admin
  // working-Event change (deliberately no subscribeToAdminWorkspace
  // subscription below, unlike requiredTask) -- checkAdminTenantAuthority
  // answers a coarse, Tenant-agnostic, session-scoped question that does
  // not depend on which Event is currently selected. It re-runs only
  // when the authenticated Admin identity itself changes (userId).
  const [tenantAuthority, setTenantAuthority] =
    useState<AdminTenantAuthorityResult | null>(null);
  const tenantCheckGeneration = useRef(0);

  const runTenantCheck = useCallback(() => {
    if (!requiredTenantAuthority) {
      return;
    }

    const generation = ++tenantCheckGeneration.current;

    // Reset before the async check resolves: a prior session's
    // "allowed" must never remain rendered while the new session's
    // authority is still unresolved, same anti-race discipline as
    // runTaskCheck.
    setTenantAuthority(null);

    void checkAdminTenantAuthority().then((result) => {
      if (tenantCheckGeneration.current === generation) {
        setTenantAuthority(result);
      }
    });
  }, [requiredTenantAuthority]);

  // requiredVendorCatalogAuthority only. null = checking (or not yet
  // started) -- never a stale prior result, same discipline as
  // tenantAuthority above. This has no Event dimension and no Tenant
  // dimension at all: Vendor Catalog administration (vendor-org/catalog
  // access) is neither Event-scoped nor Tenant-scoped, so this is never
  // re-checked on Admin working-Event change (no subscribeToAdminWorkspace
  // subscription below, matching requiredTenantAuthority's own
  // discipline). It re-runs only when the authenticated Admin identity
  // itself changes (userId).
  const [vendorCatalogAuthority, setVendorCatalogAuthority] =
    useState<AdminVendorCatalogAuthorityResult | null>(null);
  const vendorCatalogCheckGeneration = useRef(0);

  const runVendorCatalogCheck = useCallback(() => {
    if (!requiredVendorCatalogAuthority) {
      return;
    }

    const generation = ++vendorCatalogCheckGeneration.current;

    // Reset before the async check resolves: a prior session's
    // "allowed" must never remain rendered while the new session's
    // authority is still unresolved, same anti-race discipline as
    // runTenantCheck.
    setVendorCatalogAuthority(null);

    void checkAdminVendorCatalogAuthority().then((result) => {
      if (vendorCatalogCheckGeneration.current === generation) {
        setVendorCatalogAuthority(result);
      }
    });
  }, [requiredVendorCatalogAuthority]);

  useEffect(() => {
    if (!loading && !userId) {
      router.replace(fallbackPath);
    }
  }, [loading, userId, fallbackPath, router]);

  // Re-checked on every Admin working-Event change (ADR-006's own
  // change-notification mechanism), the same subscription
  // app/admin/slideshow/page.tsx and app/admin/engagement/page.tsx
  // already use to react to Event switches.
  useEffect(() => {
    if (!requiredTask || !userId) {
      return;
    }

    runTaskCheck();

    return subscribeToAdminWorkspace(runTaskCheck);
  }, [requiredTask, userId, runTaskCheck]);

  useEffect(() => {
    if (!requiredTenantAuthority || !userId) {
      return;
    }

    runTenantCheck();
  }, [requiredTenantAuthority, userId, runTenantCheck]);

  useEffect(() => {
    if (!requiredVendorCatalogAuthority || !userId) {
      return;
    }

    runVendorCatalogCheck();
  }, [requiredVendorCatalogAuthority, userId, runVendorCatalogCheck]);

  if (loading) {
    return null;
  }

  if (!userId) {
    return null;
  }

  if (requiredPermission && !hasPermission(admin, requiredPermission)) {
    return <div style={{ padding: 24 }}>No permission</div>;
  }

  if (requiredTask) {
    if (taskAuthority === null) {
      return null;
    }

    if (taskAuthority.status === "no_event") {
      return <div style={{ padding: 24 }}>No admin working event selected.</div>;
    }

    if (taskAuthority.status !== "allowed") {
      return <div style={{ padding: 24 }}>No permission</div>;
    }
  }

  if (requiredTenantAuthority) {
    if (tenantAuthority === null) {
      return null;
    }

    if (tenantAuthority.status !== "allowed") {
      return <div style={{ padding: 24 }}>No permission</div>;
    }
  }

  if (requiredVendorCatalogAuthority) {
    if (vendorCatalogAuthority === null) {
      return null;
    }

    if (vendorCatalogAuthority.status !== "allowed") {
      return <div style={{ padding: 24 }}>No permission</div>;
    }
  }

  if (requiredPlatformAuthority && !admin?.isSuperAdmin) {
    return <div style={{ padding: 24 }}>No permission</div>;
  }

  return <>{children}</>;
}
