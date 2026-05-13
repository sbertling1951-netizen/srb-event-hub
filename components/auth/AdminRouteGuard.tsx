"use client";

import { useRouter } from "next/navigation";

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

  if (loading) {
    return <div style={{ padding: 24 }}>Checking access...</div>;
  }

  if (!admin?.adminUser?.user_id) {
    router.replace(fallbackPath);
    return null;
  }

  if (requiredPermission && !hasPermission(admin, requiredPermission)) {
    return <div style={{ padding: 24 }}>No permission</div>;
  }

  return <>{children}</>;
}
