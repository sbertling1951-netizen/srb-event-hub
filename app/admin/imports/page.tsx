"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import {
  getCurrentAdminAccess,
  canAccessEvent,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";

type EventContext = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type RawRow = Record<string, unknown>;

type ActivityGroup = {
  prefix: string;
  nameCol: string;
  priceCol: string;
  qtyCol: string;
};

type ActivityPreview = {
  activity_name: string;
  quantity: number;
  price: number | null;
  raw_name: string;
  source_column_prefix: string;
};

type ParsedRegistration = {
  rowNumber: number;
  entry_id: string;
  email: string;
  pilot_first: string;
  pilot_last: string;
  copilot_first: string;
  copilot_last: string;
  nickname: string;
  copilot_nickname: string;
  additional_attendees: string;
  membership_number: string;
  primary_phone: string;
  cell_phone: string;
  city: string;
  state: string;
  wants_to_volunteer: boolean;
  is_first_timer: boolean;
  coach_manufacturer: string;
  coach_model: string;
  share_with_attendees: boolean;
  special_events_raw: string;
  raw_import: RawRow;
  activities: ActivityPreview[];
  warnings: string[];
};

type PrintSettingsRow = {
  id?: string;
  event_id: string;
  name_tag_bg_url: string | null;
  coach_plate_bg_url: string | null;
};

const ADMIN_EVENT_STORAGE_KEY = "fcoc-admin-event-context";

