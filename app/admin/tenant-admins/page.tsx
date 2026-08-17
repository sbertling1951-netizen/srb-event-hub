"use client";

import { useEffect, useMemo, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { AppButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Page } from "@/components/ui/Page";
import { useAdmin } from "@/lib/adminContext";
import { supabase } from "@/lib/supabase";
import {
  listTenantAdminAccess,
  setTenantAdminAccess,
  type TenantAdminAccessRow,
} from "@/lib/tenantAdminAccess";

type TenantRow = {
  id: string;
  display_name: string;
};

type AdminUserRow = {
  id: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  privilege_group: string | null;
};

function describeTenantAdminError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  if (/caller is not an active super_admin/i.test(message)) {
    return "Platform Administrator authority is required to manage Tenant Admin assignments.";
  }
  return `Request failed: ${message}`;
}

function TenantAdminsPageInner() {
  const { admin } = useAdmin();
  const isSuperAdmin = !!admin?.isSuperAdmin;
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [selectedAdminUserId, setSelectedAdminUserId] = useState("");
  const [assignments, setAssignments] = useState<TenantAdminAccessRow[] | null>(null);
  const [loadingCatalogs, setLoadingCatalogs] = useState(true);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [busyAdminUserId, setBusyAdminUserId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removeAssignment, setRemoveAssignment] = useState<TenantAdminAccessRow | null>(null);

  useEffect(() => {
    if (!admin) {
      return;
    }
    if (!isSuperAdmin) {
      setError("Platform Administrator authority is required to view Tenant Admin assignments.");
      setLoadingCatalogs(false);
      return;
    }

    void (async () => {
      setLoadingCatalogs(true);
      setError(null);
      const [tenantResult, adminResult] = await Promise.all([
        supabase
          .from("tenants")
          .select("id,display_name")
          .eq("is_active", true)
          .order("display_name"),
        supabase
          .from("admin_users")
          .select("id,email,display_name,is_active,privilege_group")
          .order("email"),
      ]);

      if (tenantResult.error || adminResult.error) {
        setError(
          tenantResult.error?.message ||
            adminResult.error?.message ||
            "Could not load Tenant Admin assignment choices.",
        );
        setTenants([]);
        setAdminUsers([]);
      } else {
        setTenants((tenantResult.data || []) as TenantRow[]);
        setAdminUsers((adminResult.data || []) as AdminUserRow[]);
      }
      setLoadingCatalogs(false);
    })();
  }, [admin, isSuperAdmin]);

  async function loadAssignments(tenantId: string) {
    if (!tenantId) {
      setAssignments(null);
      return;
    }

    setLoadingAssignments(true);
    setError(null);
    setStatus("");
    try {
      setAssignments(await listTenantAdminAccess(tenantId));
    } catch (loadError) {
      setAssignments(null);
      setError(describeTenantAdminError(loadError));
    } finally {
      setLoadingAssignments(false);
    }
  }

  function handleTenantChange(tenantId: string) {
    setSelectedTenantId(tenantId);
    setSelectedAdminUserId("");
    void loadAssignments(tenantId);
  }

  const activeAssignments = useMemo(
    () => (assignments || []).filter((assignment) => assignment.is_active),
    [assignments],
  );
  const activeAssignedAdminIds = useMemo(
    () => new Set(activeAssignments.map((assignment) => assignment.admin_user_id)),
    [activeAssignments],
  );
  const eligibleAdmins = useMemo(
    () => adminUsers.filter(
      (candidate) =>
        candidate.is_active &&
        candidate.privilege_group !== "super_admin" &&
        !activeAssignedAdminIds.has(candidate.id),
    ),
    [activeAssignedAdminIds, adminUsers],
  );
  const adminById = useMemo(
    () => new Map(adminUsers.map((candidate) => [candidate.id, candidate])),
    [adminUsers],
  );
  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId) || null;

  async function assignTenantAdmin() {
    if (!selectedTenantId || !selectedAdminUserId) {
      setError("Select a Tenant and an eligible Admin user.");
      return;
    }

    const candidate = adminById.get(selectedAdminUserId);
    if (!candidate?.is_active || candidate.privilege_group === "super_admin") {
      setError("Select an active non-Platform Admin user.");
      return;
    }

    setBusyAdminUserId(selectedAdminUserId);
    setError(null);
    setStatus("Assigning Tenant Admin access...");
    try {
      await setTenantAdminAccess(selectedAdminUserId, selectedTenantId, true);
      setSelectedAdminUserId("");
      await loadAssignments(selectedTenantId);
      setStatus(`${candidate.display_name || candidate.email} now has Tenant Admin authority for ${selectedTenant?.display_name || "this Tenant"}.`);
    } catch (assignmentError) {
      setError(describeTenantAdminError(assignmentError));
      setStatus("");
    } finally {
      setBusyAdminUserId(null);
    }
  }

  async function confirmRemoval() {
    if (!removeAssignment || !selectedTenantId) {
      return;
    }

    const assignment = removeAssignment;
    const assignedAdmin = adminById.get(assignment.admin_user_id);
    setBusyAdminUserId(assignment.admin_user_id);
    setError(null);
    setStatus("Removing Tenant Admin access...");
    try {
      await setTenantAdminAccess(assignment.admin_user_id, selectedTenantId, false);
      setRemoveAssignment(null);
      await loadAssignments(selectedTenantId);
      setStatus(`${assignedAdmin?.display_name || assignedAdmin?.email || "Admin user"} no longer has Tenant Admin authority for ${selectedTenant?.display_name || "this Tenant"}.`);
    } catch (removalError) {
      setError(describeTenantAdminError(removalError));
      setStatus("");
    } finally {
      setBusyAdminUserId(null);
    }
  }

  return (
    <Page style={{ display: "grid", gap: 18 }}>
      <ConfirmDialog
        open={!!removeAssignment}
        title="Remove Tenant Admin Access"
        message={`Remove ${adminById.get(removeAssignment?.admin_user_id || "")?.display_name || adminById.get(removeAssignment?.admin_user_id || "")?.email || "this Admin user"} as a Tenant Admin for ${selectedTenant?.display_name || "this Tenant"}? Event-specific assignments are not changed.`}
        confirmLabel="Remove Access"
        danger
        busy={!!busyAdminUserId}
        onCancel={() => setRemoveAssignment(null)}
        onConfirm={confirmRemoval}
      />

      <div className="card" role="note">
        <strong>Authority scope</strong>
        <p style={{ marginBottom: 0 }}>
          Platform Administrators govern every Tenant. A Tenant Admin governs one selected Tenant and its Events. Event Admin assignments remain Event-specific and are managed in Event Staff.
        </p>
      </div>

      {error ? <div role="alert" style={errorStyle}>{error}</div> : null}
      {status ? <div role="status" style={successStyle}>{status}</div> : null}

      {!isSuperAdmin ? null : (
        <>
          <div className="card">
            <label htmlFor="tenant-admin-tenant" style={labelStyle}>Tenant</label>
            <select
              id="tenant-admin-tenant"
              value={selectedTenantId}
              onChange={(event) => handleTenantChange(event.target.value)}
              disabled={loadingCatalogs}
              style={inputStyle}
            >
              <option value="">Select a Tenant...</option>
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>{tenant.display_name}</option>
              ))}
            </select>
          </div>

          {selectedTenantId ? (
            <div className="card" style={{ display: "grid", gap: 12 }}>
              <h2 style={{ margin: 0 }}>Assign Tenant Admin</h2>
              <label htmlFor="tenant-admin-user" style={labelStyle}>Eligible Admin user</label>
              <select
                id="tenant-admin-user"
                value={selectedAdminUserId}
                onChange={(event) => setSelectedAdminUserId(event.target.value)}
                disabled={loadingAssignments || !!busyAdminUserId}
                style={inputStyle}
              >
                <option value="">Select an Admin user...</option>
                {eligibleAdmins.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.display_name || candidate.email}{candidate.display_name ? ` • ${candidate.email}` : ""}
                  </option>
                ))}
              </select>
              {assignments !== null && eligibleAdmins.length === 0 ? (
                <div style={mutedStyle}>No eligible active Admin users remain for this Tenant.</div>
              ) : null}
              <div>
                <AppButton
                  variant="primary"
                  onClick={() => void assignTenantAdmin()}
                  disabled={!selectedAdminUserId || !!busyAdminUserId}
                >
                  {busyAdminUserId === selectedAdminUserId ? "Assigning..." : "Assign Tenant Admin"}
                </AppButton>
              </div>
            </div>
          ) : null}

          {selectedTenantId ? (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Current Tenant Admins</h2>
              {loadingAssignments ? (
                <div role="status">Loading Tenant Admin assignments...</div>
              ) : assignments === null ? null : activeAssignments.length === 0 ? (
                <div style={mutedStyle}>No Tenant Admins are currently assigned to this Tenant.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {activeAssignments.map((assignment) => {
                    const assignedAdmin = adminById.get(assignment.admin_user_id);
                    return (
                      <div key={assignment.id} style={assignmentStyle}>
                        <div style={{ minWidth: 0 }}>
                          <strong>{assignedAdmin?.display_name || assignedAdmin?.email || "Unavailable Admin user"}</strong>
                          {assignedAdmin?.display_name ? <div style={mutedStyle}>{assignedAdmin.email}</div> : null}
                          <div style={mutedStyle}>Tenant-scoped authority</div>
                        </div>
                        <AppButton
                          variant="danger"
                          onClick={() => setRemoveAssignment(assignment)}
                          disabled={!!busyAdminUserId}
                        >
                          Remove Access
                        </AppButton>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </>
      )}
    </Page>
  );
}

const labelStyle = { display: "block", fontWeight: 700, marginBottom: 6 };
const inputStyle = { width: "min(100%, 520px)", padding: "10px 12px", boxSizing: "border-box" as const };
const mutedStyle = { color: "#64748b", fontSize: 13, overflowWrap: "anywhere" as const };
const errorStyle = { padding: 12, border: "1px solid #fecaca", borderRadius: 8, background: "#fef2f2", color: "#991b1b" };
const successStyle = { padding: 12, border: "1px solid #bbf7d0", borderRadius: 8, background: "#f0fdf4", color: "#166534" };
const assignmentStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" as const, padding: 12, border: "1px solid #e2e8f0", borderRadius: 8 };

export default function TenantAdminsPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_admins">
      <AdminShellAdapter
        pageTitle="Tenant Admin Access"
        backTarget={{ href: "/admin/admin-users", label: "Admin Users" }}
      >
        <TenantAdminsPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}