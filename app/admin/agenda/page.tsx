"use client";

import type React from "react";
import Papa from "papaparse";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { getAgendaColor } from "@/lib/agendaColors";
import { getAdminEvent } from "@/lib/getAdminEvent";
import {
  canAccessEvent,
  getCurrentAdminAccess,
} from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

type AgendaItem = {
  id: string;
  external_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  speaker: string | null;
  category: string | null;
  color: string | null;
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
  color: string;
  agenda_date: string;
  start_time: string;
  end_time: string;
  sort_order: string;
  is_published: boolean;
};
type AgendaTemplate = {
  id: string;
  name: string;
  description: string | null;
  status: string;
};

type AgendaTemplateItem = {
  id: string;
  template_id: string;
  external_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  speaker: string | null;
  category: string | null;
  color: string | null;
  agenda_date: string | null;
  start_time: string | null;
  end_time: string | null;
  sort_order: number | null;
  is_published: boolean | null;
};

type AgendaAdminMode = "items" | "import";
type AgendaImportRow = Record<string, unknown>;

const MOBILE_BREAKPOINT = 900;
const emptyForm: AgendaForm = {
  id: "",
  external_id: "",
  title: "",
  description: "",
  location: "",
  speaker: "",
  category: "",
  color: "",
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
  if (!trimmed) {
    return null;
  }
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
  if (form.external_id.trim()) {
    return form.external_id.trim();
  }

  return [
    slugify(form.title || "agenda-item"),
    slugify(form.agenda_date || "no-date"),
    slugify(form.start_time || "no-time"),
  ].join("-");
}

function normalizeImportHeaderKey(value: string) {
  return value
    .replace(/\u00A0/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getImportField(row: AgendaImportRow, names: string[]) {
  const normalizedRow: Record<string, unknown> = {};

  Object.keys(row).forEach((key) => {
    normalizedRow[normalizeImportHeaderKey(key)] = row[key];
  });

  for (const name of names) {
    const value = normalizedRow[normalizeImportHeaderKey(name)];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return undefined;
}

function normalizeImportText(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function normalizeImportNumber(value: unknown) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeImportDate(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    const dd = String(value.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(
        2,
        "0",
      )}-${String(parsed.d).padStart(2, "0")}`;
    }
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    const [m, d, y] = raw.split("/");
    return `${y}-${String(Number(m)).padStart(2, "0")}-${String(
      Number(d),
    ).padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function excelTimeNumberToHHMM(value: number) {
  const totalMinutes = Math.round(value * 24 * 60);
  const hh = Math.floor(totalMinutes / 60) % 24;
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function normalizeImportTimeOnly(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  if (typeof value === "number") {
    return excelTimeNumberToHHMM(value);
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(":");
    return `${String(Number(h)).padStart(2, "0")}:${m}`;
  }

  if (/^\d{3,4}$/.test(raw)) {
    const padded = raw.padStart(4, "0");
    const hh = padded.slice(0, 2);
    const mm = padded.slice(2, 4);
    if (Number(hh) <= 23 && Number(mm) <= 59) {
      return `${hh}:${mm}`;
    }
  }

  const parsed = new Date(`1970-01-01T${raw}`);
  if (!Number.isNaN(parsed.getTime())) {
    return `${String(parsed.getHours()).padStart(2, "0")}:${String(
      parsed.getMinutes(),
    ).padStart(2, "0")}`;
  }

  return null;
}

function yesNoToBool(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "yes" || raw === "y" || raw === "true" || raw === "1";
}

function parseAgendaRowsFromWorkbook(file: File): Promise<AgendaImportRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        if (!data) {
          reject(new Error("Could not read workbook data."));
          return;
        }

        const workbook = XLSX.read(data, { type: "array" });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<AgendaImportRow>(worksheet, {
          defval: "",
          raw: false,
        });

        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = () => reject(new Error("Failed to read workbook file."));
    reader.readAsArrayBuffer(file);
  });
}

function parseAgendaRowsFromCsv(file: File): Promise<AgendaImportRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<AgendaImportRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
      complete: (results) => resolve(results.data || []),
      error: (error) => reject(error),
    });
  });
}

async function parseAgendaImportFile(file: File) {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    return parseAgendaRowsFromWorkbook(file);
  }

  return parseAgendaRowsFromCsv(file);
}

