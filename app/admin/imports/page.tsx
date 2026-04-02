"use client";

import { useEffect, useState } from "react";
import Papa from "papaparse";
import { supabase } from "@/lib/supabase";
import { getAdminEvent } from "@/lib/getAdminEvent";

type CsvRow = Record<string, string | undefined>;

type AdminEventRow = {
  id: string;
  name: string;
  location: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

function yesNoToBool(value?: string) {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "yes" || v === "y" || v === "true" || v === "1";
}

function shareFieldToBool(value?: string) {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  if (v.includes("don't share")) return false;
  if (v.includes("do not share")) return false;
  if (v.includes("yes")) return true;
  if (v.includes("share")) return true;
  if (v.includes("no")) return false;
  return false;
}

function getField(row: CsvRow, names: string[]) {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined) return value;
  }
  return undefined;
}

function normalizeEmail(value?: string) {
  const trimmed = value?.trim().toLowerCase() || "";
  return trimmed || null;
}

function normalizeText(value?: string) {
  const trimmed = value?.trim() || "";
  return trimmed || null;
}

export default function ImportsPage() {
  const [status, setStatus] = useState("No file selected");
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
    setStatus(`Ready to import attendees into ${data.name}.`);
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
    console.log("ROW SAMPLE:", rows[0]);

    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) =>
        header
          .replace(/^\uFEFF/, "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "_"),
      complete: async (results) => {
        try {
          const rows = results.data || [];

          if (rows.length === 0) {
            setStatus("No rows found in file.");
            setBusy(false);
            return;
          }

          setStatus(`Parsed ${rows.length} rows for ${workingEvent.name}...`);

          const seenEntryIds = new Set<string>();
          const seenEmails = new Set<string>();
          let processed = 0;

          for (const row of rows) {
            const entryId =
              getField(row, ["Entry Id", "Entry ID", "Entry id"])?.trim() || "";

            const email = normalizeEmail(
              getField(row, ["Email Address", "Email", "email"]),
            );

            if (!entryId && !email) {
              continue;
            }

            if (entryId) seenEntryIds.add(entryId);
            if (email) seenEmails.add(email);

            const attendeePayload = {
              event_id: workingEvent.id,
              entry_id: entryId || null,
              membership_number:
                normalizeText(getField(row, ["FCOC Membership Number"])) ||
                null,
              pilot_first:
                normalizeText(getField(row, ["Pilot Name (First)"])) || null,
              pilot_last:
                normalizeText(getField(row, ["Pilot Name (Last)"])) || null,
              copilot_first:
                normalizeText(getField(row, ["Co-Pilot Name (First)"])) || null,
              copilot_last:
                normalizeText(getField(row, ["Co-Pilot Name (Last)"])) || null,
              email,
              phone:
                normalizeText(getField(row, ["Cell Phone #"])) ||
                normalizeText(getField(row, ["Primary Phone #"])) ||
                null,
              coach_make:
                normalizeText(getField(row, ["Coach Manufacturer"])) || null,
              coach_model:
                normalizeText(getField(row, ["Coach Model"])) || null,
              coach_length:
                normalizeText(getField(row, ["Coach Length"])) || null,
              assigned_site: null,
              first_time: yesNoToBool(
                getField(row, ["First time at an FCOC event?"]),
              ),
              volunteer: yesNoToBool(
                getField(row, [
                  "Would you like to volunteer to help with the event?",
                ]),
              ),
              handicap_parking: yesNoToBool(
                getField(row, ["Handicap Parking?"]),
              ),
              share_with_attendees: shareFieldToBool(
                getField(row, ["Ok to share your email with other attendees?"]),
              ),
            };

            let matchedId: string | null = null;

            // 1) Best match: existing row by event_id + email
            if (email) {
              const { data: emailMatch, error: emailError } = await supabase
                .from("attendees")
                .select("id,entry_id,email")
                .eq("event_id", workingEvent.id)
                .eq("email", email)
                .maybeSingle();

              if (emailError) {
                throw new Error(
                  `Lookup failed for email ${email}: ${emailError.message}`,
                );
              }

              if (emailMatch?.id) {
                matchedId = emailMatch.id;
              }
            }

            // 2) Fallback: existing row by event_id + entry_id
            if (!matchedId && entryId) {
              const { data: entryMatch, error: entryError } = await supabase
                .from("attendees")
                .select("id,entry_id,email")
                .eq("event_id", workingEvent.id)
                .eq("entry_id", entryId)
                .maybeSingle();

              if (entryError) {
                throw new Error(
                  `Lookup failed for Entry Id ${entryId}: ${entryError.message}`,
                );
              }

              if (entryMatch?.id) {
                matchedId = entryMatch.id;
              }
            }

            if (matchedId) {
              const { error: updateError } = await supabase
                .from("attendees")
                .update(attendeePayload)
                .eq("id", matchedId);

              if (updateError) {
                throw new Error(
                  `Update failed for ${email || `Entry Id ${entryId}`}: ${updateError.message}`,
                );
              }
            } else {
              const { error: insertError } = await supabase
                .from("attendees")
                .insert(attendeePayload);

              if (insertError) {
                throw new Error(
                  `Insert failed for ${email || `Entry Id ${entryId}`}: ${insertError.message}`,
                );
              }
            }

            processed += 1;
            setStatus(
              `Syncing ${processed} of ${rows.length} rows into ${workingEvent.name}...`,
            );
          }

          // Remove attendees not present in the new file.
          // Match by email when available, otherwise by entry_id.
          const { data: existingAttendees, error: existingError } =
            await supabase
              .from("attendees")
              .select("id,entry_id,email")
              .eq("event_id", workingEvent.id);

          if (existingError) {
            throw new Error(
              `Could not load existing attendees: ${existingError.message}`,
            );
          }

          const missingIds = (existingAttendees || [])
            .filter((attendee) => {
              const attendeeEmail = normalizeEmail(attendee.email || undefined);
              const attendeeEntryId = attendee.entry_id || "";

              if (attendeeEmail) {
                return !seenEmails.has(attendeeEmail);
              }

              if (attendeeEntryId) {
                return !seenEntryIds.has(attendeeEntryId);
              }

              return false;
            })
            .map((attendee) => attendee.id);

          if (missingIds.length > 0) {
            const { error: clearAssignmentsError } = await supabase
              .from("parking_sites")
              .update({ assigned_attendee_id: null })
              .in("assigned_attendee_id", missingIds);

            if (clearAssignmentsError) {
              throw new Error(
                `Could not clear old parking assignments: ${clearAssignmentsError.message}`,
              );
            }

            const { error: deleteMissingError } = await supabase
              .from("attendees")
              .delete()
              .in("id", missingIds);

            if (deleteMissingError) {
              throw new Error(
                `Could not remove missing attendees: ${deleteMissingError.message}`,
              );
            }
          }

          setStatus(
            `Import sync complete for ${workingEvent.name}. ${processed} rows synced. ${missingIds.length} removed.`,
          );
        } catch (err: any) {
          console.error(err);
          setStatus(`Import failed: ${err.message}`);
        } finally {
          setBusy(false);
        }
      },
      error: (error) => {
        console.error(error);
        setBusy(false);
        setStatus(`Parse failed: ${error.message}`);
      },
    });
  }

  return (
    <div style={{ padding: 30 }}>
      <h1>CSV Import</h1>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
          marginBottom: 16,
          maxWidth: 700,
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
          Imports will sync attendees into the selected admin working event.
        </div>
      </div>

      <p>
        Upload the event export. This importer prefers matching by{" "}
        <strong>email</strong>, then falls back to <strong>Entry Id</strong>.
      </p>

      <input
        type="file"
        accept=".csv,.txt,.tsv"
        disabled={busy || !workingEvent}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      <div style={{ marginTop: 20 }}>
        <strong>Status:</strong> {status}
      </div>
    </div>
  );
}
