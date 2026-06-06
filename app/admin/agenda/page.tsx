"use client";

import Papa from "papaparse";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import AgendaImportPanel from "@/components/admin/agenda/AgendaImportPanel";
import AgendaTemplatePanel from "@/components/admin/agenda/AgendaTemplatePanel";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useAdmin } from "@/lib/adminContext";
import { getAgendaColor } from "@/lib/agendaColors";
import { getAdminEvent } from "@/lib/getAdminEvent";
import { canAccessEvent } from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

type AgendaItem = {
  id: string;
  event_id: string;
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

type AgendaCalendarBlock = {
  item: AgendaItem;
  lane: number;
  laneCount: number;
  top: number;
  height: number;
};

type AgendaResizeEdge = "start" | "end";

type AgendaResizeDrag = {
  itemId: string;
  columnTop: number;
  edge: AgendaResizeEdge;
  startMinutes: number;
  endMinutes: number;
  previewMinutes: number;
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

type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
};

const MOBILE_BREAKPOINT = 900;
const AGENDA_SLOT_MINUTES = 15;
const AGENDA_SLOT_HEIGHT = 28;
const AGENDA_DAY_START_MINUTES = 7 * 60;
const AGENDA_DAY_END_MINUTES = 22 * 60;
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
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
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

function ensureRowsAffected<T>(rows: T[] | null, message: string) {
  if (!rows || rows.length === 0) {
    throw new Error(message);
  }

  return rows;
}

function getErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function timeToMinutes(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  return hour * 60 + minute;
}

function minutesToTime(value: number) {
  const safeMinutes = Math.max(0, Math.min(23 * 60 + 59, value));
  const hour = Math.floor(safeMinutes / 60);
  const minute = safeMinutes % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function agendaDurationMinutes(item: AgendaItem) {
  const start = timeToMinutes(item.start_time);
  const end = timeToMinutes(item.end_time);

  if (start !== null && end !== null && end > start) {
    return end - start;
  }

  return 60;
}

function formatDurationLabel(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "Duration TBD";
  }

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (remainder === 0) {
    return `${hours} hr${hours === 1 ? "" : "s"}`;
  }

  return `${hours} hr ${remainder} min`;
}

function formatCalendarSlot(value: number) {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  const date = new Date(1970, 0, 1, hour, minute);

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildAgendaCalendarBlocks(
  dayItems: AgendaItem[],
  rangeStartMinutes: number,
): AgendaCalendarBlock[] {
  const sorted = [...dayItems].sort((a, b) => {
    const aStart = timeToMinutes(a.start_time) ?? 24 * 60;
    const bStart = timeToMinutes(b.start_time) ?? 24 * 60;

    if (aStart !== bStart) {
      return aStart - bStart;
    }

    return (a.title || "").localeCompare(b.title || "");
  });

  const laneEnds: number[] = [];
  const blocks: AgendaCalendarBlock[] = [];

  sorted.forEach((item) => {
    const start = timeToMinutes(item.start_time);

    if (start === null) {
      return;
    }

    const duration = agendaDurationMinutes(item);
    const end = start + duration;
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);

    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }

    blocks.push({
      item,
      lane,
      laneCount: 1,
      top:
        ((start - rangeStartMinutes) / AGENDA_SLOT_MINUTES) *
        AGENDA_SLOT_HEIGHT,
      height: Math.max(
        34,
        (duration / AGENDA_SLOT_MINUTES) * AGENDA_SLOT_HEIGHT - 4,
      ),
    });
  });

  const laneCount = Math.max(1, laneEnds.length);

  return blocks.map((block) => ({
    ...block,
    laneCount,
  }));
}

