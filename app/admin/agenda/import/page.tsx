"use client";

import { useState } from "react";
import Papa from "papaparse";
import { supabase } from "@/lib/supabase";
import { getAdminEvent } from "@/lib/getAdminEvent";

type CsvRow = Record<string, string | undefined>;

type PreviewRow = {
  external_id: string;
  title: string;
  description: string | null;
  location: string | null;
  category: string | null;
  start_time: string;
  end_time: string | null;
  is_published: boolean;
};

type AdminEventContext = {
  id: string | null;
  name: string | null;
};

function getField(row: CsvRow, names: string[]) {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined) return value;
  }
  return undefined;
}

function normalizeText(value?: string) {
  const v = value?.trim();
  return v ? v : null;
}

function normalizeBool(value?: string) {
  if (!value) return true;
  const v = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(v)) return true;
  if (["false", "0", "no", "n"].includes(v)) return false;
  return true;
}

function normalizeDateTime(value?: string) {
  const raw = value?.trim();
  if (!raw) return null;
  const fixed = raw.replace("T", " ");
  const parsed = new Date(fixed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function generateExternalId(row: CsvRow) {
  const existing = getField(row, [
    "external_id",
    "External ID",
    "External Id",
    "externalId",
  ])?.trim();
  if (existing) return existing;

  const itemTitle = getField(row, ["title", "Title"])?.trim() || "agenda-item";
  const start =
    getField(row, ["start_time", "Start Time", "start", "Start"])?.trim() ||
    "no-time";
  return `${slugify(itemTitle)}-${slugify(start)}`;
}

export default function AgendaImportPage() {
  const [status, setStatus] = useState("No file selected");
  const [busy, setBusy] = useState(false);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [replaceMode, setReplaceMode] = useState(false);

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

  function parseRows(rows: CsvRow[]) {
    const parsed: PreviewRow[] = [];
    const errors: string[] = [];

    rows.forEach((row, index) => {
      const line = index + 2;
      const externalId = generateExternalId(row);
      const title = getField(row, ["title", "Title"])?.trim() || "";
      const startTimeRaw = getField(row, [
        "start_time",
        "Start Time",
        "start",
        "Start",
      ]);
      const endTimeRaw = getField(row, ["end_time", "End Time", "end", "End"]);

      const start_time = normalizeDateTime(startTimeRaw);
      const end_time = normalizeDateTime(endTimeRaw);

      if (!externalId) {
        errors.push(
          `Row ${line}: missing external_id and could not generate one.`,
        );
        return;
      }

      if (!title) {
        errors.push(`Row ${line}: missing title.`);
        return;
      }

      if (!start_time) {
        errors.push(`Row ${line}: invalid or missing start_time.`);
        return;
      }

      parsed.push({
        external_id: externalId,
        title,
        description: normalizeText(
          getField(row, ["description", "Description"]),
        ),
        location: normalizeText(getField(row, ["location", "Location"])),
        category: normalizeText(getField(row, ["category", "Category"])),
        start_time,
        end_time,
        is_published: normalizeBool(
          getField(row, ["is_published", "Published", "published"]),
        ),
      });
    });

    return { parsed, errors };
  }

  async function handleFile(file: File) {
    setBusy(true);
    setStatus("Reading file...");
    setPreviewRows([]);

    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
      complete: async (results) => {
        try {
          const rows = results.data || [];

          if (rows.length === 0) {
            setStatus("No rows found in file.");
            setBusy(false);
            return;
          }

          const { parsed, errors } = parseRows(rows);

          if (errors.length > 0) {
            setStatus(`Import blocked. ${errors[0]}`);
            setBusy(false);
            return;
          }

          setPreviewRows(parsed);
          setStatus(
            `Parsed ${parsed.length} agenda rows. Review below, then click Import.`,
          );
        } catch (err: any) {
          setStatus(`Parse failed: ${err.message}`);
        } finally {
          setBusy(false);
        }
      },
      error: (error) => {
        setBusy(false);
        setStatus(`Parse failed: ${error.message}`);
      },
    });
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
          category: row.category,
          start_time: row.start_time,
          end_time: row.end_time,
          is_published: row.is_published,
          source: "csv",
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
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <h1>Agenda CSV Import</h1>

      <p>
        Upload a CSV for the selected admin working event agenda. Existing rows
        are matched by <strong>external_id</strong>.
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
        <a
          href="/agenda_import_template.csv"
          download
          style={{
            display: "inline-block",
            padding: "10px 14px",
            borderRadius: 8,
            background: "#0b5cff",
            color: "white",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Download Template
        </a>

        <input
          type="file"
          accept=".csv,.txt"
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

      {previewRows.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => void runImport()}
            disabled={busy}
            style={{ marginBottom: 16 }}
          >
            Import {previewRows.length} Rows
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
                  <th
                    style={{
                      textAlign: "left",
                      padding: 8,
                      borderBottom: "1px solid #ddd",
                    }}
                  >
                    external_id
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: 8,
                      borderBottom: "1px solid #ddd",
                    }}
                  >
                    title
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: 8,
                      borderBottom: "1px solid #ddd",
                    }}
                  >
                    location
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: 8,
                      borderBottom: "1px solid #ddd",
                    }}
                  >
                    category
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: 8,
                      borderBottom: "1px solid #ddd",
                    }}
                  >
                    start_time
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: 8,
                      borderBottom: "1px solid #ddd",
                    }}
                  >
                    end_time
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: 8,
                      borderBottom: "1px solid #ddd",
                    }}
                  >
                    published
                  </th>
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
                      {row.location || ""}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      {row.category || ""}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      {row.start_time}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      {row.end_time || ""}
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
