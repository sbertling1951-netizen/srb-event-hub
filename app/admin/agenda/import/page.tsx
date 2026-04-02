"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { getAdminEvent } from "@/lib/getAdminEvent";

type CsvRow = Record<string, any>;

type PreviewRow = {
  external_id: string;
  title: string;
  description: string | null;
  location: string | null;
  speaker: string | null;
  category: string | null;
  sort_order: number | null;
  agenda_date: string | null;
  start_time: string | null;
  end_time: string | null;
  is_published: boolean;
};

type AdminEventContext = {
  id: string | null;
  name: string | null;
};

type ParseResult = {
  parsed: PreviewRow[];
  errors: string[];
  warnings: string[];
  sourceLabel: string;
};

const SAMPLE_ROWS = [
  {
    title: "Registration Check-In",
    description: "Arrival and packet pickup",
    location: "Main Hall",
    speaker: "Volunteer Team",
    date: "2026-04-15",
    start_time: "08:00",
    end_time: "10:00",
    category: "Check-In",
    sort_order: 1,
  },
  {
    title: "Welcome Session",
    description: "Opening remarks and event overview",
    location: "Main Hall",
    speaker: "Steve Bertling",
    date: "2026-04-15",
    start_time: "10:30",
    end_time: "11:15",
    category: "General",
    sort_order: 2,
  },
  {
    title: "Tech Seminar",
    description: "Chassis maintenance overview",
    location: "Seminar Room A",
    speaker: "FCCC Trainer",
    date: "2026-04-15",
    start_time: "13:00",
    end_time: "14:15",
    category: "Seminar",
    sort_order: 3,
  },
  {
    title: "Dinner",
    description: "Group dinner",
    location: "Banquet Hall",
    speaker: "",
    date: "2026-04-15",
    start_time: "18:00",
    end_time: "19:30",
    category: "Meal",
    sort_order: 4,
  },
];

const SAMPLE_CATEGORIES = [
  { category: "General", color: "#64748b" },
  { category: "Meal", color: "#16a34a" },
  { category: "Seminar", color: "#2563eb" },
  { category: "Tech Talk", color: "#7c3aed" },
  { category: "Social", color: "#ea580c" },
  { category: "Entertainment", color: "#db2777" },
  { category: "Travel", color: "#0891b2" },
  { category: "Registration", color: "#ca8a04" },
  { category: "Check-In", color: "#0f766e" },
];

function getField(row: CsvRow, names: string[]) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null) return row[name];
  }
  return undefined;
}

function normalizeText(value: unknown) {
  const v = String(value ?? "").trim();
  return v ? v : null;
}

