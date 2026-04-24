"use client";

import Link from "next/link";
import Papa from "papaparse";
import { useEffect, useState } from "react";
import * as XLSX from "xlsx";

import { getAgendaColor } from "@/lib/agendaColors";
import { getAdminEvent } from "@/lib/getAdminEvent";
import { supabase } from "@/lib/supabase";

function normalizeHeaderKey(value: string) {
  return value
    .replace(/\u00A0/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

type AdminEventRow = {
  id: string;
  name: string;
  location: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type ImportRow = Record<string, unknown>;

function getField(row: ImportRow, names: string[]) {
  const normalizedRow: Record<string, unknown> = {};

  Object.keys(row).forEach((key) => {
    normalizedRow[normalizeHeaderKey(key)] = row[key];
  });

  for (const name of names) {
    const value = normalizedRow[normalizeHeaderKey(name)];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return undefined;
}

function normalizeText(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function normalizeNumber(value: unknown) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {return null;}
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeDate(value: unknown) {
  if (value === undefined || value === null) {return null;}

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    const dd = String(value.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      const yyyy = String(parsed.y).padStart(4, "0");
      const mm = String(parsed.m).padStart(2, "0");
      const dd = String(parsed.d).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  const raw = String(value).trim();
  if (!raw) {return null;}

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {return raw;}

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    const [m, d, y] = raw.split("/");
    return `${y}-${String(Number(m)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
  }

  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(raw)) {
    const [m, d, y] = raw.split("-");
    return `${y}-${String(Number(m)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {return null;}

  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function excelTimeNumberToHHMM(value: number) {
  const totalMinutes = Math.round(value * 24 * 60);
  const hh = Math.floor(totalMinutes / 60) % 24;
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function normalizeTimeOnly(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  if (typeof value === "number") {
    return excelTimeNumberToHHMM(value);
  }

  const raw = String(value).trim();
  if (!raw) {return null;}

  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(":");
    return `${String(Number(h)).padStart(2, "0")}:${m}`;
  }

  if (/^\d{3,4}$/.test(raw)) {
    const padded = raw.padStart(4, "0");
    const hh = padded.slice(0, 2);
    const mm = padded.slice(2, 4);
    if (Number(hh) <= 23 && Number(mm) <= 59) {return `${hh}:${mm}`;}
  }

  const datetimeMatch = raw.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})(?::\d{2})?$/,
  );
  if (datetimeMatch) {
    const timePart = datetimeMatch[2];
    const [h, m] = timePart.split(":");
    return `${String(Number(h)).padStart(2, "0")}:${m}`;
  }

  const parsed = new Date(`1970-01-01T${raw}`);
  if (!Number.isNaN(parsed.getTime())) {
    const hh = String(parsed.getHours()).padStart(2, "0");
    const mm = String(parsed.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  return null;
}

function yesNoToBool(value: unknown) {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw) {return false;}
  return raw === "yes" || raw === "y" || raw === "true" || raw === "1";
}

function parseRowsFromWorkbook(file: File): Promise<ImportRow[]> {
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
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const rows = XLSX.utils.sheet_to_json<ImportRow>(worksheet, {
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

function parseRowsFromCsv(file: File): Promise<ImportRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<ImportRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
      complete: (results) => resolve(results.data || []),
      error: (error) => reject(error),
    });
  });
}

async function parseImportFile(file: File) {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    return parseRowsFromWorkbook(file);
  }

  return parseRowsFromCsv(file);
}

export default function AgendaImportPage() {
  const [status, setStatus] = useState("No file selected.");
  const [busy, setBusy] = useState(false);
  const [workingEvent, setWorkingEvent] = useState<AdminEventRow | null>(null);

  async function loadWorkingEvent() {
    const adminEvent = getAdminEvent();

    if (!adminEvent?.id) {
      setWorkingEvent(null);
      setStatus(
        "No admin working event selected. Choose one on the Admin Dashboard first.",
      );
      return;
    }

    const { data, error } = await supabase
      .from("events")
      .select("id,name,location,start_date,end_date")
      .eq("id", adminEvent.id)
      .single();

    if (error || !data) {
      setWorkingEvent(null);
      setStatus(error?.message || "Could not load admin working event.");
      return;
    }

    setWorkingEvent(data as AdminEventRow);
    setStatus(`Ready to import agenda into ${data.name}.`);
  }

  useEffect(() => {
    void loadWorkingEvent();

    function handleStorage(e: StorageEvent) {
      if (e.key === "fcoc-admin-event-changed") {
        void loadWorkingEvent();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  async function handleFile(file: File) {
    if (!workingEvent) {
      setStatus(
        "No admin working event selected. Choose one on the Admin Dashboard first.",
      );
      return;
    }

    setBusy(true);
    setStatus(`Reading file for ${workingEvent.name}...`);

    try {
      const rows = await parseImportFile(file);

      if (!rows.length) {
        setStatus("No rows found in file.");
        return;
      }

      setStatus(`Parsed ${rows.length} rows for ${workingEvent.name}...`);

      const payloads: Array<{
        event_id: string;
        external_id: string;
        title: string | null;
        description: string | null;
        location: string | null;
        speaker: string | null;
        category: string | null;
        color: string | null;
        agenda_date: string | null;
        start_time: string | null;
        end_time: string | null;
        is_published: boolean;
        sort_order: number;
        source: string;
      }> = [];

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];

        const title = normalizeText(getField(row, ["Title", "title"]));
        const description = normalizeText(
          getField(row, ["Description", "description"]),
        );
        const location = normalizeText(
          getField(row, ["Location", "location", "Room", "Venue"]),
        );
        const speaker = normalizeText(
          getField(row, ["Speaker", "speaker", "Presenter", "Host"]),
        );

        const startsAtRaw = getField(row, [
          "starts_at",
          "Starts At",
          "Start DateTime",
          "start_at",
        ]);

        const endsAtRaw = getField(row, [
          "ends_at",
          "Ends At",
          "End DateTime",
          "end_at",
        ]);

        const agendaDate = normalizeDate(
          getField(row, [
            "Agenda Date",
            "AgendaDate",
            "Date",
            "date",
            "agenda_date",
            "AGENDA DATE",
          ]) ?? startsAtRaw,
        );

        const startTime = normalizeTimeOnly(
          getField(row, ["Start Time", "start_time", "Start", "start"]) ??
            startsAtRaw,
        );

        const endTime = normalizeTimeOnly(
          getField(row, ["End Time", "end_time", "End", "end"]) ?? endsAtRaw,
        );

        const category = normalizeText(getField(row, ["Category", "category"]));
        const color = normalizeText(getField(row, ["Color", "color"]));

        const published = yesNoToBool(
          getField(row, [
            "Published",
            "published",
            "Is Published",
            "is_published",
          ]),
        );

        const sortOrder = normalizeNumber(
          getField(row, ["Sort Order", "sort_order"]),
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
          String(title)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, ""),
          agendaDate || "no-date",
          startTime || "no-time",
        ].join("-");

        payloads.push({
          event_id: workingEvent.id,
          external_id: externalId,
          title,
          description,
          location,
          speaker,
          category,
          color: getAgendaColor(category, color),
          agenda_date: agendaDate,
          start_time: startTime,
          end_time: endTime,
          is_published: published,
          sort_order: sortOrder ?? index + 1,
          source: "import",
        });
      }

      setStatus(
        `Importing ${payloads.length} rows into ${workingEvent.name}...`,
      );

      const { error } = await supabase.from("agenda_items").upsert(payloads, {
        onConflict: "event_id,external_id",
      });

      if (error) {
        throw new Error(`Bulk import failed: ${error.message}`);
      }

      setStatus(
        `Agenda import complete for ${workingEvent.name}. ${payloads.length} rows imported or updated.`,
      );
    } catch (err: any) {
      console.error(err);
      setStatus(`Import failed: ${err?.message || "Unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 30, display: "grid", gap: 16 }}>
      <h1 style={{ margin: 0 }}>Agenda Import</h1>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
          maxWidth: 760,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          Admin working event: {workingEvent?.name || "No selected event"}
        </div>

        {workingEvent?.location ? (
          <div style={{ color: "#555", marginBottom: 4 }}>
            {workingEvent.location}
          </div>
        ) : null}

        <div style={{ fontSize: 13, color: "#666" }}>
          Agenda imports go into the selected admin working event only.
        </div>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 14,
          maxWidth: 760,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }}>
          Agenda Import Templates
        </div>

        <div style={{ fontSize: 14, color: "#555", marginBottom: 10 }}>
          Use the blank template to build your own agenda file. Use the sample
          file as your guide for either XLSX or CSV imports.
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <Link href="/templates/agenda/agenda_import_template_blank_with_speaker.xlsx">
            Download blank XLSX template
          </Link>
          <Link href="/templates/agenda/agenda_import_template_blank_with_speaker.csv">
            Download blank CSV template
          </Link>
          <Link href="/templates/agenda/agenda_import_template_sample_with_speaker.xlsx">
            Download sample XLSX template
          </Link>
          <Link href="/templates/agenda/agenda_import_template_sample_with_speaker.csv">
            Download sample CSV template
          </Link>
          <Link href="/templates/agenda/agenda_import_template_notes_with_speaker.txt">
            Download template notes / instructions
          </Link>
        </div>

        <div style={{ marginTop: 12, fontSize: 13, color: "#666" }}>
          <strong>Preferred columns:</strong> Title, Description, Location,
          Speaker, Agenda Date, Start Time, End Time, Category, Color,
          Published, Sort Order.
        </div>

        <div style={{ marginTop: 6, fontSize: 12, color: "#777" }}>
          Tip: Date format should be YYYY-MM-DD. Time format should be HH:MM.
        </div>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 14,
          maxWidth: 760,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Upload file</div>

        <div style={{ fontSize: 14, color: "#555", marginBottom: 10 }}>
          Accepted formats: CSV and XLSX.
        </div>

        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          disabled={busy || !workingEvent}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {void handleFile(file);}
          }}
        />
      </div>

      <div>
        <strong>Status:</strong> {status}
      </div>
    </div>
  );
}
