"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAdmin } from "@/lib/adminContext";
import {
  type AdminTaskAuthorityResult,
  checkAdminEventTaskAuthority,
} from "@/lib/adminTaskAuthority";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { hasPermission } from "@/lib/getCurrentAdminAccess";

type Props = {
  children: React.ReactNode;
  requiredPermission?: string;
  requiredTask?: string;
  fallbackPath?: string;
};

export default function AdminRouteGuard({
  children,
  requiredPermission,
  requiredTask,
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

  return <>{children}</>;
}