function normalizeBool(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return true;
  }
  const v = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(v)) return true;
  if (["false", "0", "no", "n"].includes(v)) return false;
  return true;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function excelDateToIsoDate(value: number) {
  const parsed = XLSX.SSF.parse_date_code(value);
  if (!parsed) return null;
  const year = String(parsed.y).padStart(4, "0");
  const month = String(parsed.m).padStart(2, "0");
  const day = String(parsed.d).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDateOnly(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  if (typeof value === "number") {
    return excelDateToIsoDate(value);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return null;
}

function excelTimeNumberToHHMM(value: number) {
  if (value >= 0 && value < 1) {
    const totalMinutes = Math.round(value * 24 * 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  const raw = String(Math.round(value));
  if (/^\d{3,4}$/.test(raw)) {
    const padded = raw.padStart(4, "0");
    const hh = padded.slice(0, 2);
    const mm = padded.slice(2, 4);
    if (Number(hh) <= 23 && Number(mm) <= 59) return `${hh}:${mm}`;
  }

  return null;
}

function normalizeTimeOnly(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  if (typeof value === "number") {
    return excelTimeNumberToHHMM(value);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(":");
    return `${String(Number(h)).padStart(2, "0")}:${m}`;
  }

  if (/^\d{3,4}$/.test(raw)) {
    const padded = raw.padStart(4, "0");
    const hh = padded.slice(0, 2);
    const mm = padded.slice(2, 4);
    if (Number(hh) <= 23 && Number(mm) <= 59) return `${hh}:${mm}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const hh = String(parsed.getHours()).padStart(2, "0");
    const mm = String(parsed.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  return null;
}

function normalizeCategory(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  if (lower === "checkin") return "Check-In";
  if (lower === "check-in") return "Check-In";
  return raw;
}

function buildExternalId(row: {
  title: string;
  agenda_date: string | null;
  start_time: string | null;
}) {
  return [
    slugify(row.title || "agenda-item"),
    slugify(row.agenda_date || "no-date"),
    slugify(row.start_time || "no-time"),
  ].join("-");
}

function rowLooksBlank(row: CsvRow) {
  return Object.values(row).every((value) => String(value ?? "").trim() === "");
}

function parseAgendaRows(rows: CsvRow[], sourceLabel: string): ParseResult {
  const parsed: PreviewRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  rows.forEach((row, index) => {
    if (rowLooksBlank(row)) return;

    const line = index + 2;

    const title = String(getField(row, ["title", "Title"]) ?? "").trim();
    const description = normalizeText(
      getField(row, ["description", "Description"]),
    );
    const location = normalizeText(getField(row, ["location", "Location"]));
    const speaker = normalizeText(getField(row, ["speaker", "Speaker"]));
    const category = normalizeCategory(getField(row, ["category", "Category"]));

    const startRaw = getField(row, [
      "start_time",
      "Start Time",
      "start",
      "Start",
      "starts_at",
      "Starts At",
    ]);

    const endRaw = getField(row, [
      "end_time",
      "End Time",
      "end",
      "End",
      "ends_at",
      "Ends At",
    ]);

    const start_time = normalizeTimeOnly(startRaw);
    const end_time = normalizeTimeOnly(endRaw);

    let agenda_date = normalizeDateOnly(
      getField(row, [
        "date",
        "Date",
        "agenda_date",
        "Agenda Date",
        "start_date",
        "Start Date",
        "day",
        "Day",
      ]),
    );

    if (!agenda_date && startRaw) {
      const parsedDate = new Date(String(startRaw));
      if (!Number.isNaN(parsedDate.getTime())) {
        const year = parsedDate.getFullYear();
        const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
        const day = String(parsedDate.getDate()).padStart(2, "0");
        agenda_date = `${year}-${month}-${day}`;
      }
    }

    const rawSortOrder = getField(row, ["sort_order", "Sort Order"]);
    const sort_order =
      rawSortOrder === undefined ||
      rawSortOrder === null ||
      String(rawSortOrder).trim() === ""
        ? null
        : Number(rawSortOrder);

    if (!title) {
      errors.push(`Row ${line}: missing title.`);
      return;
    }

    if (!agenda_date) {
      errors.push(`Row ${line}: missing or invalid date.`);
      return;
    }

    if (!start_time) {
      errors.push(`Row ${line}: missing or invalid start_time.`);
      return;
    }

    if (sort_order !== null && Number.isNaN(sort_order)) {
      errors.push(`Row ${line}: invalid sort_order.`);
      return;
    }

    const explicitExternalId = normalizeText(
      getField(row, [
        "external_id",
        "External ID",
        "External Id",
        "externalId",
      ]),
    );

    const external_id =
      explicitExternalId ||
      buildExternalId({
        title,
        agenda_date,
        start_time,
      });

    if (!category) {
      warnings.push(`Row ${line}: category is blank.`);
    }

    parsed.push({
      external_id,
      title,
      description,
      location,
      speaker,
      category,
      sort_order,
      agenda_date,
      start_time,
      end_time,
      is_published: normalizeBool(
        getField(row, ["is_published", "Published", "published"]),
      ),
    });
  });

  return { parsed, errors, warnings, sourceLabel };
}

function downloadCsvTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(SAMPLE_ROWS);
  XLSX.utils.book_append_sheet(wb, ws, "Agenda_Import_Template");
  XLSX.writeFile(wb, "agenda_import_template.csv", {
    bookType: "csv",
  });
}

function downloadXlsxTemplate() {
  const wb = XLSX.utils.book_new();
  const agendaSheet = XLSX.utils.json_to_sheet(SAMPLE_ROWS);
  const categorySheet = XLSX.utils.json_to_sheet(SAMPLE_CATEGORIES);

  XLSX.utils.book_append_sheet(wb, agendaSheet, "Agenda_Import_Template");
  XLSX.utils.book_append_sheet(wb, categorySheet, "Categories");

  XLSX.writeFile(wb, "agenda_import_template.xlsx");
}

export default function AgendaImportPage() {
  const [status, setStatus] = useState("No file selected");
  const [busy, setBusy] = useState(false);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [replaceMode, setReplaceMode] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [sourceLabel, setSourceLabel] = useState<string>("");

  const previewCountLabel = useMemo(
    () => `${previewRows.length} row${previewRows.length === 1 ? "" : "s"}`,
    [previewRows.length],
  );

  async function getWorkingEvent() {
    const adminEvent = getAdminEvent() as AdminEventContext | null;

    if (!adminEvent?.id) {
      throw new Error(
        "No admin working event selected. Choose one on the Admin Dashboard first.",
      );
    }

    const { data, error } = await supabase
      .from("events")
      .select("id,name")
      .eq("id", adminEvent.id)
      .single();

    if (error || !data) {
      throw new Error(
        error?.message || "Selected admin event could not be loaded.",
      );
    }

    return data;
  }

  async function handleFile(file: File) {
    setBusy(true);
    setStatus("Reading file...");
    setPreviewRows([]);
    setWarnings([]);
    setSourceLabel("");

    try {
      const fileName = file.name.toLowerCase();

      if (fileName.endsWith(".csv")) {
        const text = await file.text();
        const wb = XLSX.read(text, { type: "string" });
        const firstSheetName = wb.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json<CsvRow>(
          wb.Sheets[firstSheetName],
          {
            defval: "",
            raw: true,
          },
        );

        const result = parseAgendaRows(
          rows,
          `${file.name} (${firstSheetName})`,
        );

        if (result.errors.length > 0) {
          setStatus(`Import blocked. ${result.errors[0]}`);
          setBusy(false);
          return;
        }

        setPreviewRows(result.parsed);
        setWarnings(result.warnings);
        setSourceLabel(result.sourceLabel);
        setStatus(
          `Parsed ${result.parsed.length} agenda rows from CSV. Review below, then click Import.`,
        );
      } else if (fileName.endsWith(".xlsx")) {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, {
          type: "array",
          cellDates: false,
          raw: true,
        });

        const targetSheetName =
          wb.SheetNames.find(
            (name) => name.toLowerCase() === "agenda_import_template",
          ) || wb.SheetNames[0];

        const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(
          wb.Sheets[targetSheetName],
          {
            defval: "",
            raw: true,
          },
        );

        const rows: CsvRow[] = rawRows.map((row) => {
          const normalized: Record<string, any> = {};

          Object.keys(row).forEach((key) => {
            const cleanKey = key
              .replace(/^\uFEFF/, "")
              .trim()
              .toLowerCase()
              .replace(/\s+/g, "_");

            normalized[cleanKey] = row[key];
          });

          return normalized;
        });

        console.log("FIRST XLSX ROW:", rows[0]);

        const result = parseAgendaRows(
          rows,
          `${file.name} (${targetSheetName})`,
        );

        if (result.errors.length > 0) {
          setStatus(`Import blocked. ${result.errors[0]}`);
          setBusy(false);
          return;
        }

        setPreviewRows(result.parsed);
        setWarnings(result.warnings);
        setSourceLabel(result.sourceLabel);
        setStatus(
          `Parsed ${result.parsed.length} agenda rows from XLSX. Review below, then click Import.`,
        );
      } else {
        setStatus("Unsupported file type. Use .xlsx or .csv.");
      }
    } catch (err: any) {
      console.error("Agenda import parse error:", err);
      setStatus(`Parse failed: ${err?.message || "Unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (previewRows.length === 0) {
      setStatus("Nothing to import.");
      return;
    }

    setBusy(true);

    try {
      const workingEvent = await getWorkingEvent();

      if (replaceMode) {
        const { error: deleteError } = await supabase
          .from("agenda_items")
          .delete()
          .eq("event_id", workingEvent.id);

        if (deleteError) {
          throw new Error(
            `Could not clear existing agenda items: ${deleteError.message}`,
          );
        }
      }

      let inserted = 0;
      let updated = 0;

      for (const row of previewRows) {
        const { data: existing, error: findError } = await supabase
          .from("agenda_items")
          .select("id")
          .eq("event_id", workingEvent.id)
          .eq("external_id", row.external_id)
          .maybeSingle();

        if (findError) {
          throw new Error(
            `Lookup failed for ${row.external_id}: ${findError.message}`,
          );
        }

        const payload = {
          event_id: workingEvent.id,
          external_id: row.external_id,
          title: row.title,
          description: row.description,
          location: row.location,
          speaker: row.speaker,
          category: row.category,
          sort_order: row.sort_order,
          agenda_date: row.agenda_date,
          start_time: row.start_time,
          end_time: row.end_time,
          is_published: row.is_published,
          source: sourceLabel.toLowerCase().includes(".xlsx") ? "xlsx" : "csv",
        };

        if (existing?.id) {
          const { error: updateError } = await supabase
            .from("agenda_items")
            .update(payload)
            .eq("id", existing.id);

          if (updateError) {
            throw new Error(
              `Update failed for ${row.external_id}: ${updateError.message}`,
            );
          }

          updated += 1;
        } else {
          const { error: insertError } = await supabase
            .from("agenda_items")
            .insert(payload);

          if (insertError) {
            throw new Error(
              `Insert failed for ${row.external_id}: ${insertError.message}`,
            );
          }

          inserted += 1;
        }
      }

      setStatus(
        `Import complete for ${workingEvent.name}. Inserted: ${inserted}. Updated: ${updated}.`,
      );
    } catch (err: any) {
      setStatus(`Import failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1>Agenda Import</h1>

      <p>
        Upload an <strong>.xlsx</strong> or <strong>.csv</strong> agenda file
        for the selected admin working event. Existing rows are matched by{" "}
        <strong>external_id</strong>.
      </p>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <button type="button" onClick={downloadXlsxTemplate} disabled={busy}>
          Download Sample XLSX
        </button>

        <button type="button" onClick={downloadCsvTemplate} disabled={busy}>
          Download Sample CSV
        </button>

        <input
          type="file"
          accept=".xlsx,.csv"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </div>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <input
          type="checkbox"
          checked={replaceMode}
          disabled={busy}
          onChange={(e) => setReplaceMode(e.target.checked)}
        />
        Replace all agenda items for the selected admin working event before
        import
      </label>

      <div style={{ marginBottom: 16 }}>
        <strong>Status:</strong> {status}
      </div>

      {warnings.length > 0 ? (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            border: "1px solid #f5c26b",
            borderRadius: 8,
            background: "#fff8e8",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Warnings</div>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {previewRows.length > 0 && (
        <>
          <div style={{ marginBottom: 12 }}>
            <strong>Preview source:</strong> {sourceLabel}
            <br />
            <strong>Rows ready:</strong> {previewCountLabel}
          </div>

          <button
            type="button"
            onClick={() => void runImport()}
            disabled={busy}
            style={{ marginBottom: 16 }}
          >
            Import {previewCountLabel}
          </button>

          <div
            style={{
              overflowX: "auto",
              border: "1px solid #ddd",
              borderRadius: 8,
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 14,
              }}
            >
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  {[
                    "external_id",
                    "title",
                    "speaker",
                    "location",
                    "category",
                    "date",
                    "start_time",
                    "end_time",
                    "sort_order",
                    "published",
                  ].map((heading) => (
                    <th
                      key={heading}
                      style={{
                        textAlign: "left",
                        padding: 8,
                        borderBottom: "1px solid #ddd",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr key={row.external_id}>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      {row.external_id}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      {row.title}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      {row.speaker || ""}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      {row.location || ""}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      {row.category || ""}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      {row.agenda_date || ""}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      {row.start_time || ""}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      {row.end_time || ""}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      {row.sort_order ?? ""}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      {row.is_published ? "true" : "false"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
