"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAdmin } from "@/lib/adminContext";
import { hasPermission } from "@/lib/getCurrentAdminAccess";

type Props = {
  children: React.ReactNode;
  requiredPermission?: string;
  fallbackPath?: string;
};

export default function AdminRouteGuard({
  children,
  requiredPermission,
  fallbackPath = "/admin/login",
}: Props) {
  const router = useRouter();
  const { admin, loading } = useAdmin();

  const userId = admin?.adminUser?.user_id ?? null;

  useEffect(() => {
    if (!loading && !userId) {
      router.replace(fallbackPath);
    }
  }, [loading, userId, fallbackPath, router]);

  if (loading) {
    return null;
  }

  if (!userId) {
    return null;
  }

  if (requiredPermission && !hasPermission(admin, requiredPermission)) {
    return <div style={{ padding: 24 }}>No permission</div>;
  }

  return <>{children}</>;
}