function AdminAgendaPageInner() {
  const { admin } = useAdmin();
  const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [status, setStatus] = useState("Loading...");
  const [form, setForm] = useState<AgendaForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [filterCategory, setFilterCategory] = useState("All");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [calendarDraggingId, setCalendarDraggingId] = useState<string | null>(
    null,
  );
  const [calendarDropPreview, setCalendarDropPreview] = useState<{
    day: string;
    minutes: number;
  } | null>(null);
  const [calendarDragOffsetSlots, setCalendarDragOffsetSlots] = useState(0);
  const [calendarResizePreview, setCalendarResizePreview] = useState<{
    itemId: string;
    minutes: number;
  } | null>(null);
  const calendarResizeDragRef = useRef<AgendaResizeDrag | null>(null);
  const itemsRef = useRef<AgendaItem[]>([]);
  const activeEventRef = useRef<ActiveEvent | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [forceDesktopDrag, setForceDesktopDrag] = useState(false);
  const [compactCalendarView, setCompactCalendarView] = useState(false);
  const useButtonReorder = isMobile && !forceDesktopDrag;
  const [templates, setTemplates] = useState<AgendaTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [assignedTemplateId, setAssignedTemplateId] = useState("");
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateDescription, setNewTemplateDescription] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agendaMode, setAgendaMode] = useState<AgendaAdminMode>("items");
  const [importStatus, setImportStatus] = useState(
    "No agenda import file selected.",
  );
  const [importBusy, setImportBusy] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(
    null,
  );
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(
    null,
  );

  function showStatus(message: string) {
    setError(null);
    setStatus(message);
  }

  function showError(message: string) {
    setError(message);
    setStatus("");
  }

  function requestConfirmation(dialog: Partial<ConfirmDialogState>) {
    // Prevent orphaned promises if another confirmation is opened
    // before the previous dialog has been resolved.
    if (confirmResolverRef.current) {
      confirmResolverRef.current(false);
    }

    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;

      setConfirmDialog({
        title: dialog.title || "Confirm Action",
        message: dialog.message || "Are you sure you want to continue?",
        confirmLabel: dialog.confirmLabel || "Confirm",
        cancelLabel: dialog.cancelLabel || "Cancel",
        danger: !!dialog.danger,
      });
    });
  }

  function closeConfirmDialog(confirmed: boolean) {
    confirmResolverRef.current?.(confirmed);
    confirmResolverRef.current = null;
    setConfirmDialog(null);
  }

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    activeEventRef.current = activeEvent;
  }, [activeEvent]);

  const loadPage = useCallback(async () => {
    setLoading(true);
    showStatus("Loading...");

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
      showError(eventDataError.message || "Could not load event settings.");
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
        "id,event_id,external_id,title,description,location,speaker,category,color,agenda_date,start_time,end_time,sort_order,is_published,source",
      )
      .eq("event_id", selectedEvent.id)
      .order("agenda_date", { ascending: true, nullsFirst: false })
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("start_time", { ascending: true, nullsFirst: false })
      .order("title", { ascending: true });

    if (error) {
      showError(error.message || "Could not load agenda items.");
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
      showError(error.message || "Could not load agenda templates.");
      return;
    }

    setTemplates((data || []) as AgendaTemplate[]);
  }, []);

  const refreshAgendaData = useCallback(async () => {
    await Promise.all([loadPage(), loadTemplates()]);
  }, [loadPage, loadTemplates]);

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    }

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!admin) {
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
      showError("You do not have access to this event.");
      setLoading(false);
      return;
    }

    void loadPage();
    void loadTemplates();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-admin-event-context" ||
        e.key === "fcoc-admin-event-changed"
      ) {
        void loadPage();
        void loadTemplates();
      }
    }

    function handleAdminEventUpdated() {
      void loadPage();
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
  }, [admin, loadPage, loadTemplates]);

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

    showStatus('Order changed. Click "Save Order" to keep it.');
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

    showStatus('Order changed. Click "Save Order" to keep it.');
  }

  async function saveItem() {
    if (!activeEvent?.id) {
      showError("No admin working event selected.");
      return;
    }

    if (!form.title.trim()) {
      showError("Enter a title.");
      return;
    }

    if (!form.agenda_date.trim()) {
      showError("Enter an agenda date.");
      return;
    }

    if (!form.start_time.trim()) {
      showError("Enter a start time.");
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
    showStatus(form.id ? "Updating agenda item..." : "Adding agenda item...");

    try {
      if (form.id) {
        const { data: updatedRows, error } = await supabase
          .from("agenda_items")
          .update(payload)
          .eq("id", form.id)
          .eq("event_id", activeEvent.id)
          .select("id,title");

        if (error) {
          showError(error.message || "Could not update agenda item.");
          return;
        }

        ensureRowsAffected(
          updatedRows,
          "No agenda item was updated. This usually means the row is blocked by RLS or does not belong to the selected event.",
        );

        setStatus(`Updated "${form.title.trim()}".`);
      } else {
        const { data: existing, error: findError } = await supabase
          .from("agenda_items")
          .select("id")
          .eq("event_id", activeEvent.id)
          .eq("external_id", externalId)
          .maybeSingle();

        if (findError) {
          showError(findError.message || "Could not check for duplicate item.");
          return;
        }

        if (existing?.id) {
          showError(
            `An item with external_id "${externalId}" already exists. Edit that item or change the title/date/time.`,
          );
          return;
        }

        const { error } = await supabase.from("agenda_items").insert(payload);

        if (error) {
          showError(error.message || "Could not add agenda item.");
          return;
        }

        setStatus(`Added "${form.title.trim()}".`);
      }

      setForm(emptyForm);
      void refreshAgendaData();
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(id: string) {
    const itemToDelete = items.find((item) => item.id === id);
    const itemTitle = itemToDelete?.title || "this agenda item";

    const confirmed = await requestConfirmation({
      title: "Delete Agenda Item",
      message: `Delete "${itemTitle}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    showStatus(`Deleting "${itemTitle}"...`);

    const { data: deletedRows, error } = await supabase
      .from("agenda_items")
      .delete()
      .eq("id", id)
      .select("id,title,event_id");

    if (error) {
      showError(error.message || "Could not delete item.");
      return;
    }

    ensureRowsAffected(
      deletedRows,
      [
        "No agenda item was deleted.",
        `Item ID: ${id}`,
        `Item event_id: ${itemToDelete?.event_id || "unknown"}`,
        `Admin event_id: ${activeEvent?.id || "unknown"}`,
        "Most likely cause: Supabase RLS does not allow DELETE for this logged-in admin, or this item is stale/mismatched data.",
      ].join(" "),
    );

    if (form.id === id) {
      setForm(emptyForm);
    }

    setItems((prev) => prev.filter((item) => item.id !== id));
    void refreshAgendaData();
    setStatus(`Deleted "${deletedRows[0]?.title || itemTitle}".`);
  }

  async function togglePublished(item: AgendaItem) {
    showStatus(
      item.is_published
        ? "Unpublishing agenda item..."
        : "Publishing agenda item...",
    );
    const { error } = await supabase
      .from("agenda_items")
      .update({
        is_published: !item.is_published,
      })
      .eq("id", item.id);

    if (error) {
      showError(error.message || "Could not update publish status.");
      return;
    }

    void refreshAgendaData();
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

  const calendarDays = useMemo(() => {
    const dates = Array.from(
      new Set(
        filteredItems
          .map((item) => item.agenda_date)
          .filter((value): value is string => !!value),
      ),
    );

    return dates.sort((a, b) => a.localeCompare(b));
  }, [filteredItems]);

  const calendarRange = useMemo(() => {
    const starts = filteredItems
      .map((item) => timeToMinutes(item.start_time))
      .filter((value): value is number => value !== null);

    const ends = filteredItems
      .map((item) => {
        const start = timeToMinutes(item.start_time);
        if (start === null) {
          return null;
        }

        return start + agendaDurationMinutes(item);
      })
      .filter((value): value is number => value !== null);

    const first = starts.length
      ? Math.min(...starts)
      : AGENDA_DAY_START_MINUTES;
    const last = ends.length ? Math.max(...ends) : AGENDA_DAY_END_MINUTES;

    return {
      start: Math.max(
        0,
        Math.floor(Math.min(first, AGENDA_DAY_START_MINUTES) / 60) * 60,
      ),
      end: Math.min(
        24 * 60,
        Math.ceil(Math.max(last, AGENDA_DAY_END_MINUTES) / 60) * 60,
      ),
    };
  }, [filteredItems]);

  const calendarTimeSlots = useMemo(() => {
    const slots: number[] = [];

    for (
      let minute = calendarRange.start;
      minute <= calendarRange.end;
      minute += AGENDA_SLOT_MINUTES
    ) {
      slots.push(minute);
    }

    return slots;
  }, [calendarRange]);

  const calendarGridHeight =
    Math.max(1, calendarTimeSlots.length - 1) * AGENDA_SLOT_HEIGHT;

  useEffect(() => {
    function handleWindowResizeMove(e: MouseEvent) {
      const drag = calendarResizeDragRef.current;

      if (!drag) {
        return;
      }

      const y = Math.max(0, e.clientY - drag.columnTop);
      const slotIndex = Math.round(y / AGENDA_SLOT_HEIGHT);
      const rawMinutes = Math.min(
        calendarRange.end,
        Math.max(
          calendarRange.start,
          calendarRange.start + slotIndex * AGENDA_SLOT_MINUTES,
        ),
      );

      const nextMinutes =
        drag.edge === "start"
          ? Math.max(
              calendarRange.start,
              Math.min(drag.endMinutes - AGENDA_SLOT_MINUTES, rawMinutes),
            )
          : Math.max(
              drag.startMinutes + AGENDA_SLOT_MINUTES,
              Math.min(calendarRange.end, rawMinutes),
            );

      calendarResizeDragRef.current = {
        ...drag,
        previewMinutes: nextMinutes,
      };

      setCalendarResizePreview({
        itemId: drag.itemId,
        minutes: nextMinutes,
      });
    }

    function handleWindowResizeEnd() {
      const drag = calendarResizeDragRef.current;

      if (!drag) {
        return;
      }

      calendarResizeDragRef.current = null;

      if (drag.edge === "start") {
        void resizeAgendaItemStartTime(drag.itemId, drag.previewMinutes);
        return;
      }

      void resizeAgendaItemEndTime(drag.itemId, drag.previewMinutes);
    }

    window.addEventListener("mousemove", handleWindowResizeMove);
    window.addEventListener("mouseup", handleWindowResizeEnd);

    // The resize handlers intentionally read the current drag ref and current calendar range.
    // The resize save functions are declared below and use refs for current event/items.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarRange.end, calendarRange.start]);

  function beginCalendarStartResize(
    e: React.MouseEvent<HTMLSpanElement>,
    item: AgendaItem,
  ) {
    e.preventDefault();
    e.stopPropagation();

    const startMinutes = timeToMinutes(item.start_time);
    const endMinutes =
      timeToMinutes(item.end_time) ??
      (startMinutes === null
        ? null
        : startMinutes + agendaDurationMinutes(item));

    if (startMinutes === null || endMinutes === null) {
      showError(
        "This agenda item needs a start and end time before it can be resized.",
      );
      return;
    }

    const dayColumn = e.currentTarget.closest(
      "[data-agenda-calendar-day]",
    ) as HTMLDivElement | null;

    if (!dayColumn) {
      return;
    }

    const rect = dayColumn.getBoundingClientRect();

    calendarResizeDragRef.current = {
      itemId: item.id,
      columnTop: rect.top,
      edge: "start",
      startMinutes,
      endMinutes,
      previewMinutes: startMinutes,
    };

    setCalendarResizePreview({
      itemId: item.id,
      minutes: startMinutes,
    });
    setStatus(`Resizing start time for "${item.title}"... release to save.`);
  }
  async function resizeAgendaItemStartTime(
    itemId: string,
    nextStartMinutes: number,
  ) {
    const currentEvent = activeEventRef.current;
    const currentItems = itemsRef.current;

    if (!currentEvent?.id) {
      showError("No admin working event selected.");
      setCalendarResizePreview(null);
      return;
    }

    const item = currentItems.find((agendaItem) => agendaItem.id === itemId);

    if (!item) {
      setCalendarResizePreview(null);
      return;
    }

    const currentStartMinutes = timeToMinutes(item.start_time);
    const endMinutes =
      timeToMinutes(item.end_time) ??
      (currentStartMinutes ?? 0) + agendaDurationMinutes(item);

    const safeStartMinutes = Math.max(
      calendarRange.start,
      Math.min(endMinutes - AGENDA_SLOT_MINUTES, nextStartMinutes),
    );
    const nextStartTime = minutesToTime(safeStartMinutes);

    setItems((prev) =>
      prev.map((agendaItem) =>
        agendaItem.id === itemId
          ? {
              ...agendaItem,
              start_time: nextStartTime,
            }
          : agendaItem,
      ),
    );

    showStatus(`Resizing "${item.title}" to start at ${nextStartTime}...`);

    const { data: updatedRows, error: updateError } = await supabase
      .from("agenda_items")
      .update({
        start_time: nextStartTime,
      })
      .eq("id", itemId)
      .eq("event_id", currentEvent.id)
      .select("id,title");

    if (updateError) {
      showError(updateError.message || "Could not resize agenda item.");
      setCalendarResizePreview(null);
      void refreshAgendaData();
      return;
    }

    try {
      ensureRowsAffected(
        updatedRows,
        "No agenda item was resized. This usually means the row is blocked by RLS or does not belong to the selected event.",
      );
    } catch (err) {
      showError(getErrorMessage(err, "No agenda item was resized."));

      setCalendarResizePreview(null);
      void refreshAgendaData();
      return;
    }

    setStatus(`Resized "${item.title}" to start at ${nextStartTime}.`);
    setCalendarResizePreview(null);
    void refreshAgendaData();
  }

  function handleDragStart(e: React.DragEvent<HTMLDivElement>, id: string) {
    setDraggedId(id);

    if (!e.dataTransfer) {
      return;
    }

    try {
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
    } catch (err) {
      console.debug("Drag dataTransfer unavailable:", err);
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();

    if (!e.dataTransfer) {
      return;
    }

    try {
      e.dataTransfer.dropEffect = "move";
    } catch (err) {
      console.debug("Drag dropEffect unavailable:", err);
    }
  }

  function handleCalendarDragStart(
    e: React.DragEvent<HTMLButtonElement>,
    id: string,
  ) {
    setCalendarDraggingId(id);

    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = Math.max(0, e.clientY - rect.top);

    setCalendarDragOffsetSlots(Math.floor(offsetY / AGENDA_SLOT_HEIGHT));

    if (!e.dataTransfer) {
      return;
    }

    try {
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
    } catch (err) {
      // Some mobile/Safari drag events do not fully support dataTransfer.
      // Safe to ignore because local component drag state still works.
      console.debug("Calendar drag dataTransfer unavailable:", err);
    }
  }

  function handleCalendarDragOver(
    e: React.DragEvent<HTMLDivElement>,
    day: string,
  ) {
    e.preventDefault();

    try {
      e.dataTransfer.dropEffect = "move";
    } catch (err) {
      // Some mobile/Safari drag events do not fully support dropEffect.
      // Safe to ignore because drag/drop still functions with local state.
      console.debug("Calendar drag dropEffect unavailable:", err);
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const y = Math.max(0, e.clientY - rect.top);
    const topEdgeY = Math.max(
      0,
      y - calendarDragOffsetSlots * AGENDA_SLOT_HEIGHT,
    );

    const slotIndex = Math.floor(topEdgeY / AGENDA_SLOT_HEIGHT);
    const nextStartMinutes = Math.min(
      calendarRange.end - AGENDA_SLOT_MINUTES,
      Math.max(
        calendarRange.start,
        calendarRange.start + slotIndex * AGENDA_SLOT_MINUTES,
      ),
    );

    setCalendarDropPreview({ day, minutes: nextStartMinutes });
  }

  function beginCalendarEndResize(
    e: React.MouseEvent<HTMLSpanElement>,
    item: AgendaItem,
  ) {
    e.preventDefault();
    e.stopPropagation();

    const startMinutes = timeToMinutes(item.start_time);

    if (startMinutes === null) {
      setStatus(
        "This agenda item needs a start time before it can be resized.",
      );
      return;
    }

    const dayColumn = e.currentTarget.closest(
      "[data-agenda-calendar-day]",
    ) as HTMLDivElement | null;

    if (!dayColumn) {
      return;
    }

    const rect = dayColumn.getBoundingClientRect();
    const currentEndMinutes =
      timeToMinutes(item.end_time) ??
      startMinutes + agendaDurationMinutes(item);

    calendarResizeDragRef.current = {
      itemId: item.id,
      columnTop: rect.top,
      edge: "end",
      startMinutes,
      endMinutes: currentEndMinutes,
      previewMinutes: currentEndMinutes,
    };

    setCalendarResizePreview({
      itemId: item.id,
      minutes: currentEndMinutes,
    });
  }

  async function resizeAgendaItemEndTime(
    itemId: string,
    nextEndMinutes: number,
  ) {
    const currentEvent = activeEventRef.current;
    const currentItems = itemsRef.current;

    if (!currentEvent?.id) {
      setStatus("No admin working event selected.");
      setCalendarResizePreview(null);
      return;
    }

    const item = currentItems.find((agendaItem) => agendaItem.id === itemId);

    if (!item) {
      setCalendarResizePreview(null);
      return;
    }

    const startMinutes = timeToMinutes(item.start_time);

    if (startMinutes === null) {
      showError(
        "This agenda item needs a start time before it can be resized.",
      );
      setCalendarResizePreview(null);
      return;
    }

    const safeEndMinutes = Math.max(
      startMinutes + AGENDA_SLOT_MINUTES,
      Math.min(calendarRange.end, nextEndMinutes),
    );
    const nextEndTime = minutesToTime(safeEndMinutes);

    setItems((prev) =>
      prev.map((agendaItem) =>
        agendaItem.id === itemId
          ? {
              ...agendaItem,
              end_time: nextEndTime,
            }
          : agendaItem,
      ),
    );

    showStatus(`Resizing "${item.title}" to end at ${nextEndTime}...`);

    const { data: updatedRows, error: updateError } = await supabase
      .from("agenda_items")
      .update({
        end_time: nextEndTime,
      })
      .eq("id", itemId)
      .eq("event_id", currentEvent.id)
      .select("id,title");

    if (updateError) {
      showError(updateError.message || "Could not resize agenda item.");
      setCalendarResizePreview(null);
      void refreshAgendaData();
      return;
    }

    try {
      ensureRowsAffected(
        updatedRows,
        "No agenda item was resized. This usually means the row is blocked by RLS or does not belong to the selected event.",
      );
    } catch (err) {
      showError(getErrorMessage(err, "No agenda item was resized."));

      setCalendarResizePreview(null);
      void refreshAgendaData();
      return;
    }

    setStatus(`Resized "${item.title}" to end at ${nextEndTime}.`);
    setCalendarResizePreview(null);
    void refreshAgendaData();
  }

  async function moveAgendaItemToCalendarSlot(
    itemId: string,
    nextDate: string,
    nextStartMinutes: number,
  ) {
    if (!activeEvent?.id) {
      showError("No admin working event selected.");
      setCalendarDraggingId(null);
      return;
    }

    const item = items.find((agendaItem) => agendaItem.id === itemId);

    if (!item) {
      setCalendarDraggingId(null);
      return;
    }

    const duration = agendaDurationMinutes(item);
    const nextStartTime = minutesToTime(nextStartMinutes);
    const safeEndMinutes = Math.min(24 * 60 - 1, nextStartMinutes + duration);

    const nextEndTime = minutesToTime(safeEndMinutes);
    setItems((prev) =>
      prev.map((agendaItem) =>
        agendaItem.id === itemId
          ? {
              ...agendaItem,
              agenda_date: nextDate,
              start_time: nextStartTime,
              end_time: nextEndTime,
            }
          : agendaItem,
      ),
    );

    showStatus(
      `Moving "${item.title}" to ${formatAgendaDate(nextDate)} at ${nextStartTime}...`,
    );

    const { data: updatedRows, error: updateError } = await supabase
      .from("agenda_items")
      .update({
        agenda_date: nextDate,
        start_time: nextStartTime,
        end_time: nextEndTime,
      })
      .eq("id", itemId)
      .eq("event_id", activeEvent.id)
      .select("id,title");

    if (updateError) {
      showError(updateError.message || "Could not move agenda item.");
      setCalendarDraggingId(null);
      void refreshAgendaData();
      return;
    }

    try {
      ensureRowsAffected(
        updatedRows,
        "No agenda item was moved. This usually means the row is blocked by RLS or does not belong to the selected event.",
      );
    } catch (err) {
      showError(getErrorMessage(err, "No agenda item was moved."));

      setCalendarDraggingId(null);
      void refreshAgendaData();
      return;
    }

    setStatus(
      `Moved "${item.title}" to ${formatAgendaDate(nextDate)} at ${nextStartTime}.`,
    );
    setCalendarDraggingId(null);
    void refreshAgendaData();
  }

  function handleCalendarColumnDrop(
    e: React.DragEvent<HTMLDivElement>,
    day: string,
  ) {
    e.preventDefault();

    const itemId = calendarDraggingId || e.dataTransfer.getData("text/plain");

    if (!itemId) {
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const y = Math.max(0, e.clientY - rect.top);
    const topEdgeY = Math.max(
      0,
      y - calendarDragOffsetSlots * AGENDA_SLOT_HEIGHT,
    );
    const slotIndex = Math.floor(topEdgeY / AGENDA_SLOT_HEIGHT);
    const nextStartMinutes = Math.min(
      calendarRange.end - AGENDA_SLOT_MINUTES,
      Math.max(
        calendarRange.start,
        calendarRange.start + slotIndex * AGENDA_SLOT_MINUTES,
      ),
    );

    void moveAgendaItemToCalendarSlot(itemId, day, nextStartMinutes);
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
    showStatus('Order changed. Click "Save Order" to keep it.');
  }

  async function saveOrder() {
    if (!activeEvent?.id) {
      showError("No admin working event selected.");
      return;
    }

    try {
      setSavingOrder(true);
      showStatus("Saving agenda order...");

      const sortOrderPayload = items.map((item, index) => ({
        id: item.id,
        event_id: activeEvent.id,
        sort_order: index + 1,
      }));

      const { error } = await supabase
        .from("agenda_items")
        .upsert(sortOrderPayload, {
          onConflict: "id",
        });

      if (error) {
        throw error;
      }

      setStatus("Agenda order saved.");
      await loadPage();
    } catch (err) {
      console.error("saveOrder error:", err);
      showError(err instanceof Error ? err.message : "Failed to save order.");
    } finally {
      setSavingOrder(false);
    }
  }

  async function assignTemplate() {
    if (!activeEvent?.id) {
      showError("No admin working event selected.");
      return;
    }

    try {
      showStatus("Assigning agenda template...");

      const { error } = await supabase
        .from("events")
        .update({
          assigned_agenda_template_id: selectedTemplateId || null,
        })
        .eq("id", activeEvent.id);

      if (error) {
        throw error;
      }

      setAssignedTemplateId(selectedTemplateId || "");

      const templateName =
        templates.find((t) => t.id === selectedTemplateId)?.name || "None";

      setStatus(`Assigned agenda template: ${templateName}.`);
    } catch (err) {
      console.error("assignTemplate error:", err);
      showError(
        err instanceof Error ? err.message : "Could not assign template.",
      );
    }
  }

  async function saveCurrentAgendaAsTemplate() {
    if (!activeEvent?.id) {
      showError("No admin working event selected.");
      return;
    }

    const templateName = newTemplateName.trim();
    const templateDescription = newTemplateDescription.trim();

    if (!templateName) {
      showError(
        "Enter a template name before saving this agenda as a template.",
      );
      return;
    }

    if (items.length === 0) {
      showError("There are no agenda items to save as a template.");
      return;
    }

    const confirmed = await requestConfirmation({
      title: "Save Agenda Template",
      message: `Save the current agenda for ${activeEvent.name} as template "${templateName}"?`,
      confirmLabel: "Save Template",
    });

    if (!confirmed) {
      return;
    }

    try {
      setSavingTemplate(true);
      showStatus("Saving agenda template...");

      const { data: insertedTemplate, error: templateError } = await supabase
        .from("agenda_templates")
        .insert({
          name: templateName,
          description: templateDescription || null,
          status: "active",
        })
        .select("id,name,description,status")
        .single();

      if (templateError || !insertedTemplate?.id) {
        throw templateError || new Error("Could not create agenda template.");
      }

      const templateId = insertedTemplate.id;

      const templateItems = items.map((item, index) => ({
        template_id: templateId,
        template_set_id: templateId,
        external_id:
          item.external_id ||
          [
            "template",
            templateId,
            String(index + 1),
            slugify(item.title || "agenda-item"),
          ].join("-"),
        title: item.title || "Untitled item",
        description: item.description,
        location: item.location,
        speaker: item.speaker,
        category: item.category,
        color: item.color,
        agenda_date: item.agenda_date,
        start_time: item.start_time,
        end_time: item.end_time,
        sort_order: item.sort_order ?? index + 1,
        is_published: item.is_published ?? true,
      }));

      const { error: itemsError } = await supabase
        .from("agenda_template_items")
        .insert(templateItems);

      if (itemsError) {
        throw itemsError;
      }

      setTemplates((prev) => [
        insertedTemplate as AgendaTemplate,
        ...prev.filter((template) => template.id !== templateId),
      ]);

      setSelectedTemplateId(templateId);
      setNewTemplateName("");
      setNewTemplateDescription("");

      setStatus(
        `Saved "${templateName}" with ${templateItems.length} agenda items.`,
      );
    } catch (err) {
      console.error("saveCurrentAgendaAsTemplate error:", err);

      showError(
        err instanceof Error ? err.message : "Could not save agenda template.",
      );
    } finally {
      setSavingTemplate(false);
    }
  }

  async function copyTemplateToEvent() {
    if (!activeEvent?.id) {
      showError("No admin working event selected.");
      return;
    }

    if (!selectedTemplateId) {
      showError("Select a template first.");
      return;
    }

    try {
      showStatus("Copying template items to event...");

      const { data, error } = await supabase
        .from("agenda_template_items")
        .select(
          "external_id,title,description,location,speaker,category,color,agenda_date,start_time,end_time,sort_order,is_published",
        )
        .eq("template_id", selectedTemplateId)
        .order("sort_order", { ascending: true, nullsFirst: false });

      if (error) {
        throw error;
      }

      const rows = ((data || []) as AgendaTemplateItem[]).map(
        (item, index) => ({
          event_id: activeEvent.id,
          external_id:
            item.external_id ||
            [
              "template",
              selectedTemplateId,
              String(index + 1),
              slugify(item.title || "agenda-item"),
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
        }),
      );

      const { error: upsertError } = await supabase
        .from("agenda_items")
        .upsert(rows, {
          onConflict: "event_id,external_id",
        });

      if (upsertError) {
        throw upsertError;
      }

      await loadPage();

      setStatus(`Copied ${rows.length} template items into this event.`);
    } catch (err) {
      console.error("copyTemplateToEvent error:", err);

      showError(
        err instanceof Error
          ? err.message
          : "Could not copy template to event.",
      );
    }
  }

  async function replaceEventFromTemplate() {
    if (!activeEvent?.id) {
      showError("No admin working event selected.");
      return;
    }

    if (!selectedTemplateId) {
      showError("Select a template first.");
      return;
    }

    const confirmed = await requestConfirmation({
      title: "Replace Event Agenda",
      message:
        "Replace the current event agenda with the selected template? This will remove current event agenda items first.",
      confirmLabel: "Replace Agenda",
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    try {
      showStatus("Replacing event agenda from template...");

      const { error: deleteError } = await supabase
        .from("agenda_items")
        .delete()
        .eq("event_id", activeEvent.id);

      if (deleteError) {
        throw deleteError;
      }

      await copyTemplateToEvent();
    } catch (err) {
      console.error("replaceEventFromTemplate error:", err);

      showError(
        err instanceof Error
          ? err.message
          : "Could not replace event from template.",
      );
    }
  }

  async function handleAgendaImportFile(file: File) {
    if (!activeEvent?.id) {
      setImportStatus("No admin working event selected.");
      showError("No admin working event selected.");
      return;
    }

    setImportBusy(true);
    showStatus(`Reading ${file.name} for ${activeEvent.name}...`);
    setImportStatus(`Reading ${file.name} for ${activeEvent.name}...`);

    try {
      const rows = await parseAgendaImportFile(file);

      if (!rows.length) {
        setImportStatus("No rows found in file.");
        return;
      }

      const importWarnings: string[] = [];

      const payloads = rows.flatMap((row, index) => {
        const rowNumber = index + 2;

        const title = normalizeImportText(
          getImportField(row, ["Title", "title"]),
        );

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

        const color = normalizeImportText(
          getImportField(row, ["Color", "color"]),
        );

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
          importWarnings.push(`Row ${rowNumber}: missing Title`);
          return [];
        }

        if (!agendaDate) {
          importWarnings.push(
            `Row ${rowNumber}: missing or invalid Agenda Date`,
          );
          return [];
        }

        if (!startTime) {
          importWarnings.push(
            `Row ${rowNumber}: missing or invalid Start Time`,
          );
          return [];
        }

        const externalId = [
          slugify(title),
          agendaDate || "no-date",
          startTime || "no-time",
        ].join("-");

        return [
          {
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
          },
        ];
      });

      if (!payloads.length) {
        const warningMessage =
          importWarnings.length > 0
            ? importWarnings.join(" | ")
            : "No valid rows found.";

        setImportStatus(`Import failed. ${warningMessage}`);
        showError(`Import failed. ${warningMessage}`);
        return;
      }

      setImportStatus(
        `Importing ${payloads.length} valid rows into ${activeEvent.name}...`,
      );

      const { error: importError } = await supabase
        .from("agenda_items")
        .upsert(payloads, {
          onConflict: "event_id,external_id",
        });

      if (importError) {
        throw new Error(`Bulk import failed: ${importError.message}`);
      }

      void refreshAgendaData();
      setAgendaMode("items");

      if (importWarnings.length > 0) {
        setImportStatus(
          `Agenda import completed with warnings. Imported ${payloads.length} rows. Skipped ${importWarnings.length} rows. ${importWarnings.join(" | ")}`,
        );
      } else {
        setImportStatus(
          `Agenda import complete for ${activeEvent.name}. ${payloads.length} rows imported or updated.`,
        );
      }
    } catch (err) {
      console.error(err);

      const message = err instanceof Error ? err.message : "Unknown error";

      setImportStatus(`Import failed: ${message}`);
      showError(`Import failed: ${message}`);
    } finally {
      setImportBusy(false);
    }
  }

  const assignedTemplateName =
    templates.find((t) => t.id === assignedTemplateId)?.name || "None";
  return (
    <div style={{ padding: 24 }}>
      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title || "Confirm Action"}
        message={confirmDialog?.message || "Are you sure you want to continue?"}
        confirmLabel={confirmDialog?.confirmLabel || "Confirm"}
        cancelLabel={confirmDialog?.cancelLabel || "Cancel"}
        danger={!!confirmDialog?.danger}
        onCancel={() => closeConfirmDialog(false)}
        onConfirm={() => closeConfirmDialog(true)}
      />
      <div
        style={{
          marginBottom: 16,
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={() => {
            window.location.href = "/admin/dashboard";
          }}
          style={{
            padding: isMobile ? "12px 16px" : "8px 12px",
            borderRadius: 12,
            border: "1px solid #cbd5e1",
            background: "#fff",
            cursor: "pointer",
            width: isMobile ? "100%" : "auto",
            minHeight: 48,
            fontSize: isMobile ? 16 : 14,
            fontWeight: 700,
          }}
        >
          ← Return to Dashboard
        </button>
      </div>
      <h1>Admin Agenda</h1>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile
            ? "1fr"
            : "repeat(auto-fit, minmax(180px, auto))",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <button
          type="button"
          onClick={() => setAgendaMode("items")}
          style={{
            padding: isMobile ? "14px 16px" : "10px 14px",
            borderRadius: 12,
            border: agendaMode === "items" ? "none" : "1px solid #cbd5e1",
            background: agendaMode === "items" ? "#111827" : "white",
            color: agendaMode === "items" ? "white" : "#111827",
            WebkitTextFillColor: agendaMode === "items" ? "white" : "#111827",
            textShadow:
              agendaMode === "items" ? "0 1px 1px rgba(0,0,0,0.45)" : "none",
            fontWeight: 700,
            minHeight: 48,
            fontSize: isMobile ? 16 : 14,
            cursor: "pointer",
          }}
        >
          Agenda Items
        </button>

        <button
          type="button"
          onClick={() => setAgendaMode("import")}
          style={{
            padding: isMobile ? "14px 16px" : "10px 14px",
            borderRadius: 12,
            border: agendaMode === "import" ? "none" : "1px solid #cbd5e1",
            background: agendaMode === "import" ? "#111827" : "white",
            color: agendaMode === "import" ? "white" : "#111827",
            WebkitTextFillColor: agendaMode === "import" ? "white" : "#111827",
            textShadow:
              agendaMode === "import" ? "0 1px 1px rgba(0,0,0,0.45)" : "none",
            fontWeight: 700,
            minHeight: 48,
            fontSize: isMobile ? 16 : 14,
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
          {loading ? "Loading agenda data..." : status}
        </div>
        <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
          Assigned Template: {assignedTemplateName}
        </div>
      </div>
      <AgendaImportPanel
        agendaMode={agendaMode}
        activeEvent={activeEvent}
        importBusy={importBusy}
        importStatus={importStatus}
        onImportFile={handleAgendaImportFile}
      />
      <AgendaTemplatePanel
        isMobile={isMobile}
        activeEvent={activeEvent}
        itemCount={items.length}
        templates={templates}
        selectedTemplateId={selectedTemplateId}
        assignedTemplateName={assignedTemplateName}
        newTemplateName={newTemplateName}
        newTemplateDescription={newTemplateDescription}
        savingTemplate={savingTemplate}
        setSelectedTemplateId={setSelectedTemplateId}
        setNewTemplateName={setNewTemplateName}
        setNewTemplateDescription={setNewTemplateDescription}
        onSaveTemplate={saveCurrentAgendaAsTemplate}
        onAssignTemplate={assignTemplate}
        onCopyTemplate={copyTemplateToEvent}
        onReplaceFromTemplate={replaceEventFromTemplate}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 20,
          alignItems: "start",
        }}
      >
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 12,
            display: "grid",
            gap: 8,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 15 }}>
            {form.id ? "Edit Agenda Item" : "Add Agenda Item"}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "1fr"
                : "repeat(4, minmax(180px, 1fr))",
              gap: 8,
              alignItems: "start",
            }}
          >
            <input
              value={form.title}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, title: e.target.value }))
              }
              placeholder="Title"
              style={{ padding: "7px 8px" }}
            />

            <input
              value={form.location}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, location: e.target.value }))
              }
              placeholder="Location"
              style={{ padding: "7px 8px" }}
            />

            <input
              value={form.speaker}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, speaker: e.target.value }))
              }
              placeholder="Speaker"
              style={{ padding: "7px 8px" }}
            />

            <input
              value={form.category}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, category: e.target.value }))
              }
              placeholder="Category"
              style={{ padding: "7px 8px" }}
            />

            <input
              value={form.color}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, color: e.target.value }))
              }
              placeholder="Color"
              style={{ padding: "7px 8px" }}
            />

            <input
              value={form.external_id}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, external_id: e.target.value }))
              }
              placeholder="External ID (optional)"
              style={{ padding: "7px 8px" }}
            />

            <label style={{ display: "grid", gap: 3 }}>
              <span style={{ fontSize: 12, color: "#555" }}>Date</span>
              <input
                type="date"
                value={form.agenda_date}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, agenda_date: e.target.value }))
                }
                style={{ padding: "7px 8px" }}
              />
            </label>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <label style={{ display: "grid", gap: 3 }}>
                <span style={{ fontSize: 12, color: "#555" }}>Start</span>
                <input
                  type="time"
                  value={form.start_time}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, start_time: e.target.value }))
                  }
                  style={{ padding: "7px 8px" }}
                />
              </label>

              <label style={{ display: "grid", gap: 3 }}>
                <span style={{ fontSize: 12, color: "#555" }}>End</span>
                <input
                  type="time"
                  value={form.end_time}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, end_time: e.target.value }))
                  }
                  style={{ padding: "7px 8px" }}
                />
              </label>
            </div>

            <label style={{ display: "grid", gap: 3 }}>
              <span style={{ fontSize: 12, color: "#555" }}>Sort</span>
              <input
                value={form.sort_order}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, sort_order: e.target.value }))
                }
                placeholder="Sort"
                style={{ padding: "7px 8px" }}
              />
            </label>

            <label
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                paddingTop: isMobile ? 0 : 24,
                whiteSpace: "nowrap",
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

          <textarea
            value={form.description}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, description: e.target.value }))
            }
            placeholder="Description"
            rows={2}
            style={{ padding: "7px 8px", minHeight: 48 }}
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
              margin: 12,
              border: "1px solid #d1d5db",
              borderRadius: 12,
              background: "#ffffff",
              overflow: "auto",
            }}
          >
            <div
              style={{
                padding: 14,
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>
                  Calendar Scheduler Preview
                </div>
                <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
                  Admin-only 15-minute schedule grid. Items fill their full time
                  duration and overlapping activities display side-by-side.
                </div>
              </div>

              <button
                type="button"
                onClick={() => setCompactCalendarView((prev) => !prev)}
                style={{
                  padding: "7px 10px",
                  borderRadius: 999,
                  border: "1px solid #cbd5e1",
                  background: compactCalendarView ? "#e0f2fe" : "#ffffff",
                  color: "#0f172a",
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {compactCalendarView ? "Compact View On" : "Compact View Off"}
              </button>
            </div>

            {calendarDays.length === 0 ? (
              <div style={{ padding: 16, color: "#666" }}>
                Add agenda dates and start times to use the scheduler preview.
              </div>
            ) : (
              <div
                style={{
                  minWidth: compactCalendarView
                    ? Math.max(720, calendarDays.length * 180)
                    : Math.max(820, calendarDays.length * 260),
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: compactCalendarView
                      ? `76px repeat(${calendarDays.length}, minmax(170px, 1fr))`
                      : `92px repeat(${calendarDays.length}, minmax(240px, 1fr))`,
                    position: "sticky",
                    top: 0,
                    zIndex: 4,
                    background: "#f8fafc",
                    borderBottom: "1px solid #e5e7eb",
                  }}
                >
                  <div style={{ padding: 10, fontWeight: 800 }}>Time</div>
                  {calendarDays.map((day) => (
                    <div
                      key={day}
                      style={{
                        padding: 10,
                        fontWeight: 900,
                        borderLeft: "1px solid #e5e7eb",
                      }}
                    >
                      {formatAgendaDate(day)}
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: compactCalendarView
                      ? `76px repeat(${calendarDays.length}, minmax(170px, 1fr))`
                      : `92px repeat(${calendarDays.length}, minmax(240px, 1fr))`,
                    minHeight: calendarGridHeight,
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      height: calendarGridHeight,
                      background: "#f8fafc",
                      borderRight: "1px solid #e5e7eb",
                    }}
                  >
                    {calendarTimeSlots.slice(0, -1).map((slot) => (
                      <div
                        key={slot}
                        style={{
                          height: AGENDA_SLOT_HEIGHT,
                          borderTop:
                            slot % 60 === 0
                              ? "1px solid #cbd5e1"
                              : "1px solid transparent",
                          borderBottom: "1px solid #eef2f7",
                          padding: "2px 8px",
                          fontSize: slot % 60 === 0 ? 12 : 10,
                          fontWeight: slot % 60 === 0 ? 800 : 500,
                          color: slot % 60 === 0 ? "#334155" : "#94a3b8",
                        }}
                      >
                        {slot % 60 === 0 ? formatCalendarSlot(slot) : ""}
                      </div>
                    ))}
                  </div>

                  {calendarDays.map((day) => {
                    const dayItems = filteredItems.filter(
                      (item) => item.agenda_date === day,
                    );

                    const blocks = buildAgendaCalendarBlocks(
                      dayItems,
                      calendarRange.start,
                    );

                    return (
                      <div
                        key={day}
                        data-agenda-calendar-day={day}
                        onDragOver={(e) => handleCalendarDragOver(e, day)}
                        onDragLeave={() => setCalendarDropPreview(null)}
                        onDrop={(e) => handleCalendarColumnDrop(e, day)}
                        style={{
                          position: "relative",
                          height: calendarGridHeight,
                          borderLeft: "1px solid #e5e7eb",
                          background: calendarDraggingId
                            ? "#f8fafc"
                            : "#ffffff",
                        }}
                      >
                        {calendarTimeSlots.slice(0, -1).map((slot) => (
                          <div
                            key={`${day}-${slot}`}
                            style={{
                              height: AGENDA_SLOT_HEIGHT,
                              borderTop:
                                slot % 60 === 0
                                  ? "1px solid #dbe4ef"
                                  : "1px solid transparent",
                              borderBottom: "1px solid #f1f5f9",
                              background:
                                slot % 60 === 0 ? "#ffffff" : "#fcfdff",
                            }}
                          />
                        ))}

                        {calendarDropPreview?.day === day ? (
                          <div
                            style={{
                              position: "absolute",
                              top:
                                Math.floor(
                                  (calendarDropPreview.minutes -
                                    calendarRange.start) /
                                    AGENDA_SLOT_MINUTES,
                                ) * AGENDA_SLOT_HEIGHT,
                              left: 0,
                              right: 0,
                              height: 0,
                              borderTop: "3px solid #2563eb",
                              boxShadow: "0 0 0 2px rgba(37,99,235,0.18)",
                              pointerEvents: "none",
                              zIndex: 5,
                            }}
                          >
                            <div
                              style={{
                                position: "absolute",
                                right: 8,
                                top: -24,
                                background: "#2563eb",
                                color: "#ffffff",
                                WebkitTextFillColor: "#ffffff",
                                fontSize: 11,
                                fontWeight: 900,
                                padding: "3px 7px",
                                borderRadius: 999,
                              }}
                            >
                              {minutesToTime(calendarDropPreview.minutes)}
                            </div>
                          </div>
                        ) : null}

                        {calendarResizePreview ? (
                          <div
                            style={{
                              position: "absolute",
                              top:
                                Math.floor(
                                  (calendarResizePreview.minutes -
                                    calendarRange.start) /
                                    AGENDA_SLOT_MINUTES,
                                ) * AGENDA_SLOT_HEIGHT,
                              left: 0,
                              right: 0,
                              height: 0,
                              borderTop: "3px dashed #16a34a",
                              boxShadow: "0 0 0 2px rgba(22,163,74,0.14)",
                              pointerEvents: "none",
                              zIndex: 6,
                            }}
                          >
                            <div
                              style={{
                                position: "absolute",
                                right: 8,
                                top: -24,
                                background: "#16a34a",
                                color: "#ffffff",
                                WebkitTextFillColor: "#ffffff",
                                fontSize: 11,
                                fontWeight: 900,
                                padding: "3px 7px",
                                borderRadius: 999,
                              }}
                            >
                              {calendarResizeDragRef.current?.edge === "start"
                                ? "Starts"
                                : "Ends"}{" "}
                              {minutesToTime(calendarResizePreview.minutes)}
                            </div>
                          </div>
                        ) : null}

                        {blocks.map((block) => {
                          const item = block.item;
                          const laneWidth = 100 / block.laneCount;
                          const left = block.lane * laneWidth;

                          return (
                            <button
                              key={item.id}
                              type="button"
                              draggable
                              onDragStart={(e) =>
                                handleCalendarDragStart(e, item.id)
                              }
                              onDragEnd={() => {
                                setCalendarDraggingId(null);
                                setCalendarDropPreview(null);
                              }}
                              onClick={() => setForm(formFromItem(item))}
                              style={{
                                position: "absolute",
                                top: block.top + 2,
                                left: `calc(${left}% + 4px)`,
                                width: `calc(${laneWidth}% - 8px)`,
                                height: block.height,
                                border: "1px solid rgba(15,23,42,0.16)",
                                borderLeft: `6px solid ${getAgendaColor(
                                  item.category || "",
                                  item.color || "",
                                )}`,
                                borderRadius: 10,
                                background: "#ffffff",
                                color: "#111827",
                                textAlign: "left",
                                padding: "16px 8px 16px",
                                cursor: "grab",
                                overflow: "hidden",
                                boxShadow:
                                  calendarDraggingId === item.id
                                    ? "0 0 0 3px rgba(96,165,250,0.35)"
                                    : "0 2px 8px rgba(15,23,42,0.10)",
                              }}
                              title="Drag to move. Click to edit. Drag top/bottom handles to change time."
                            >
                              <span
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  beginCalendarStartResize(e, item);
                                }}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                draggable={false}
                                style={{
                                  position: "absolute",
                                  left: 12,
                                  right: 12,
                                  top: 4,
                                  height: 8,
                                  borderRadius: 999,
                                  background: "rgba(37,99,235,0.24)",
                                  cursor: "ns-resize",
                                  zIndex: 7,
                                }}
                                title="Drag to change start time"
                              />

                              <div style={{ fontWeight: 900, fontSize: 12 }}>
                                {item.title}
                              </div>

                              <div
                                style={{
                                  fontSize: 11,
                                  color: "#475569",
                                  marginTop: 3,
                                }}
                              >
                                {formatAgendaTime(
                                  item.start_time,
                                  item.end_time,
                                )}
                              </div>

                              <div
                                style={{
                                  fontSize: 10,
                                  color: "#64748b",
                                  fontWeight: 800,
                                  marginTop: 2,
                                }}
                              >
                                {formatDurationLabel(
                                  agendaDurationMinutes(item),
                                )}
                              </div>

                              {item.location ? (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: "#334155",
                                    marginTop: 3,
                                  }}
                                >
                                  📍 {item.location}
                                </div>
                              ) : null}

                              <span
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  beginCalendarEndResize(e, item);
                                }}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                draggable={false}
                                style={{
                                  position: "absolute",
                                  left: 12,
                                  right: 12,
                                  bottom: 4,
                                  height: 8,
                                  borderRadius: 999,
                                  background: "rgba(22,163,74,0.28)",
                                  cursor: "ns-resize",
                                  zIndex: 7,
                                }}
                                title="Drag to change end time"
                              />
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
                      ? isMobile
                        ? "1fr"
                        : "72px 1fr auto"
                      : isMobile
                        ? "1fr"
                        : "52px 1fr auto",
                    gap: 12,
                    padding: isMobile ? 16 : 14,
                    borderTop: "1px solid #eee",
                    background: draggedId === item.id ? "#f8fafc" : "white",
                    borderLeft: `6px solid ${getAgendaColor(
                      item.category || "",
                      item.color || "",
                    )}`,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gap: 6,
                      alignContent: "start",
                      justifyItems: "center",
                      gridAutoFlow: isMobile ? "column" : "row",
                      justifyContent: isMobile ? "start" : "center",
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
                            minWidth: 40,
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
                            minWidth: 40,
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
                          fontSize: 20,
                          color: "#666",
                          cursor: "grab",
                          userSelect: "none",
                          width: 40,
                          height: 40,
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
                      display: "grid",
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 800,
                          fontSize: isMobile ? 16 : 15,
                          color: "#111827",
                        }}
                      >
                        {item.title}
                      </div>

                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          padding: "4px 8px",
                          borderRadius: 999,
                          background: item.is_published ? "#dcfce7" : "#fee2e2",
                          color: item.is_published ? "#166534" : "#991b1b",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.is_published ? "Published" : "Hidden"}
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: 13,
                        color: "#475569",
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span>{formatAgendaDate(item.agenda_date)}</span>
                      <span>•</span>
                      <span>
                        {formatAgendaTime(item.start_time, item.end_time)}
                      </span>
                      <span>•</span>
                      <span>
                        {formatDurationLabel(agendaDurationMinutes(item))}
                      </span>
                    </div>

                    {item.location ? (
                      <div
                        style={{
                          fontSize: 13,
                          color: "#334155",
                        }}
                      >
                        📍 {item.location}
                      </div>
                    ) : null}

                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          padding: "4px 8px",
                          borderRadius: 999,
                          background: "#f1f5f9",
                          color: "#334155",
                        }}
                      >
                        {item.category || "No category"}
                      </span>

                      {item.speaker ? (
                        <span
                          style={{
                            fontSize: 12,
                            color: "#475569",
                          }}
                        >
                          Speaker: {item.speaker}
                        </span>
                      ) : null}
                    </div>

                    {item.description ? (
                      <div
                        style={{
                          fontSize: 13,
                          color: "#555",
                          lineHeight: 1.45,
                        }}
                      >
                        {item.description}
                      </div>
                    ) : null}

                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        flexWrap: "wrap",
                        alignItems: "center",
                        marginTop: 2,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 999,
                            background: item.color || "#cbd5e1",
                            border: "1px solid rgba(0,0,0,0.15)",
                            display: "inline-block",
                          }}
                        />

                        <span style={{ fontSize: 12, color: "#777" }}>
                          {item.color || "Auto Color"}
                        </span>
                      </div>

                      <span style={{ fontSize: 12, color: "#777" }}>
                        Sort: {item.sort_order ?? "—"}
                      </span>

                      {item.source ? (
                        <span style={{ fontSize: 12, color: "#777" }}>
                          Source: {item.source}
                        </span>
                      ) : null}
                    </div>
                  </button>

                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      alignContent: "start",
                      gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => void togglePublished(item)}
                      style={{
                        minHeight: 42,
                      }}
                    >
                      {item.is_published ? "Unpublish" : "Publish"}
                    </button>

                    <button
                      type="button"
                      onClick={() => void deleteItem(item.id)}
                      style={{
                        minHeight: 42,
                      }}
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
