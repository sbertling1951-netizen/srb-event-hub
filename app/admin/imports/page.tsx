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

type HouseholdMemberInsert = {
  event_id: string;
  attendee_id: string;
  entry_id: string | null;
  person_role: "pilot" | "copilot" | "additional";
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  display_name: string | null;
  age_text: string | null;
  sort_order: number;
  raw_text: string | null;
};

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

function titleCaseWord(word: string) {
  if (!word) return word;
  if (/^[A-Z0-9]+$/.test(word)) {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }
  if (/^[a-z0-9]+$/.test(word)) {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function normalizeName(value?: string) {
  const trimmed = value?.trim() || "";
  if (!trimmed) return null;

  return trimmed
    .split(/\s+/)
    .map((part) =>
      part
        .split("-")
        .map((piece) =>
          piece
            .split("'")
            .map((seg) => titleCaseWord(seg))
            .join("'"),
        )
        .join("-"),
    )
    .join(" ");
}

function normalizeNickname(value?: string) {
  const trimmed = value?.trim() || "";
  if (!trimmed) return null;
  return normalizeName(trimmed);
}

function buildDisplayName(
  first: string | null,
  nickname: string | null,
  last: string | null,
) {
  const lead = nickname || first || null;
  if (!lead && !last) return null;
  return [lead, last].filter(Boolean).join(" ");
}

function splitAdditionalAttendees(
  raw?: string,
): Array<{ name: string; age_text: string | null; raw_text: string }> {
  const value = raw?.trim() || "";
  if (!value) return [];

  const normalized = value
    .replace(/\r\n/g, ";")
    .replace(/\n/g, ";")
    .replace(/\s+\&\s+/g, ";")
    .replace(/\s+and\s+/gi, ";");

  const chunks = normalized
    .split(/[;|]/)
    .map((c) => c.trim())
    .filter(Boolean);

  const results: Array<{
    name: string;
    age_text: string | null;
    raw_text: string;
  }> = [];

  for (const chunk of chunks) {
    const commaParts = chunk
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    if (commaParts.length > 1) {
      for (const part of commaParts) {
        const parsed = parseAdditionalPerson(part);
        if (parsed) results.push(parsed);
      }
      continue;
    }

    const parsed = parseAdditionalPerson(chunk);
    if (parsed) results.push(parsed);
  }

  return results;
}

function parseAdditionalPerson(text: string) {
  const raw = text.trim();
  if (!raw) return null;

  let age_text: string | null = null;
  let name = raw;

  const parenMatch = raw.match(/^(.*?)(?:\s*\(([^)]+)\))$/);
  if (parenMatch) {
    name = parenMatch[1].trim();
    age_text = parenMatch[2].trim() || null;
  } else {
    const ageWordMatch = raw.match(/^(.*?)(?:\s+age\s+(\d+))$/i);
    if (ageWordMatch) {
      name = ageWordMatch[1].trim();
      age_text = ageWordMatch[2].trim() || null;
    } else {
      const trailingNumberMatch = raw.match(/^(.*?)(?:\s+(\d{1,2}))$/);
      if (trailingNumberMatch) {
        name = trailingNumberMatch[1].trim();
        age_text = trailingNumberMatch[2].trim() || null;
      }
    }
  }

  name = normalizeName(name) || "";
  if (!name) return null;

  return {
    name,
    age_text,
    raw_text: raw,
  };
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

  async function replaceHouseholdMembers(
    attendeeId: string,
    members: HouseholdMemberInsert[],
  ) {
    const { error: deleteError } = await supabase
      .from("attendee_household_members")
      .delete()
      .eq("attendee_id", attendeeId);

    if (deleteError) {
      throw new Error(
        `Could not clear household members: ${deleteError.message}`,
      );
    }

    if (members.length === 0) return;

    const { error: insertError } = await supabase
      .from("attendee_household_members")
      .insert(members);

    if (insertError) {
      throw new Error(
        `Could not save household members: ${insertError.message}`,
      );
    }
  }

  async function handleFile(file: File) {
    if (!workingEvent) {
      setStatus(
        "No admin working event selected. Choose one on the Admin Dashboard first.",
      );
      return;
    }

    setBusy(true);
    setStatus(`Reading file for ${workingEvent.name}...`);

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

            if (!entryId && !email) continue;

            if (entryId) seenEntryIds.add(entryId);
            if (email) seenEmails.add(email);

            const pilotFirst = normalizeName(
              getField(row, ["Pilot Name (First)"]),
            );
            const pilotLast = normalizeName(
              getField(row, ["Pilot Name (Last)"]),
            );
            const pilotNickname = normalizeNickname(
              getField(row, ["Nickname for Badge"]),
            );

            const copilotFirst = normalizeName(
              getField(row, ["Co-Pilot Name (First)"]),
            );
            const copilotLast = normalizeName(
              getField(row, ["Co-Pilot Name (Last)"]),
            );
            const copilotNickname = normalizeNickname(
              getField(row, ["Nickname for Badge.1"]),
            );

            const additionalRaw = getField(row, [
              "Additional attendees, if so give name(s) and age(s)",
            ]);
            const additionalPeople = splitAdditionalAttendees(additionalRaw);

            const attendeePayload = {
              event_id: workingEvent.id,
              entry_id: entryId || null,
              membership_number:
                normalizeText(getField(row, ["FCOC Membership Number"])) ||
                null,
              pilot_first: pilotFirst,
              pilot_last: pilotLast,
              copilot_first: copilotFirst,
              copilot_last: copilotLast,
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

              if (emailMatch?.id) matchedId = emailMatch.id;
            }

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

              if (entryMatch?.id) matchedId = entryMatch.id;
            }

            let attendeeId: string;

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

              attendeeId = matchedId;
            } else {
              const { data: inserted, error: insertError } = await supabase
                .from("attendees")
                .insert(attendeePayload)
                .select("id")
                .single();

              if (insertError || !inserted?.id) {
                throw new Error(
                  `Insert failed for ${email || `Entry Id ${entryId}`}: ${insertError?.message || "Unknown error"}`,
                );
              }

              attendeeId = inserted.id;
            }

            const householdMembers: HouseholdMemberInsert[] = [];

            if (pilotFirst || pilotLast || pilotNickname) {
              householdMembers.push({
                event_id: workingEvent.id,
                attendee_id: attendeeId,
                entry_id: entryId || null,
                person_role: "pilot",
                first_name: pilotFirst,
                last_name: pilotLast,
                nickname: pilotNickname,
                display_name: buildDisplayName(
                  pilotFirst,
                  pilotNickname,
                  pilotLast,
                ),
                age_text: null,
                sort_order: 1,
                raw_text: null,
              });
            }

            if (copilotFirst || copilotLast || copilotNickname) {
              householdMembers.push({
                event_id: workingEvent.id,
                attendee_id: attendeeId,
                entry_id: entryId || null,
                person_role: "copilot",
                first_name: copilotFirst,
                last_name: copilotLast,
                nickname: copilotNickname,
                display_name: buildDisplayName(
                  copilotFirst,
                  copilotNickname,
                  copilotLast,
                ),
                age_text: null,
                sort_order: 2,
                raw_text: null,
              });
            }

            additionalPeople.forEach((person, index) => {
              householdMembers.push({
                event_id: workingEvent.id,
                attendee_id: attendeeId,
                entry_id: entryId || null,
                person_role: "additional",
                first_name: person.name,
                last_name: null,
                nickname: null,
                display_name: person.name,
                age_text: person.age_text,
                sort_order: 100 + index,
                raw_text: person.raw_text,
              });
            });

            await replaceHouseholdMembers(attendeeId, householdMembers);

            processed += 1;
            setStatus(
              `Syncing ${processed} of ${rows.length} rows into ${workingEvent.name}...`,
            );
          }

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
        <strong>email</strong>, then falls back to <strong>Entry Id</strong>. It
        also builds a household member list for pilot, copilot, and additional
        attendees.
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
