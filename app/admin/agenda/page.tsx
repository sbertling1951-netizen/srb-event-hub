"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAdminEvent } from "@/lib/getAdminEvent";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";

type AgendaItem = {
  id: string;
  external_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  speaker: string | null;
  category: string | null;
  agenda_date: string | null;
  start_time: string | null;
  end_time: string | null;
  sort_order: number | null;
  is_published: boolean | null;
  source: string | null;
};

type ActiveEvent = {
  id: string;
  name: string;
};

type AgendaForm = {
  id: string;
  external_id: string;
  title: string;
  description: string;
  location: string;
  speaker: string;
  category: string;
  agenda_date: string;
  start_time: string;
  end_time: string;
  sort_order: string;
  is_published: boolean;
};

const emptyForm: AgendaForm = {
  id: "",
  external_id: "",
  title: "",
  description: "",
  location: "",
  speaker: "",
  category: "",
  agenda_date: "",
  start_time: "",
  end_time: "",
  sort_order: "",
  is_published: true,
};

function normalizeText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildExternalId(form: AgendaForm) {
  if (form.external_id.trim()) return form.external_id.trim();

  return [
    slugify(form.title || "agenda-item"),
    slugify(form.agenda_date || "no-date"),
    slugify(form.start_time || "no-time"),
  ].join("-");
}

function formatAgendaDate(value: string | null) {
  if (!value) return "No date";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatAgendaTime(start: string | null, end: string | null) {
  if (!start && !end) return "Time TBD";
  if (start && end) return `${start} – ${end}`;
  return start || end || "Time TBD";
}

function formFromItem(item: AgendaItem): AgendaForm {
  return {
    id: item.id,
    external_id: item.external_id || "",
    title: item.title || "",
    description: item.description || "",
    location: item.location || "",
    speaker: item.speaker || "",
    category: item.category || "",
    agenda_date: item.agenda_date || "",
    start_time: item.start_time || "",
    end_time: item.end_time || "",
    sort_order:
      item.sort_order === null || item.sort_order === undefined
        ? ""
        : String(item.sort_order),
    is_published: !!item.is_published,
  };
}

function moveItem<T>(arr: T[], fromIndex: number, toIndex: number) {
  const copy = [...arr];
  const [item] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, item);
  return copy;
}

