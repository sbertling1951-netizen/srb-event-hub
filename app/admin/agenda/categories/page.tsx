"use client";

import { useEffect, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
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

  return (
    <div style={{ padding: 24 }}>
      <h1>Agenda Categories</h1>
      <p>Manage agenda categories used throughout the event.</p>
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
        <p>Loading...</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">Name</th>
              <th align="left">Color</th>
              <th align="left">Active</th>
              <th align="left">Default</th>
              {isSuperAdmin && <th align="left">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category.id}>
                <td>{category.name}</td>
                <td>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
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
                </td>
                <td>
                  {category.is_active ? (
                    <span
                      style={{
                        backgroundColor: "#22c55e",
                        color: "white",
                        padding: "2px 8px",
                        borderRadius: 9999,
                        fontSize: 12,
                        fontWeight: 600,
                        display: "inline-block",
                        minWidth: 60,
                        textAlign: "center",
                      }}
                    >
                      Active
                    </span>
                  ) : (
                    <span
                      style={{
                        backgroundColor: "#9ca3af",
                        color: "white",
                        padding: "2px 8px",
                        borderRadius: 9999,
                        fontSize: 12,
                        fontWeight: 600,
                        display: "inline-block",
                        minWidth: 60,
                        textAlign: "center",
                      }}
                    >
                      Inactive
                    </span>
                  )}
                </td>
                <td>{category.is_default ? "⭐ Default" : ""}</td>
                {isSuperAdmin && (
                  <td>
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
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
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
              <label>
                Category Name<br />
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  style={{ width: "100%" }}
                />
              </label>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label>
                Color<br />
                <input
                  type="color"
                  value={formColor}
                  onChange={(e) => setFormColor(e.target.value)}
                  style={{ width: "100%", height: 30, padding: 0, border: "none" }}
                />
                <div style={{ marginTop: 4, fontSize: 12, color: "#666" }}>
                  {formColor}
                </div>
              </label>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label>
                <input
                  type="checkbox"
                  checked={formActive}
                  onChange={(e) => setFormActive(e.target.checked)}
                />{" "}
                Active
              </label>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label>
                <input
                  type="checkbox"
                  checked={formDefault}
                  onChange={(e) => setFormDefault(e.target.checked)}
                />{" "}
                Default Category
              </label>
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
      <AgendaCategoriesPageInner />
    </AdminRouteGuard>
  );
}