function formatAgendaDate(value: string | null) {
  if (!value) {
    return "No date";
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatAgendaTime(start: string | null, end: string | null) {
  if (!start && !end) {
    return "Time TBD";
  }
  if (start && end) {
    return `${start} – ${end}`;
  }
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
    color: item.color || "",
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
  const [isMobile, setIsMobile] = useState(false);
  const [forceDesktopDrag, setForceDesktopDrag] = useState(false);
  const useButtonReorder = isMobile && !forceDesktopDrag;
  const [templates, setTemplates] = useState<AgendaTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [assignedTemplateId, setAssignedTemplateId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [agendaMode, setAgendaMode] = useState<AgendaAdminMode>("items");
  const [importStatus, setImportStatus] = useState("No agenda import file selected.");
  const [importBusy, setImportBusy] = useState(false);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatus("Loading...");

    const adminEvent = getAdminEvent();

    if (!adminEvent?.id) {
      setActiveEvent(null);
      setItems([]);
      setStatus("No admin working event selected.");
      setLoading(false);
      return;
    }

    const selectedEvent = {
      id: adminEvent.id,
      name: adminEvent.name || "Selected Event",
    };

    setActiveEvent(selectedEvent);
    const { data: eventData, error: eventDataError } = await supabase
      .from("events")
      .select("assigned_agenda_template_id")
      .eq("id", selectedEvent.id)
      .maybeSingle();

    if (eventDataError) {
      setError(eventDataError.message);
      setStatus(`Could not load event settings: ${eventDataError.message}`);
      setLoading(false);
      return;
    }

    const assignedId =
      (
        eventData as {
          assigned_agenda_template_id?: string | null;
        } | null
      )?.assigned_agenda_template_id || "";
    setAssignedTemplateId(assignedId);
    setSelectedTemplateId(assignedId);

    const { data, error } = await supabase
      .from("agenda_items")
      .select(
        "id,external_id,title,description,location,speaker,category,color,agenda_date,start_time,end_time,sort_order,is_published,source",
      )
      .eq("event_id", selectedEvent.id)
      .order("agenda_date", { ascending: true, nullsFirst: false })
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("start_time", { ascending: true, nullsFirst: false })
      .order("title", { ascending: true });

    if (error) {
      setError(error.message);
      setStatus(`Could not load agenda items: ${error.message}`);
      setLoading(false);
      return;
    }

    setItems((data || []) as AgendaItem[]);
    setStatus(`Loaded ${(data || []).length} items for ${selectedEvent.name}.`);
    setLoading(false);
  }, []);

  const loadTemplates = useCallback(async () => {
    const { data, error } = await supabase
      .from("agenda_templates")
      .select("id,name,description,status")
      .eq("status", "active")
      .order("name", { ascending: true });

    if (error) {
      console.error("loadTemplates error:", error);
      setError(`Could not load agenda templates: ${error.message}`);
      return;
    }

    setTemplates((data || []) as AgendaTemplate[]);
  }, []);

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    }

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      setStatus("Checking admin access...");
      setAccessDenied(false);

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setActiveEvent(null);
        setItems([]);
        setError("No admin access.");
        setStatus("Access denied.");
        setLoading(false);
        setAccessDenied(true);
        return;
      }

      const adminEvent = getAdminEvent();

      if (!adminEvent?.id) {
        setActiveEvent(null);
        setItems([]);
        setStatus("No admin working event selected.");
        setLoading(false);
        return;
      }

      if (!canAccessEvent(admin, adminEvent.id)) {
        setActiveEvent(null);
        setItems([]);
        setError("You do not have access to this event.");
        setStatus("Access denied.");
        setLoading(false);
        setAccessDenied(true);
        return;
      }

      await loadPage();
    }

    void init();
    void loadTemplates();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-admin-event-context" ||
        e.key === "fcoc-admin-event-changed" ||
        e.key === "fcoc-user-mode" ||
        e.key === "fcoc-user-mode-changed"
      ) {
        void init();
        void loadTemplates();
      }
    }

    function handleAdminEventUpdated() {
      void init();
      void loadTemplates();
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      "fcoc-admin-event-updated",
      handleAdminEventUpdated,
    );

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        "fcoc-admin-event-updated",
        handleAdminEventUpdated,
      );
    };
  }, [loadPage, loadTemplates]);

  function moveItemUp(id: string) {
    setItems((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      if (index <= 0) {
        return prev;
      }

      const next = moveItem(prev, index, index - 1);

      return next.map((item, idx) => ({
        ...item,
        sort_order: idx + 1,
      }));
    });

    setStatus('Order changed. Click "Save Order" to keep it.');
  }

  function moveItemDown(id: string) {
    setItems((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      if (index === -1 || index >= prev.length - 1) {
        return prev;
      }

      const next = moveItem(prev, index, index + 1);

      return next.map((item, idx) => ({
        ...item,
        sort_order: idx + 1,
      }));
    });

    setStatus('Order changed. Click "Save Order" to keep it.');
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
      color: getAgendaColor(form.category, form.color),
      agenda_date: form.agenda_date.trim(),
      start_time: form.start_time.trim(),
      end_time: normalizeText(form.end_time),
      sort_order: normalizeNumber(form.sort_order),
      is_published: form.is_published,
      source: form.id ? "admin" : "manual",
    };

    setSaving(true);
    setError(null);

    try {
      if (form.id) {
        const { error } = await supabase
          .from("agenda_items")
          .update(payload)
          .eq("id", form.id);

        if (error) {
          setError(error.message);
          setStatus(`Could not update agenda item: ${error.message}`);
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
          setError(findError.message);
          setStatus(`Could not check for duplicate item: ${findError.message}`);
          return;
        }

        if (existing?.id) {
          setStatus(
            `An item with external_id "${externalId}" already exists. Edit that item or change the title/date/time.`,
          );
          return;
        }

        const { error } = await supabase.from("agenda_items").insert(payload);

        if (error) {
          setError(error.message);
          setStatus(`Could not add agenda item: ${error.message}`);
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
    if (!confirmed) {
      return;
    }
    setError(null);

    const { error } = await supabase.from("agenda_items").delete().eq("id", id);

    if (error) {
      setError(error.message);
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
    setError(null);
    const { error } = await supabase
      .from("agenda_items")
      .update({
        is_published: !item.is_published,
      })
      .eq("id", item.id);

    if (error) {
      setError(error.message);
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
    if (filterCategory === "All") {
      return items;
    }
    return items.filter(
      (item) =>
        (item.category || "").toLowerCase() === filterCategory.toLowerCase(),
    );
  }, [items, filterCategory]);

  function handleDragStart(e: React.DragEvent<HTMLDivElement>, id: string) {
    setDraggedId(id);
    try {
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
    } catch {}
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = "move";
    } catch {}
  }

  function handleDrop(targetId: string) {
    if (!draggedId || draggedId === targetId) {
      return;
    }

    const fromIndex = items.findIndex((item) => item.id === draggedId);
    const toIndex = items.findIndex((item) => item.id === targetId);

    if (fromIndex === -1 || toIndex === -1) {
      setDraggedId(null);
      return;
    }

    const reordered = moveItem(items, fromIndex, toIndex).map(
      (item, index) => ({
        ...item,
        sort_order: index + 1,
      }),
    );

    setItems(reordered);
    setDraggedId(null);
    setStatus('Order changed. Click "Save Order" to keep it.');
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
      setError(err?.message || "Failed to save order.");
      setStatus(err?.message || "Failed to save order.");
    } finally {
      setSavingOrder(false);
    }
  }
  async function assignTemplate() {
    if (!activeEvent?.id) {
      setStatus("No admin working event selected.");
      return;
    }

    const { error } = await supabase
      .from("events")
      .update({
        assigned_agenda_template_id: selectedTemplateId || null,
      })
      .eq("id", activeEvent.id);

    if (error) {
      setError(error.message);
      setStatus(`Could not assign template: ${error.message}`);
      return;
    }

    setAssignedTemplateId(selectedTemplateId || "");
    const templateName =
      templates.find((t) => t.id === selectedTemplateId)?.name || "None";
    setStatus(`Assigned agenda template: ${templateName}.`);
  }
  async function copyTemplateToEvent() {
    if (!activeEvent?.id) {
      setStatus("No admin working event selected.");
      return;
    }

    if (!selectedTemplateId) {
      setStatus("Select a template first.");
      return;
    }

    const { data, error } = await supabase
      .from("agenda_template_items")
      .select(
        "external_id,title,description,location,speaker,category,color,agenda_date,start_time,end_time,sort_order,is_published",
      )
      .eq("template_id", selectedTemplateId)
      .order("sort_order", { ascending: true, nullsFirst: false });

    if (error) {
      setError(error.message);
      setStatus(`Could not load template items: ${error.message}`);
      return;
    }

    const rows = ((data || []) as AgendaTemplateItem[]).map((item, index) => ({
      event_id: activeEvent.id,
      external_id:
        item.external_id ||
        [
          "template",
          selectedTemplateId,
          String(index + 1),
          (item.title || "agenda-item")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, ""),
        ].join("-"),
      title: item.title,
      description: item.description,
      location: item.location,
      speaker: item.speaker,
      category: item.category,
      color: item.color,
      agenda_date: item.agenda_date,
      start_time: item.start_time,
      end_time: item.end_time,
      sort_order: item.sort_order ?? index + 1,
      is_published: !!item.is_published,
      source: "template",
    }));

    const { error: upsertError } = await supabase
      .from("agenda_items")
      .upsert(rows, {
        onConflict: "event_id,external_id",
      });

    if (upsertError) {
      setError(upsertError.message);
      setStatus(`Could not copy template to event: ${upsertError.message}`);
      return;
    }

    await loadPage();
    setStatus(`Copied ${rows.length} template items into this event.`);
  }
  async function replaceEventFromTemplate() {
    if (!activeEvent?.id) {
      setStatus("No admin working event selected.");
      return;
    }

    if (!selectedTemplateId) {
      setStatus("Select a template first.");
      return;
    }

    const confirmed = window.confirm(
      "Replace the current event agenda with the selected template? This will remove current event agenda items first.",
    );
    if (!confirmed) {
      return;
    }

    const { error: deleteError } = await supabase
      .from("agenda_items")
      .delete()
      .eq("event_id", activeEvent.id);

    if (deleteError) {
      setError(deleteError.message);
      setStatus(`Could not clear event agenda: ${deleteError.message}`);
      return;
    }

    await copyTemplateToEvent();
  }
  async function handleAgendaImportFile(file: File) {
    if (!activeEvent?.id) {
      setImportStatus("No admin working event selected.");
      return;
    }

    setImportBusy(true);
    setError(null);
    setImportStatus(`Reading ${file.name} for ${activeEvent.name}...`);

    try {
      const rows = await parseAgendaImportFile(file);

      if (!rows.length) {
        setImportStatus("No rows found in file.");
        return;
      }

      const payloads = rows.map((row, index) => {
        const title = normalizeImportText(getImportField(row, ["Title", "title"]));
        const description = normalizeImportText(
          getImportField(row, ["Description", "description"]),
        );
        const location = normalizeImportText(
          getImportField(row, ["Location", "location", "Room", "Venue"]),
        );
        const speaker = normalizeImportText(
          getImportField(row, ["Speaker", "speaker", "Presenter", "Host"]),
        );

        const startsAtRaw = getImportField(row, [
          "starts_at",
          "Starts At",
          "Start DateTime",
          "start_at",
        ]);

        const endsAtRaw = getImportField(row, [
          "ends_at",
          "Ends At",
          "End DateTime",
          "end_at",
        ]);

        const agendaDate = normalizeImportDate(
          getImportField(row, [
            "Agenda Date",
            "AgendaDate",
            "Date",
            "date",
            "agenda_date",
            "AGENDA DATE",
          ]) ?? startsAtRaw,
        );

        const startTime = normalizeImportTimeOnly(
          getImportField(row, ["Start Time", "start_time", "Start", "start"]) ??
            startsAtRaw,
        );

        const endTime = normalizeImportTimeOnly(
          getImportField(row, ["End Time", "end_time", "End", "end"]) ??
            endsAtRaw,
        );

        const category = normalizeImportText(
          getImportField(row, ["Category", "category"]),
        );
        const color = normalizeImportText(getImportField(row, ["Color", "color"]));
        const published = yesNoToBool(
          getImportField(row, [
            "Published",
            "published",
            "Is Published",
            "is_published",
          ]),
        );
        const sortOrder = normalizeImportNumber(
          getImportField(row, ["Sort Order", "sort_order"]),
        );

        if (!title) {
          throw new Error(`Import blocked. Row ${index + 2}: missing Title.`);
        }

        if (!agendaDate) {
          throw new Error(
            `Import blocked. Row ${index + 2}: missing or invalid Agenda Date.`,
          );
        }

        if (!startTime) {
          throw new Error(
            `Import blocked. Row ${index + 2}: missing or invalid Start Time.`,
          );
        }

        const externalId = [
          slugify(title),
          agendaDate || "no-date",
          startTime || "no-time",
        ].join("-");

        return {
          event_id: activeEvent.id,
          external_id: externalId,
          title,
          description,
          location,
          speaker,
          category,
          color: getAgendaColor(category || "", color || ""),
          agenda_date: agendaDate,
          start_time: startTime,
          end_time: endTime,
          is_published: published,
          sort_order: sortOrder ?? index + 1,
          source: "import",
        };
      });

      setImportStatus(`Importing ${payloads.length} rows into ${activeEvent.name}...`);

      const { error: importError } = await supabase
        .from("agenda_items")
        .upsert(payloads, {
          onConflict: "event_id,external_id",
        });

      if (importError) {
        throw new Error(`Bulk import failed: ${importError.message}`);
      }

      await loadPage();
      setAgendaMode("items");
      setImportStatus(
        `Agenda import complete for ${activeEvent.name}. ${payloads.length} rows imported or updated.`,
      );
    } catch (err: any) {
      console.error(err);
      setImportStatus(`Import failed: ${err?.message || "Unknown error"}`);
    } finally {
      setImportBusy(false);
    }
  }

  const assignedTemplateName =
    templates.find((t) => t.id === assignedTemplateId)?.name || "None";
  if (!loading && accessDenied) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Admin Agenda</h1>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          You do not have access to this page.
        </div>
      </div>
    );
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

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setAgendaMode("items")}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: agendaMode === "items" ? "none" : "1px solid #cbd5e1",
            background: agendaMode === "items" ? "#111827" : "white",
            color: agendaMode === "items" ? "white" : "#111827",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Agenda Items
        </button>

        <button
          type="button"
          onClick={() => setAgendaMode("import")}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: agendaMode === "import" ? "none" : "1px solid #cbd5e1",
            background: agendaMode === "import" ? "#111827" : "white",
            color: agendaMode === "import" ? "white" : "#111827",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Import Agenda
        </button>
      </div>
      {error ? (
        <div
          style={{
            border: "1px solid #e2b4b4",
            borderRadius: 10,
            background: "#fff3f3",
            color: "#8a1f1f",
            padding: 12,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      ) : null}
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
        <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
          Assigned Template: {assignedTemplateName}
        </div>
      </div>
      {agendaMode === "import" ? (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
            display: "grid",
            gap: 14,
            marginBottom: 20,
            maxWidth: 840,
          }}
        >
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>
              Import Agenda
            </div>
            <div style={{ fontSize: 14, color: "#555" }}>
              Import CSV or XLSX agenda rows into the selected admin working event.
            </div>
          </div>

          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              background: "#f8f9fb",
              padding: 14,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              Admin working event: {activeEvent?.name || "No selected event"}
            </div>
            <div style={{ fontSize: 13, color: "#666" }}>
              Agenda imports go into this selected admin working event only.
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>
              Agenda Import Templates
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <a href="/templates/agenda/agenda_import_template_blank_with_speaker.xlsx">
                Download blank XLSX template
              </a>
              <a href="/templates/agenda/agenda_import_template_blank_with_speaker.csv">
                Download blank CSV template
              </a>
              <a href="/templates/agenda/agenda_import_template_sample_with_speaker.xlsx">
                Download sample XLSX template
              </a>
              <a href="/templates/agenda/agenda_import_template_sample_with_speaker.csv">
                Download sample CSV template
              </a>
              <a href="/templates/agenda/agenda_import_template_notes_with_speaker.txt">
                Download template notes / instructions
              </a>
            </div>

            <div style={{ marginTop: 12, fontSize: 13, color: "#666" }}>
              <strong>Preferred columns:</strong> Title, Description, Location,
              Speaker, Agenda Date, Start Time, End Time, Category, Color,
              Published, Sort Order.
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Upload file</div>
            <div style={{ fontSize: 14, color: "#555", marginBottom: 10 }}>
              Accepted formats: CSV and XLSX.
            </div>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              disabled={importBusy || !activeEvent}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void handleAgendaImportFile(file);
                }
              }}
            />
          </div>

          <div>
            <strong>Status:</strong> {importStatus}
          </div>
        </div>
      ) : null}

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 16,
          display: "grid",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ fontWeight: 700 }}>Agenda Template</div>

        <select
          value={selectedTemplateId}
          onChange={(e) => setSelectedTemplateId(e.target.value)}
          style={{ padding: 8, maxWidth: 420 }}
        >
          <option value="">Select template</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => void assignTemplate()}>
            Assign Template
          </button>

          <button type="button" onClick={() => void copyTemplateToEvent()}>
            Copy Template to Event
          </button>

          <button type="button" onClick={() => void replaceEventFromTemplate()}>
            Replace Event From Template
          </button>
        </div>

        <div style={{ fontSize: 12, color: "#666" }}>
          Current assigned template: {assignedTemplateName}
        </div>
      </div>{" "}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "minmax(320px, 420px) 1fr",
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
            position: isMobile ? "static" : "sticky",
            top: isMobile ? undefined : 16,
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

          <input
            value={form.color}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, color: e.target.value }))
            }
            placeholder="Color (optional, like #dbeafe)"
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
              gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
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

            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={() => setForceDesktopDrag((prev) => !prev)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  background: forceDesktopDrag ? "#dbeafe" : "white",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                {forceDesktopDrag ? "Desktop Drag On" : "Desktop Drag Off"}
              </button>

              <button
                type="button"
                onClick={() => void saveOrder()}
                disabled={savingOrder}
              >
                {savingOrder ? "Saving Order..." : "Save Order"}
              </button>
            </div>
          </div>

          <div
            style={{
              padding: "10px 14px",
              fontSize: 12,
              color: "#666",
              borderBottom: "1px solid #eee",
            }}
          >
            {useButtonReorder
              ? 'Button reorder mode: use ↑ and ↓, then click "Save Order".'
              : 'Desktop drag mode: drag rows by ☰, then click "Save Order".'}
          </div>

          <div
            style={{
              padding: 12,
              background: "#fff8dc",
              border: "1px solid #e5e7eb",
            }}
          >
            items: {items.length} | filteredItems: {filteredItems.length}
          </div>

          {filteredItems.length === 0 ? (
            <div style={{ padding: 16, color: "#666" }}>
              No agenda items found.
            </div>
          ) : (
            <div
              style={{
                border: "1px solid #ddd",
                borderRadius: 12,
                background: "white",
                marginTop: 16,
                overflow: "hidden",
              }}
            >
              <div style={{ padding: 14, fontWeight: 700 }}>
                Agenda Items ({filteredItems.length})
              </div>

              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  onDragOver={!useButtonReorder ? handleDragOver : undefined}
                  onDrop={
                    !useButtonReorder ? () => handleDrop(item.id) : undefined
                  }
                  style={{
                    display: "grid",
                    gridTemplateColumns: useButtonReorder
                      ? "56px 1fr auto"
                      : "44px 1fr auto",
                    gap: 12,
                    padding: 14,
                    borderTop: "1px solid #eee",
                    background: draggedId === item.id ? "#f8fafc" : "white",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gap: 6,
                      alignContent: "start",
                      justifyItems: "center",
                    }}
                  >
                    {useButtonReorder ? (
                      <>
                        <button
                          type="button"
                          onClick={() => moveItemUp(item.id)}
                          disabled={filteredItems[0]?.id === item.id}
                          style={{
                            padding: "6px 8px",
                            minWidth: 36,
                            cursor:
                              filteredItems[0]?.id === item.id
                                ? "default"
                                : "pointer",
                          }}
                          title="Move up"
                        >
                          ↑
                        </button>

                        <button
                          type="button"
                          onClick={() => moveItemDown(item.id)}
                          disabled={
                            filteredItems[filteredItems.length - 1]?.id ===
                            item.id
                          }
                          style={{
                            padding: "6px 8px",
                            minWidth: 36,
                            cursor:
                              filteredItems[filteredItems.length - 1]?.id ===
                              item.id
                                ? "default"
                                : "pointer",
                          }}
                          title="Move down"
                        >
                          ↓
                        </button>
                      </>
                    ) : (
                      <div
                        draggable
                        onDragStart={(e) => handleDragStart(e, item.id)}
                        onDragEnd={() => setDraggedId(null)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 18,
                          color: "#666",
                          cursor: "grab",
                          userSelect: "none",
                          width: 32,
                          height: 32,
                        }}
                        title="Drag to reorder"
                      >
                        ☰
                      </div>
                    )}
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

                    {item.color ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginTop: 6,
                        }}
                      >
                        <span
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 999,
                            background: item.color,
                            border: "1px solid rgba(0,0,0,0.15)",
                            display: "inline-block",
                          }}
                        />
                        <span style={{ fontSize: 12, color: "#777" }}>
                          {item.color}
                        </span>
                      </div>
                    ) : null}

                    <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
                      external_id: {item.external_id || "—"}
                      {item.sort_order !== null && item.sort_order !== undefined
                        ? ` · sort: ${item.sort_order}`
                        : ""}
                      {item.source ? ` · source: ${item.source}` : ""}
                    </div>
                  </button>

                  <div
                    style={{ display: "grid", gap: 8, alignContent: "start" }}
                  >
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
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminAgendaPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_agenda">
      <AdminAgendaPageInner />
    </AdminRouteGuard>
  );
}
