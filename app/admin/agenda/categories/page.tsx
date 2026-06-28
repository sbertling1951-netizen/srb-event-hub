"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

export default function AgendaCategoriesPage() {
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
      if (formDefault) {
        const { error: updateError } = await supabase
          .from("agenda_categories")
          .update({ is_default: false })
          .eq("is_default", true);
        if (updateError) {
          setErrorMessage(updateError.message);
          setSaving(false);
          return;
        }
      }

      if (editingCategoryId) {
        // Update existing category
        const { error: updateError } = await supabase
          .from("agenda_categories")
          .update({
            name: formName,
            color: formColor,
            sort_order: formSortOrder,
            is_active: formActive,
            is_default: formDefault,
          })
          .eq("id", editingCategoryId);

        if (updateError) {
          setErrorMessage(updateError.message);
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
        // Insert new category
        const { error: insertError } = await supabase.from("agenda_categories").insert([
          {
            name: formName,
            color: formColor,
            sort_order: formSortOrder,
            is_active: formActive,
            is_default: formDefault,
          },
        ]);

        if (insertError) {
          setErrorMessage(insertError.message);
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
      setErrorMessage(err.message || "An error occurred");
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
      {errorMessage && (
        <p style={{ color: "red", marginBottom: 16 }}>{errorMessage}</p>
      )}

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
              <th align="left">Actions</th>
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