function getStoredAdminEvent(): EventContext | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(ADMIN_EVENT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeKey(value: string) {
  return value.trim();
}

function text(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function parseMoney(value: unknown): number | null {
  const raw = text(value).replace(/[$,]/g, "");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

function parseBoolYesNo(value: unknown) {
  const raw = text(value).toLowerCase();
  return raw.startsWith("yes");
}

function getValue(row: RawRow, key: string) {
  return row[key] ?? row[normalizeKey(key)] ?? "";
}

function detectActivityGroups(headers: string[]) {
  const defs: Record<
    string,
    { prefix: string; nameCol?: string; priceCol?: string; qtyCol?: string }
  > = {};

  for (const original of headers) {
    const header = normalizeKey(original);
    const match = header.match(/^(.*)\s+\((Name|Price|Quantity)\)$/i);
    if (!match) continue;

    const prefix = match[1].trim();
    const kind = match[2].toLowerCase();

    if (!defs[prefix]) defs[prefix] = { prefix };

    if (kind === "name") defs[prefix].nameCol = original;
    if (kind === "price") defs[prefix].priceCol = original;
    if (kind === "quantity") defs[prefix].qtyCol = original;
  }

  return Object.values(defs)
    .filter(
      (item): item is ActivityGroup =>
        !!item.nameCol && !!item.priceCol && !!item.qtyCol,
    )
    .filter((item) => {
      const skip = [
        "Product Name",
        "Credit Card",
        "Pilot Name",
        "Co-Pilot Name",
      ];
      return !skip.some((prefix) => item.prefix.startsWith(prefix));
    });
}

function buildActivities(row: RawRow, groups: ActivityGroup[]) {
  const activities: ActivityPreview[] = [];

  for (const group of groups) {
    const quantity = parseInteger(getValue(row, group.qtyCol));
    if (!quantity || quantity <= 0) continue;

    const rawName = text(getValue(row, group.nameCol)) || group.prefix;
    const price = parseMoney(getValue(row, group.priceCol));

    activities.push({
      activity_name: group.prefix,
      quantity,
      price,
      raw_name: rawName,
      source_column_prefix: group.prefix,
    });
  }

  return activities;
}

function mapRow(row: RawRow, rowNumber: number, groups: ActivityGroup[]) {
  const entry_id = text(getValue(row, "Entry Id"));
  const email = text(getValue(row, "Email Address")).toLowerCase();
  const pilot_first = text(getValue(row, "Pilot Name (First)"));
  const pilot_last = text(getValue(row, "Pilot Name (Last)"));
  const copilot_first = text(getValue(row, "Co-Pilot Name (First)"));
  const copilot_last = text(getValue(row, "Co-Pilot Name (Last)"));
  const nickname = text(getValue(row, "Nickname for Badge"));
  const copilot_nickname = text(getValue(row, "Nickname for Badge.1"));
  const additional_attendees = text(
    getValue(row, "Additional attendees, if so give name(s) and age(s)"),
  );
  const membership_number = text(getValue(row, "FCOC Membership Number"));
  const primary_phone = text(getValue(row, "Primary Phone #"));
  const cell_phone = text(getValue(row, "Cell Phone #"));
  const city = text(getValue(row, "Address (City)"));
  const state = text(getValue(row, "Address (State / Province)"));
  const coach_manufacturer = text(getValue(row, "Coach Manufacturer"));
  const coach_model = text(getValue(row, "Coach Model"));
  const special_events_raw = text(getValue(row, "Special Events"));
  const share_with_attendees = parseBoolYesNo(
    getValue(row, "Ok to share your email with other attendees?"),
  );
  const wants_to_volunteer = parseBoolYesNo(
    getValue(row, "Would you like to volunteer to help with the event?"),
  );
  const is_first_timer = parseBoolYesNo(
    getValue(row, "First time at an FCOC event?"),
  );

  const warnings: string[] = [];

  if (!entry_id) warnings.push("Missing Entry Id");
  if (!email) warnings.push("Missing Email Address");
  if (!pilot_first && !pilot_last) warnings.push("Missing pilot name");

  return {
    rowNumber,
    entry_id,
    email,
    pilot_first,
    pilot_last,
    copilot_first,
    copilot_last,
    nickname,
    copilot_nickname,
    additional_attendees,
    membership_number,
    primary_phone,
    cell_phone,
    city,
    state,
    wants_to_volunteer,
    is_first_timer,
    coach_manufacturer,
    coach_model,
    share_with_attendees,
    special_events_raw,
    raw_import: row,
    activities: buildActivities(row, groups),
    warnings,
  };
}

export default function AdminAttendeeImportsPage() {
  const [currentEvent, setCurrentEvent] = useState<EventContext | null>(null);
  const [availableEvents, setAvailableEvents] = useState<EventContext[]>([]);
  const [selectedImportEventId, setSelectedImportEventId] = useState("");
  const [loadedForEventId, setLoadedForEventId] = useState("");

  const [rows, setRows] = useState<ParsedRegistration[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");

  const [loadingEvent, setLoadingEvent] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState("Load a CSV or XLSX file to begin.");
  const [error, setError] = useState<string | null>(null);

  const [printSettings, setPrintSettings] = useState<PrintSettingsRow | null>(
    null,
  );
  const [nameTagFile, setNameTagFile] = useState<File | null>(null);
  const [coachPlateFile, setCoachPlateFile] = useState<File | null>(null);
  const [assetStatus, setAssetStatus] = useState("");
  const [assetError, setAssetError] = useState<string | null>(null);
  const [savingNameTagBg, setSavingNameTagBg] = useState(false);
  const [savingCoachPlateBg, setSavingCoachPlateBg] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    async function loadEvents() {
      setLoadingEvent(true);
      setError(null);
      setAccessDenied(false);
      setStatus("Checking admin access...");

      try {
        const admin = await getCurrentAdminAccess();

        if (!admin) {
          setCurrentEvent(null);
          setAvailableEvents([]);
          setSelectedImportEventId("");
          setLoadedForEventId("");
          setRows([]);
          setHeaders([]);
          setFileName("");
          setError("No admin access.");
          setStatus("Access denied.");
          setAccessDenied(true);
          return;
        }

        if (!hasPermission(admin, "can_import_attendees")) {
          setCurrentEvent(null);
          setAvailableEvents([]);
          setSelectedImportEventId("");
          setLoadedForEventId("");
          setRows([]);
          setHeaders([]);
          setFileName("");
          setError("You do not have permission to import attendees.");
          setStatus("Access denied.");
          setAccessDenied(true);
          return;
        }

        const stored = getStoredAdminEvent();
        setCurrentEvent(stored);

        const { data, error } = await supabase
          .from("events")
          .select("id, name, venue_name, location, start_date, end_date")
          .order("start_date", { ascending: false });

        if (error) throw error;

        const accessibleEvents = ((data || []) as EventContext[]).filter(
          (event) => !!event.id && canAccessEvent(admin, event.id),
        );

        setAvailableEvents(accessibleEvents);

        if (stored?.id && canAccessEvent(admin, stored.id)) {
          setSelectedImportEventId(stored.id);
        } else if (accessibleEvents.length > 0 && accessibleEvents[0].id) {
          setSelectedImportEventId(accessibleEvents[0].id);
        } else {
          setSelectedImportEventId("");
          setLoadedForEventId("");
          setRows([]);
          setHeaders([]);
          setFileName("");
          setStatus("No accessible events available for import.");
        }
      } catch (err) {
        console.error("Error loading events:", err);
        setCurrentEvent(null);
        setAvailableEvents([]);
        setSelectedImportEventId("");
        setLoadedForEventId("");
        setRows([]);
        setHeaders([]);
        setFileName("");
        setStatus("Could not load events.");
      } finally {
        setLoadingEvent(false);
      }
    }

    void loadEvents();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-admin-event-context" ||
        e.key === "fcoc-admin-event-changed" ||
        e.key === "fcoc-user-mode" ||
        e.key === "fcoc-user-mode-changed"
      ) {
        void loadEvents();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    async function loadPrintSettings() {
      if (!selectedImportEventId) {
        setPrintSettings(null);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("event_print_settings")
          .select("*")
          .eq("event_id", selectedImportEventId)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          setPrintSettings(data as PrintSettingsRow);
        } else {
          setPrintSettings({
            event_id: selectedImportEventId,
            name_tag_bg_url: null,
            coach_plate_bg_url: null,
          });
        }

        setAssetStatus("");
        setAssetError(null);
      } catch (err: any) {
        console.error("Error loading print settings:", err);
        setPrintSettings({
          event_id: selectedImportEventId,
          name_tag_bg_url: null,
          coach_plate_bg_url: null,
        });
        setAssetError(err?.message || "Could not load print settings.");
      }
    }

    void loadPrintSettings();
  }, [selectedImportEventId]);

  const validRows = useMemo(
    () => rows.filter((row) => row.entry_id && row.email),
    [rows],
  );

  const previewRows = useMemo(() => rows.slice(0, 12), [rows]);

  const activityCount = useMemo(
    () => rows.reduce((sum, row) => sum + row.activities.length, 0),
    [rows],
  );

  const selectedImportEvent =
    availableEvents.find((event) => event.id === selectedImportEventId) || null;

  const eventChangedSinceLoad =
    !!rows.length &&
    !!loadedForEventId &&
    !!selectedImportEventId &&
    loadedForEventId !== selectedImportEventId;

  async function handleFileChange(file: File) {
    if (!selectedImportEventId) {
      setError("Select a target event before loading a file.");
      return;
    }
    if (accessDenied) {
      setError("You do not have access to import into this event.");
      return;
    }

    setParsing(true);
    setError(null);
    setStatus(`Reading ${file.name}...`);
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      const json = XLSX.utils.sheet_to_json<RawRow>(worksheet, {
        defval: "",
        raw: false,
      });

      if (!json.length) {
        setRows([]);
        setHeaders([]);
        setLoadedForEventId("");
        setStatus("No rows found in file.");
        return;
      }

      const foundHeaders = Object.keys(json[0] || {});
      const groups = detectActivityGroups(foundHeaders);
      const parsed = json.map((row, index) => mapRow(row, index + 2, groups));

      setHeaders(foundHeaders);
      setRows(parsed);
      setLoadedForEventId(selectedImportEventId);
      setStatus(
        `Loaded ${parsed.length} rows. ${groups.length} activity groups detected.`,
      );
    } catch (err) {
      console.error(err);
      setError("Could not parse file.");
      setRows([]);
      setHeaders([]);
      setLoadedForEventId("");
      setStatus("Parse failed.");
    } finally {
      setParsing(false);
    }
  }

  async function ensurePrintSettingsRow(nextValues: Partial<PrintSettingsRow>) {
    if (!selectedImportEventId) return null;

    const payload = {
      event_id: selectedImportEventId,
      name_tag_bg_url:
        nextValues.name_tag_bg_url ?? printSettings?.name_tag_bg_url ?? null,
      coach_plate_bg_url:
        nextValues.coach_plate_bg_url ??
        printSettings?.coach_plate_bg_url ??
        null,
    };

    const { data, error } = await supabase
      .from("event_print_settings")
      .upsert(payload, { onConflict: "event_id" })
      .select("*")
      .single();

    if (error) throw error;

    const row = data as PrintSettingsRow;
    setPrintSettings(row);
    return row;
  }

  async function uploadFileToBucket(file: File, path: string) {
    const { error: uploadError } = await supabase.storage
      .from("event-assets")
      .upload(path, file, {
        upsert: true,
        contentType: file.type || "image/png",
      });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from("event-assets").getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleUploadNameTagBackground() {
    if (!selectedImportEventId || !nameTagFile || accessDenied) return;

    try {
      setSavingNameTagBg(true);
      setAssetError(null);
      setAssetStatus("Uploading name tag background...");

      const ext = nameTagFile.name.split(".").pop() || "png";
      const path = `${selectedImportEventId}/name-tag-bg.${ext}`;
      const publicUrl = await uploadFileToBucket(nameTagFile, path);

      await ensurePrintSettingsRow({ name_tag_bg_url: publicUrl });
      setNameTagFile(null);
      setAssetStatus("Name tag background saved.");
    } catch (err: any) {
      console.error(err);
      setAssetError(err?.message || "Could not save name tag background.");
      setAssetStatus("");
    } finally {
      setSavingNameTagBg(false);
    }
  }

  async function handleUploadCoachPlateBackground() {
    if (!selectedImportEventId || !coachPlateFile || accessDenied) return;

    try {
      setSavingCoachPlateBg(true);
      setAssetError(null);
      setAssetStatus("Uploading coach plate background...");

      const ext = coachPlateFile.name.split(".").pop() || "png";
      const path = `${selectedImportEventId}/coach-plate-bg.${ext}`;
      const publicUrl = await uploadFileToBucket(coachPlateFile, path);

      await ensurePrintSettingsRow({ coach_plate_bg_url: publicUrl });
      setCoachPlateFile(null);
      setAssetStatus("Coach plate background saved.");
    } catch (err: any) {
      console.error(err);
      setAssetError(err?.message || "Could not save coach plate background.");
      setAssetStatus("");
    } finally {
      setSavingCoachPlateBg(false);
    }
  }

  async function clearNameTagBackground() {
    if (!selectedImportEventId || accessDenied) return;

    try {
      setAssetError(null);
      setAssetStatus("Removing name tag background...");
      await ensurePrintSettingsRow({ name_tag_bg_url: null });
      setAssetStatus("Name tag background removed.");
    } catch (err: any) {
      console.error(err);
      setAssetError(err?.message || "Could not remove name tag background.");
      setAssetStatus("");
    }
  }

  async function clearCoachPlateBackground() {
    if (!selectedImportEventId || accessDenied) return;

    try {
      setAssetError(null);
      setAssetStatus("Removing coach plate background...");
      await ensurePrintSettingsRow({ coach_plate_bg_url: null });
      setAssetStatus("Coach plate background removed.");
    } catch (err: any) {
      console.error(err);
      setAssetError(err?.message || "Could not remove coach plate background.");
      setAssetStatus("");
    }
  }

  async function handleImport() {
    if (!selectedImportEventId) {
      setError("No target event selected.");
      return;
    }

    if (accessDenied) {
      setError("You do not have access to import into this event.");
      return;
    }

    if (eventChangedSinceLoad) {
      setError("Target event changed after file load. Reload the file first.");
      return;
    }

    if (!validRows.length) {
      setError("No valid rows to import.");
      return;
    }

    setImporting(true);
    setError(null);
    setStatus("Importing attendees...");

    try {
      const importEmails = Array.from(
        new Set(validRows.map((row) => row.email).filter(Boolean)),
      );

      const importEntryIds = Array.from(
        new Set(validRows.map((row) => row.entry_id).filter(Boolean)),
      );

      let existingAttendees: any[] = [];

      if (importEmails.length || importEntryIds.length) {
        const emailFilter = importEmails.length
          ? `email.in.(${importEmails.map((e) => `"${e}"`).join(",")})`
          : null;

        const entryFilter = importEntryIds.length
          ? `entry_id.in.(${importEntryIds.map((e) => `"${e}"`).join(",")})`
          : null;

        const orFilter = [emailFilter, entryFilter].filter(Boolean).join(",");

        const { data, error } = await supabase
          .from("attendees")
          .select("id, event_id, entry_id, email")
          .eq("event_id", selectedImportEventId)
          .or(orFilter);

        if (error) throw error;
        existingAttendees = data || [];
      }

      const existingByEmail = new Map(
        existingAttendees
          .filter((item) => item.email)
          .map((item) => [String(item.email).toLowerCase(), item]),
      );

      const existingByEntryId = new Map(
        existingAttendees
          .filter((item) => item.entry_id)
          .map((item) => [String(item.entry_id), item]),
      );

      const attendeePayload = validRows.map((row) => {
        const existingMatch =
          existingByEmail.get(row.email) || existingByEntryId.get(row.entry_id);

        return {
          existingId: existingMatch?.id ?? null,
          event_id: selectedImportEventId,
          entry_id: row.entry_id,
          email: row.email || null,
          pilot_first: row.pilot_first || null,
          pilot_last: row.pilot_last || null,
          copilot_first: row.copilot_first || null,
          copilot_last: row.copilot_last || null,
          nickname: row.nickname || null,
          copilot_nickname: row.copilot_nickname || null,
          membership_number: row.membership_number || null,
          primary_phone: row.primary_phone || null,
          cell_phone: row.cell_phone || null,
          city: row.city || null,
          state: row.state || null,
          wants_to_volunteer: row.wants_to_volunteer,
          is_first_timer: row.is_first_timer,
          coach_manufacturer: row.coach_manufacturer || null,
          coach_model: row.coach_model || null,
          share_with_attendees: row.share_with_attendees,
          special_events_raw: row.special_events_raw || null,
          raw_import: row.raw_import,
        };
      });

      const importRowPayload = validRows.map((row) => ({
        event_id: selectedImportEventId,
        import_type: "attendee_roster",
        source_filename: fileName || null,
        row_number: row.rowNumber,
        entry_id: row.entry_id || null,
        email: row.email || null,
        membership_number: row.membership_number || null,
        pilot_first: row.pilot_first || null,
        pilot_last: row.pilot_last || null,
        pilot_badge_nickname: row.nickname || null,
        copilot_first: row.copilot_first || null,
        copilot_last: row.copilot_last || null,
        copilot_badge_nickname: row.copilot_nickname || null,
        additional_attendees: row.additional_attendees || null,
        city: row.city || null,
        state: row.state || null,
        primary_phone: row.primary_phone || null,
        cell_phone: row.cell_phone || null,
        share_with_attendees: row.share_with_attendees,
        wants_to_volunteer: row.wants_to_volunteer,
        is_first_timer: row.is_first_timer,
        coach_manufacturer: row.coach_manufacturer || null,
        coach_model: row.coach_model || null,
        special_events_raw: row.special_events_raw || null,
        raw_import: row.raw_import,
      }));

      const rowsToUpdate = attendeePayload
        .filter((row) => row.existingId)
        .map(({ existingId, ...rest }) => ({
          id: existingId,
          ...rest,
        }));

      const rowsToInsert = attendeePayload
        .filter((row) => !row.existingId)
        .map(({ existingId, ...rest }) => rest);

      if (rowsToUpdate.length) {
        const { error: updateError } = await supabase
          .from("attendees")
          .upsert(rowsToUpdate, {
            onConflict: "id",
          });

        if (updateError) throw updateError;
      }

      if (rowsToInsert.length) {
        const { error: insertError } = await supabase
          .from("attendees")
          .insert(rowsToInsert);

        if (insertError) throw insertError;
      }

      const activityPayload = validRows.flatMap((row) =>
        row.activities.map((activity) => ({
          event_id: selectedImportEventId,
          entry_id: row.entry_id,
          attendee_email: row.email,
          activity_name: activity.activity_name,
          quantity: activity.quantity,
          price: activity.price,
          raw_name: activity.raw_name,
          source_column_prefix: activity.source_column_prefix,
        })),
      );

      const importedEntryIds = validRows.map((row) => row.entry_id);

      if (importedEntryIds.length) {
        const { error: deleteImportRowsError } = await supabase
          .from("event_import_rows")
          .delete()
          .eq("event_id", selectedImportEventId)
          .eq("import_type", "attendee_roster")
          .in("entry_id", importedEntryIds);

        if (deleteImportRowsError) throw deleteImportRowsError;
      }

      if (importRowPayload.length) {
        const { error: importRowsError } = await supabase
          .from("event_import_rows")
          .insert(importRowPayload);

        if (importRowsError) throw importRowsError;
      }

      if (importedEntryIds.length) {
        const { error: deleteError } = await supabase
          .from("attendee_activities")
          .delete()
          .eq("event_id", selectedImportEventId)
          .in("entry_id", importedEntryIds);

        if (deleteError) throw deleteError;
      }

      if (activityPayload.length) {
        const { error: activityError } = await supabase
          .from("attendee_activities")
          .insert(activityPayload);

        if (activityError) throw activityError;
      }

      setStatus(
        `Imported ${validRows.length} attendees, ${importRowPayload.length} source rows, and ${activityPayload.length} activity rows into ${
          selectedImportEvent?.name || "selected event"
        }.`,
      );
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Import failed.");
      setStatus("Import failed.");
    } finally {
      setImporting(false);
    }
  }

  if (!loadingEvent && accessDenied) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Imports</h1>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          You do not have access to this page.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Imports</h1>

        <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
          <div style={{ fontWeight: 600 }}>Target Event</div>

          <select
            value={selectedImportEventId}
            onChange={(e) => setSelectedImportEventId(e.target.value)}
            disabled={loadingEvent || accessDenied}
            style={{
              width: "100%",
              maxWidth: 560,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "white",
            }}
          >
            <option value="">Select an event</option>
            {availableEvents.map((event) => (
              <option key={event.id} value={event.id || ""}>
                {event.name || event.eventName || "Untitled Event"}
                {event.location ? ` • ${event.location}` : ""}
                {event.start_date ? ` • ${event.start_date}` : ""}
              </option>
            ))}
          </select>

          <div style={{ fontSize: 14, opacity: 0.8 }}>
            {loadingEvent
              ? "Loading events..."
              : selectedImportEvent?.name ||
                selectedImportEvent?.eventName ||
                "No event selected"}
            {selectedImportEvent?.location
              ? ` • ${selectedImportEvent.location}`
              : ""}
          </div>

          {currentEvent?.id && (
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Current admin event:{" "}
              {currentEvent.name || currentEvent.eventName || "Unknown"}
            </div>
          )}
        </div>

        <div style={{ fontSize: 14, marginBottom: 12 }}>{status}</div>

        {error ? (
          <div
            style={{
              marginBottom: 12,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #e2b4b4",
              background: "#fff3f3",
              color: "#8a1f1f",
            }}
          >
            {error}
          </div>
        ) : null}

        {eventChangedSinceLoad && (
          <div
            style={{
              marginBottom: 12,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #f59e0b",
              background: "#fffbeb",
              color: "#92400e",
              fontSize: 14,
            }}
          >
            Target event changed after file load. Reload the file before
            importing to avoid importing into the wrong event.
          </div>
        )}

        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label
              style={{ display: "block", fontWeight: 600, marginBottom: 6 }}
            >
              Attendee CSV or XLSX file
            </label>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              disabled={loadingEvent || accessDenied || !selectedImportEventId}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFileChange(file);
              }}
            />
          </div>

          {fileName ? (
            <div style={{ fontSize: 14, opacity: 0.8 }}>
              Loaded file: <strong>{fileName}</strong>
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={
                importing ||
                parsing ||
                accessDenied ||
                !selectedImportEventId ||
                !validRows.length ||
                eventChangedSinceLoad
              }
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                background: "#111827",
                color: "white",
                fontWeight: 700,
                cursor: "pointer",
                opacity:
                  importing ||
                  parsing ||
                  accessDenied ||
                  !selectedImportEventId ||
                  !validRows.length ||
                  eventChangedSinceLoad
                    ? 0.6
                    : 1,
              }}
            >
              {importing ? "Importing..." : "Import Attendees"}
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Print Assets</h2>
        <p style={{ marginTop: 0, opacity: 0.8 }}>
          Optional PNG or image uploads for event-specific name tag and coach
          plate backgrounds.
        </p>

        {assetError ? (
          <div
            style={{
              marginBottom: 12,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #e2b4b4",
              background: "#fff3f3",
              color: "#8a1f1f",
            }}
          >
            {assetError}
          </div>
        ) : null}

        {assetStatus ? (
          <div style={{ fontSize: 14, marginBottom: 12 }}>{assetStatus}</div>
        ) : null}

        <div
          style={{
            display: "grid",
            gap: 18,
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          }}
        >
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 14,
              background: "#fafafa",
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 10 }}>
              Name Tag Background
            </h3>

            <input
              type="file"
              accept="image/*"
              disabled={loadingEvent || accessDenied || !selectedImportEventId}
              onChange={(e) => setNameTagFile(e.target.files?.[0] || null)}
            />

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                marginTop: 12,
              }}
            >
              <button
                onClick={handleUploadNameTagBackground}
                disabled={
                  !selectedImportEventId ||
                  !nameTagFile ||
                  savingNameTagBg ||
                  accessDenied
                }
              >
                {savingNameTagBg
                  ? "Uploading..."
                  : "Upload Name Tag Background"}
              </button>

              <button
                onClick={clearNameTagBackground}
                disabled={
                  !selectedImportEventId ||
                  !printSettings?.name_tag_bg_url ||
                  accessDenied
                }
              >
                Remove Background
              </button>
            </div>

            {printSettings?.name_tag_bg_url ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, marginBottom: 8, opacity: 0.8 }}>
                  Current background
                </div>
                <img
                  src={printSettings.name_tag_bg_url}
                  alt="Name tag background preview"
                  style={{
                    width: "100%",
                    maxWidth: 360,
                    border: "1px solid #ddd",
                    borderRadius: 12,
                  }}
                />
              </div>
            ) : (
              <div style={{ marginTop: 14, opacity: 0.7 }}>
                No name tag background set.
              </div>
            )}
          </div>

          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 14,
              background: "#fafafa",
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 10 }}>
              Coach Plate Background
            </h3>

            <input
              type="file"
              accept="image/*"
              disabled={loadingEvent || accessDenied || !selectedImportEventId}
              onChange={(e) => setCoachPlateFile(e.target.files?.[0] || null)}
            />

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                marginTop: 12,
              }}
            >
              <button
                onClick={handleUploadCoachPlateBackground}
                disabled={
                  !selectedImportEventId ||
                  !coachPlateFile ||
                  savingCoachPlateBg ||
                  accessDenied
                }
              >
                {savingCoachPlateBg
                  ? "Uploading..."
                  : "Upload Coach Plate Background"}
              </button>

              <button
                onClick={clearCoachPlateBackground}
                disabled={
                  !selectedImportEventId ||
                  !printSettings?.coach_plate_bg_url ||
                  accessDenied
                }
              >
                Remove Background
              </button>
            </div>

            {printSettings?.coach_plate_bg_url ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, marginBottom: 8, opacity: 0.8 }}>
                  Current background
                </div>
                <img
                  src={printSettings.coach_plate_bg_url}
                  alt="Coach plate background preview"
                  style={{
                    width: "100%",
                    maxWidth: 520,
                    border: "1px solid #ddd",
                    borderRadius: 12,
                  }}
                />
              </div>
            ) : (
              <div style={{ marginTop: 14, opacity: 0.7 }}>
                No coach plate background set.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Import Summary</h2>

        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          <div
            style={{ padding: 12, border: "1px solid #ddd", borderRadius: 10 }}
          >
            <div style={{ fontSize: 12, opacity: 0.7 }}>Rows Loaded</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{rows.length}</div>
          </div>

          <div
            style={{ padding: 12, border: "1px solid #ddd", borderRadius: 10 }}
          >
            <div style={{ fontSize: 12, opacity: 0.7 }}>Valid Rows</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>
              {validRows.length}
            </div>
          </div>

          <div
            style={{ padding: 12, border: "1px solid #ddd", borderRadius: 10 }}
          >
            <div style={{ fontSize: 12, opacity: 0.7 }}>Activity Rows</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{activityCount}</div>
          </div>

          <div
            style={{ padding: 12, border: "1px solid #ddd", borderRadius: 10 }}
          >
            <div style={{ fontSize: 12, opacity: 0.7 }}>Detected Headers</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>
              {headers.length}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Preview</h2>

        {!rows.length ? (
          <div style={{ opacity: 0.8 }}>No file loaded yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {previewRows.map((row) => (
              <div
                key={`${row.entry_id}-${row.rowNumber}`}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 12,
                  padding: 14,
                  background: "#fafafa",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    {row.pilot_first} {row.pilot_last}
                    {row.copilot_first || row.copilot_last
                      ? ` / ${row.copilot_first} ${row.copilot_last}`
                      : ""}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.75 }}>
                    Entry ID: {row.entry_id || "Missing"}
                  </div>
                </div>

                <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                  <div>Email: {row.email || "—"}</div>
                  <div>
                    {row.city || "—"}
                    {row.state ? `, ${row.state}` : ""}
                  </div>
                  <div>
                    Phones:{" "}
                    {[row.primary_phone, row.cell_phone]
                      .filter(Boolean)
                      .join(" / ") || "—"}
                  </div>
                  <div>
                    Volunteer: {row.wants_to_volunteer ? "Yes" : "No"} • First
                    Timer: {row.is_first_timer ? "Yes" : "No"}
                  </div>
                  {row.additional_attendees ? (
                    <div>Additional attendees: {row.additional_attendees}</div>
                  ) : null}
                </div>

                {row.activities.length ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      Activities
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {row.activities.map((activity, index) => (
                        <div
                          key={`${row.entry_id}-${activity.source_column_prefix}-${index}`}
                          style={{ fontSize: 14 }}
                        >
                          {activity.activity_name} • Qty {activity.quantity}
                          {activity.price !== null
                            ? ` • $${activity.price}`
                            : ""}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {row.warnings.length ? (
                  <div
                    style={{ marginTop: 10, color: "#8a1f1f", fontSize: 13 }}
                  >
                    {row.warnings.join(" • ")}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
