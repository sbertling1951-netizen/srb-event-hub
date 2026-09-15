"use client";

import { useEffect, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useShellInterfaceCapabilities } from "@/components/shell/useShellViewport";
import { DataTable, ResponsiveList } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Checkbox, Field, Input } from "@/components/ui/Field";
import { LoadingState } from "@/components/ui/LoadingState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAdmin } from "@/lib/adminContext";
import { supabase } from "@/lib/supabase";

// Agenda Categories Governance Stage 2: page access is gated by the
// canonical Platform capability (admin.isSuperAdmin mirrors the DB-side
// public.has_platform_admin_authority check -- both resolve to
// privilege_group === "super_admin"), not the legacy can_manage_agenda
// permission string. Actual mutation authority is still enforced
// server-side by the governed RPCs regardless of what this flag shows.
function mapCategoryRpcError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : "";
  switch (message) {
    case "unauthorized":
      return "You do not have Platform authority to manage the Agenda category vocabulary.";
    case "duplicate_category_name":
      return "A category with that name already exists.";
    case "category_not_found":
      return "That category no longer exists. Reload and try again.";
    case "invalid_name":
      return "Category name cannot be empty.";
    default:
      return message || fallback;
  }
}

function AgendaCategoriesPageInner() {
  const { admin } = useAdmin();
  const isSuperAdmin = !!admin?.isSuperAdmin;
  const { isCompact } = useShellInterfaceCapabilities();

  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<any[]>([]);
  const [errorMessage, setErrorMessage] = useState("");

  const [showDialog, setShowDialog] = useState(false);
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState("#4f46e5");
  const [formSortOrder, setFormSortOrder] = useState(100);
  const [formActive, setFormActive] = useState(true);
  const [formDefault, setFormDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);

  async function loadCategories() {
    setLoading(true);
    setErrorMessage("");

    const { data, error } = await supabase
      .from("agenda_categories")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) {
      setErrorMessage(error.message);
    } else {
      setCategories(data ?? []);
    }

    setLoading(false);
  }

  async function saveCategory() {
    setSaving(true);
    setErrorMessage("");
    try {
      if (editingCategoryId) {
        const { error } = await supabase.rpc("update_agenda_category", {
          p_id: editingCategoryId,
          p_name: formName,
          p_color: formColor,
          p_sort_order: formSortOrder,
          p_is_default: formDefault,
          p_is_active: formActive,
        });

        if (error) {
          setErrorMessage(mapCategoryRpcError(error, "Could not update category."));
        } else {
          setShowDialog(false);
          setEditingCategoryId(null);
          setFormName("");
          setFormColor("#4f46e5");
          setFormSortOrder(100);
          setFormActive(true);
          setFormDefault(false);
          await loadCategories();
        }
      } else {
        const { error } = await supabase.rpc("create_agenda_category", {
          p_name: formName,
          p_color: formColor,
          p_sort_order: formSortOrder,
          p_is_default: formDefault,
          p_is_active: formActive,
        });

        if (error) {
          setErrorMessage(mapCategoryRpcError(error, "Could not create category."));
        } else {
          setShowDialog(false);
          setFormName("");
          setFormColor("#4f46e5");
          setFormSortOrder(100);
          setFormActive(true);
          setFormDefault(false);
          await loadCategories();
        }
      }
    } catch (err: any) {
      setErrorMessage(mapCategoryRpcError(err, "An error occurred"));
    } finally {
      setSaving(false);
    }
  }

  function openEditDialog(category: any) {
    setEditingCategoryId(category.id);
    setFormName(category.name);
    setFormColor(category.color);
    setFormSortOrder(category.sort_order ?? 100);
    setFormActive(category.is_active);
    setFormDefault(category.is_default);
    setShowDialog(true);
  }

  useEffect(() => {
    loadCategories();
  }, []);

  // Shared per-category rendering, reused by both the desktop DataTable
  // cells and the compact-viewport ResponsiveList item below so the two
  // presentations can never drift out of sync with each other.
  function renderColorValue(category: any) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            backgroundColor: category.color,
            border: "1px solid #ccc",
          }}
        />
        <span>{category.color}</span>
      </div>
    );
  }

  function renderActiveBadge(category: any) {
    return (
      <StatusBadge tone={category.is_active ? "success" : "neutral"}>
        {category.is_active ? "Active" : "Inactive"}
      </StatusBadge>
    );
  }

  function renderDefaultValue(category: any) {
    return category.is_default ? "⭐ Default" : "";
  }

  function renderCategoryActions(category: any) {
    if (!isSuperAdmin) {
      return null;
    }
    return (
      <button
        onClick={() => openEditDialog(category)}
        style={{
          backgroundColor: "#64748b",
          color: "white",
          border: "none",
          borderRadius: 6,
          padding: "6px 12px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Edit
      </button>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <p style={{ marginTop: 0 }}>Manage agenda categories used throughout the event.</p>
      {!isSuperAdmin && (
        <p style={{ color: "#92400e", background: "#fef3c7", padding: "8px 12px", borderRadius: 6, marginBottom: 16 }}>
          You can view the Agenda category vocabulary, but only a Platform admin can create, edit, or deactivate categories.
        </p>
      )}
      {errorMessage && (
        <p style={{ color: "red", marginBottom: 16 }}>{errorMessage}</p>
      )}

      {isSuperAdmin && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
          <button
            onClick={() => {
              setEditingCategoryId(null);
              setFormName("");
              setFormColor("#4f46e5");
              setFormSortOrder(100);
              setFormActive(true);
              setFormDefault(false);
              setShowDialog(true);
            }}
            style={{
              backgroundColor: "#64748b",
              color: "white",
              border: "none",
              borderRadius: 6,
              padding: "8px 16px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            + New Category
          </button>
        </div>
      )}

      {loading ? (
        <LoadingState message="Loading categories..." />
      ) : categories.length === 0 ? (
        <EmptyState message="No categories yet." />
      ) : isCompact ? (
        <ResponsiveList aria-label="Agenda categories">
          {categories.map((category) => (
            <li key={category.id} className="responsive-list-item">
              <div className="responsive-list-item-header">
                <div className="responsive-list-item-title">{category.name}</div>
                {renderActiveBadge(category)}
              </div>

              <div className="responsive-list-item-meta">{renderColorValue(category)}</div>

              {category.is_default ? (
                <div className="responsive-list-item-meta">{renderDefaultValue(category)}</div>
              ) : null}

              {isSuperAdmin ? renderCategoryActions(category) : null}
            </li>
          ))}
        </ResponsiveList>
      ) : (
        <DataTable caption="Agenda categories">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Color</th>
              <th scope="col">Active</th>
              <th scope="col">Default</th>
              {isSuperAdmin && <th scope="col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category.id}>
                <td>
                  <div className="data-table-cell-primary">{category.name}</div>
                </td>
                <td>{renderColorValue(category)}</td>
                <td>{renderActiveBadge(category)}</td>
                <td>{renderDefaultValue(category)}</td>
                {isSuperAdmin && <td>{renderCategoryActions(category)}</td>}
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      {showDialog && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: "white",
              padding: 24,
              borderRadius: 8,
              border: "1px solid #dbe4ef",
              width: 400,
              boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
            }}
          >
            <h2 style={{ marginTop: 0, color: "#334155" }}>{editingCategoryId ? "Edit Category" : "New Category"}</h2>
            <div style={{ marginBottom: 12 }}>
              <Field label="Category Name" required>
                {(props) => (
                  <Input
                    {...props}
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <div style={{ marginBottom: 12 }}>
              <Field label="Color" help={formColor}>
                {(props) => (
                  <Input
                    {...props}
                    type="color"
                    value={formColor}
                    onChange={(e) => setFormColor(e.target.value)}
                    style={{ width: "100%", height: 30, minHeight: 30, padding: 0, border: "none" }}
                  />
                )}
              </Field>
            </div>

            <div style={{ marginBottom: 12 }}>
              <Checkbox
                checked={formActive}
                onChange={(e) => setFormActive(e.target.checked)}
                label="Active"
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <Checkbox
                checked={formDefault}
                onChange={(e) => setFormDefault(e.target.checked)}
                label="Default Category"
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setShowDialog(false)}
                disabled={saving}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#f8fafc",
                  color: "#334155",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveCategory}
                disabled={saving || formName.trim() === ""}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "1px solid #64748b",
                  backgroundColor: "#64748b",
                  color: "white",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AgendaCategoriesPage() {
  return (
    <AdminRouteGuard>
      <AdminShellAdapter
        pageTitle="Agenda Categories"
        backTarget={{ href: "/admin/agenda", label: "Agenda" }}
      >
        <AgendaCategoriesPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}