function AdminAgendaPageInner() {
  const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [status, setStatus] = useState("Loading...");
  const [form, setForm] = useState<AgendaForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [filterCategory, setFilterCategory] = useState("All");
  const [draggedId, setDraggedId] = useState<string | null>(null);

  useEffect(() => {
    void loadPage();

    function handleStorage(e: StorageEvent) {
      if (e.key === "fcoc-admin-event-changed") {
        void loadPage();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  async function loadPage() {
    setStatus("Loading...");

    const adminEvent = getAdminEvent();

    if (!adminEvent?.id) {
      setActiveEvent(null);
      setItems([]);
      setStatus("No admin working event selected.");
      return;
    }

    const selectedEvent = {
      id: adminEvent.id,
      name: adminEvent.name || "Selected Event",
    };

    setActiveEvent(selectedEvent);

    const { data, error } = await supabase
      .from("agenda_items")
      .select(
        "id,external_id,title,description,location,speaker,category,agenda_date,start_time,end_time,sort_order,is_published,source",
      )
      .eq("event_id", selectedEvent.id)
      .order("agenda_date", { ascending: true, nullsFirst: false })
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("start_time", { ascending: true, nullsFirst: false })
      .order("title", { ascending: true });

    if (error) {
      setStatus(`Could not load agenda items: ${error.message}`);
      return;
    }

    setItems((data || []) as AgendaItem[]);
    setStatus(`Loaded ${(data || []).length} items for ${selectedEvent.name}.`);
  }

  async function saveItem() {
    if (!activeEvent?.id) {
      setStatus("No admin working event selected.");
      return;
    }

    if (!form.title.trim()) {
      setStatus("Enter a title.");
      return;
    }

    if (!form.agenda_date.trim()) {
      setStatus("Enter an agenda date.");
      return;
    }

    if (!form.start_time.trim()) {
      setStatus("Enter a start time.");
      return;
    }

    const externalId = buildExternalId(form);

    const payload = {
      event_id: activeEvent.id,
      external_id: externalId,
      title: form.title.trim(),
      description: normalizeText(form.description),
      location: normalizeText(form.location),
      speaker: normalizeText(form.speaker),
      category: normalizeText(form.category),
      agenda_date: form.agenda_date.trim(),
      start_time: form.start_time.trim(),
      end_time: normalizeText(form.end_time),
      sort_order: normalizeNumber(form.sort_order),
      is_published: form.is_published,
      source: form.id ? "admin" : "manual",
    };

    setSaving(true);

    try {
      if (form.id) {
        const { error } = await supabase
          .from("agenda_items")
          .update(payload)
          .eq("id", form.id);

        if (error) {
          setStatus(`Could not update agenda item: ${error.message}`);
          setSaving(false);
          return;
        }

        setStatus(`Updated "${form.title.trim()}".`);
      } else {
        const { data: existing, error: findError } = await supabase
          .from("agenda_items")
          .select("id")
          .eq("event_id", activeEvent.id)
          .eq("external_id", externalId)
          .maybeSingle();

        if (findError) {
          setStatus(`Could not check for duplicate item: ${findError.message}`);
          setSaving(false);
          return;
        }

        if (existing?.id) {
          setStatus(
            `An item with external_id "${externalId}" already exists. Edit that item or change the title/date/time.`,
          );
          setSaving(false);
          return;
        }

        const { error } = await supabase.from("agenda_items").insert(payload);

        if (error) {
          setStatus(`Could not add agenda item: ${error.message}`);
          setSaving(false);
          return;
        }

        setStatus(`Added "${form.title.trim()}".`);
      }

      setForm(emptyForm);
      await loadPage();
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(id: string) {
    const confirmed = window.confirm("Delete this agenda item?");
    if (!confirmed) return;

    const { error } = await supabase.from("agenda_items").delete().eq("id", id);

    if (error) {
      setStatus(`Could not delete item: ${error.message}`);
      return;
    }

    if (form.id === id) {
      setForm(emptyForm);
    }

    await loadPage();
    setStatus("Agenda item deleted.");
  }

  async function togglePublished(item: AgendaItem) {
    const { error } = await supabase
      .from("agenda_items")
      .update({
        is_published: !item.is_published,
      })
      .eq("id", item.id);

    if (error) {
      setStatus(`Could not update publish status: ${error.message}`);
      return;
    }

    await loadPage();
    setStatus(
      `${item.title} ${item.is_published ? "unpublished" : "published"}.`,
    );
  }

  const categories = useMemo(() => {
    const values = Array.from(
      new Set(items.map((item) => item.category).filter(Boolean)),
    ) as string[];
    return ["All", ...values.sort((a, b) => a.localeCompare(b))];
  }, [items]);

  const filteredItems = useMemo(() => {
    if (filterCategory === "All") return items;
    return items.filter(
      (item) =>
        (item.category || "").toLowerCase() === filterCategory.toLowerCase(),
    );
  }, [items, filterCategory]);

  function handleDragStart(id: string) {
    setDraggedId(id);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
  }

  function handleDrop(targetId: string) {
    if (!draggedId || draggedId === targetId) return;

    const allFrom = [...items];
    const fromIndex = allFrom.findIndex((item) => item.id === draggedId);
    const toIndex = allFrom.findIndex((item) => item.id === targetId);

    if (fromIndex === -1 || toIndex === -1) {
      setDraggedId(null);
      return;
    }

    const reordered = moveItem(allFrom, fromIndex, toIndex).map(
      (item, index) => ({
        ...item,
        sort_order: index + 1,
      }),
    );

    setItems(reordered);
    setDraggedId(null);
    setStatus("Order changed. Click “Save Order” to keep it.");
  }

  async function saveOrder() {
    if (!activeEvent?.id) {
      setStatus("No admin working event selected.");
      return;
    }

    try {
      setSavingOrder(true);

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const nextSort = index + 1;

        const { error } = await supabase
          .from("agenda_items")
          .update({ sort_order: nextSort })
          .eq("id", item.id);

        if (error) {
          throw error;
        }
      }

      setStatus("Agenda order saved.");
      await loadPage();
    } catch (err: any) {
      console.error("saveOrder error:", err);
      setStatus(err?.message || "Failed to save order.");
    } finally {
      setSavingOrder(false);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => {
            window.location.href = "/admin/dashboard";
          }}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          ← Return to Dashboard
        </button>
      </div>

      <h1>Admin Agenda</h1>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
          marginBottom: 20,
        }}
      >
        <div style={{ fontWeight: 700 }}>
          {activeEvent?.name || "No admin working event selected"}
        </div>
        <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>
          {status}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(320px, 420px) 1fr",
          gap: 20,
          alignItems: "start",
        }}
      >
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
            display: "grid",
            gap: 10,
            position: "sticky",
            top: 16,
          }}
        >
          <div style={{ fontWeight: 700 }}>
            {form.id ? "Edit Agenda Item" : "Add Agenda Item"}
          </div>

          <input
            value={form.title}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, title: e.target.value }))
            }
            placeholder="Title"
            style={{ padding: 8 }}
          />

          <input
            value={form.location}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, location: e.target.value }))
            }
            placeholder="Location"
            style={{ padding: 8 }}
          />

          <input
            value={form.speaker}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, speaker: e.target.value }))
            }
            placeholder="Speaker"
            style={{ padding: 8 }}
          />

          <input
            value={form.category}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, category: e.target.value }))
            }
            placeholder="Category"
            style={{ padding: 8 }}
          />

          <textarea
            value={form.description}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, description: e.target.value }))
            }
            placeholder="Description"
            style={{ padding: 8, minHeight: 100 }}
          />

          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 13 }}>Agenda Date</span>
            <input
              type="date"
              value={form.agenda_date}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, agenda_date: e.target.value }))
              }
              style={{ padding: 8 }}
            />
          </label>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13 }}>Start Time</span>
              <input
                type="time"
                value={form.start_time}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, start_time: e.target.value }))
                }
                style={{ padding: 8 }}
              />
            </label>

            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13 }}>End Time</span>
              <input
                type="time"
                value={form.end_time}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, end_time: e.target.value }))
                }
                style={{ padding: 8 }}
              />
            </label>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13 }}>Sort Order</span>
              <input
                value={form.sort_order}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, sort_order: e.target.value }))
                }
                placeholder="Sort Order"
                style={{ padding: 8 }}
              />
            </label>

            <label
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                paddingTop: 22,
              }}
            >
              <input
                type="checkbox"
                checked={form.is_published}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    is_published: e.target.checked,
                  }))
                }
              />
              Published
            </label>
          </div>

          <input
            value={form.external_id}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, external_id: e.target.value }))
            }
            placeholder="External ID (optional)"
            style={{ padding: 8 }}
          />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void saveItem()}
              disabled={saving}
            >
              {form.id ? "Update Item" : "Add Item"}
            </button>

            <button
              type="button"
              onClick={() => setForm(emptyForm)}
              disabled={saving}
            >
              New Blank
            </button>

            {form.id ? (
              <button
                type="button"
                onClick={() => void deleteItem(form.id)}
                disabled={saving}
              >
                Delete Selected
              </button>
            ) : null}
          </div>
        </div>

        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: 12,
              borderBottom: "1px solid #eee",
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setFilterCategory(category)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid #d1d5db",
                    background:
                      filterCategory === category ? "#e5eefc" : "white",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  {category}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void saveOrder()}
              disabled={savingOrder}
            >
              {savingOrder ? "Saving Order..." : "Save Order"}
            </button>
          </div>

          <div
            style={{
              padding: "10px 14px",
              fontSize: 12,
              color: "#666",
              borderBottom: "1px solid #eee",
            }}
          >
            Drag rows to reorder, then click <strong>Save Order</strong>.
          </div>

          {filteredItems.length === 0 ? (
            <div style={{ padding: 16, color: "#666" }}>
              No agenda items found.
            </div>
          ) : (
            filteredItems.map((item) => (
              <div
                key={item.id}
                draggable
                onDragStart={() => handleDragStart(item.id)}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(item.id)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "44px 1fr auto",
                  gap: 12,
                  padding: 14,
                  borderTop: "1px solid #eee",
                  background: draggedId === item.id ? "#f8fafc" : "white",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                    color: "#666",
                    cursor: "grab",
                    userSelect: "none",
                  }}
                  title="Drag to reorder"
                >
                  ☰
                </div>

                <button
                  type="button"
                  onClick={() => setForm(formFromItem(item))}
                  style={{
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{item.title}</div>

                  <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
                    {formatAgendaDate(item.agenda_date)} ·{" "}
                    {formatAgendaTime(item.start_time, item.end_time)}
                  </div>

                  {item.location ? (
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                      {item.location}
                    </div>
                  ) : null}

                  <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
                    {item.category || "No category"}
                    {item.speaker ? ` · Speaker: ${item.speaker}` : ""}
                  </div>

                  <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
                    external_id: {item.external_id || "—"}
                    {item.sort_order !== null && item.sort_order !== undefined
                      ? ` · sort: ${item.sort_order}`
                      : ""}
                    {item.source ? ` · source: ${item.source}` : ""}
                  </div>
                </button>

                <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
                  <button
                    type="button"
                    onClick={() => void togglePublished(item)}
                  >
                    {item.is_published ? "Unpublish" : "Publish"}
                  </button>

                  <button
                    type="button"
                    onClick={() => void deleteItem(item.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminAgendaPage() {
  return (
    <AdminRouteGuard>
      <AdminAgendaPageInner />
    </AdminRouteGuard>
  );
}
