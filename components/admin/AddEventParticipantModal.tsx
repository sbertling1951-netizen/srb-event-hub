"use client";

import { useMemo, useState } from "react";

import { supabase } from "@/lib/supabase";

export type ParticipantType =
  | "attendee"
  | "staff"
  | "host"
  | "helper"
  | "volunteer"
  | "vip"
  | "vendor";

type EventContext = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  event_code?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  currentEvent: EventContext | null;
  onSaved?: () => void;
};

type ManualParticipantForm = {
  participantType: ParticipantType;
  membershipNumber: string;
  firstName: string;
  lastName: string;
  nickname: string;
  email: string;
  primaryPhone: string;
  cellPhone: string;
  city: string;
  state: string;
  coachManufacturer: string;
  coachModel: string;
  coachLength: string;
  includeInHeadcount: boolean;
  needsNameTag: boolean;
  needsCoachPlate: boolean;
  needsParking: boolean;
  isFirstTimer: boolean;
  shareWithAttendees: boolean;
  hasArrived: boolean;
  specialEventsRaw: string;
  notes: string;
};

const PARTICIPANT_DEFAULTS: Record<
  ParticipantType,
  Pick<
    ManualParticipantForm,
    | "includeInHeadcount"
    | "needsNameTag"
    | "needsCoachPlate"
    | "needsParking"
    | "isFirstTimer"
    | "shareWithAttendees"
    | "hasArrived"
  >
> = {
  attendee: {
    includeInHeadcount: true,
    needsNameTag: true,
    needsCoachPlate: true,
    needsParking: true,
    isFirstTimer: false,
    shareWithAttendees: true,
    hasArrived: false,
  },
  staff: {
    includeInHeadcount: true,
    needsNameTag: true,
    needsCoachPlate: false,
    needsParking: false,
    isFirstTimer: false,
    shareWithAttendees: false,
    hasArrived: false,
  },
  host: {
    includeInHeadcount: true,
    needsNameTag: true,
    needsCoachPlate: true,
    needsParking: true,
    isFirstTimer: false,
    shareWithAttendees: true,
    hasArrived: false,
  },
  helper: {
    includeInHeadcount: true,
    needsNameTag: true,
    needsCoachPlate: false,
    needsParking: false,
    isFirstTimer: false,
    shareWithAttendees: false,
    hasArrived: false,
  },
  volunteer: {
    includeInHeadcount: true,
    needsNameTag: true,
    needsCoachPlate: false,
    needsParking: false,
    isFirstTimer: false,
    shareWithAttendees: false,
    hasArrived: false,
  },
  vip: {
    includeInHeadcount: true,
    needsNameTag: true,
    needsCoachPlate: false,
    needsParking: false,
    isFirstTimer: false,
    shareWithAttendees: false,
    hasArrived: false,
  },
  vendor: {
    includeInHeadcount: true,
    needsNameTag: true,
    needsCoachPlate: false,
    needsParking: true,
    isFirstTimer: false,
    shareWithAttendees: false,
    hasArrived: false,
  },
};

function makeInitialForm(): ManualParticipantForm {
  return {
    participantType: "attendee",
    membershipNumber: "",
    firstName: "",
    lastName: "",
    nickname: "",
    email: "",
    primaryPhone: "",
    cellPhone: "",
    city: "",
    state: "",
    coachManufacturer: "",
    coachModel: "",
    coachLength: "",
    includeInHeadcount: true,
    needsNameTag: true,
    needsCoachPlate: true,
    needsParking: true,
    isFirstTimer: false,
    shareWithAttendees: true,
    hasArrived: false,
    specialEventsRaw: "",
    notes: "",
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pad3(value: number) {
  return String(value).padStart(3, "0");
}

export default function AddEventParticipantModal({
  open,
  onClose,
  currentEvent,
  onSaved,
}: Props) {
  const [form, setForm] = useState<ManualParticipantForm>(makeInitialForm());
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const eventId = currentEvent?.id || null;
  const eventLabel = currentEvent?.name || currentEvent?.eventName || "Event";

  const canSave = useMemo(() => {
    return !!eventId && !!(form.firstName.trim() || form.lastName.trim());
  }, [eventId, form.firstName, form.lastName]);

  function updateForm<K extends keyof ManualParticipantForm>(
    key: K,
    value: ManualParticipantForm[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function applyDefaults(type: ParticipantType) {
    setForm((prev) => ({
      ...prev,
      participantType: type,
      ...PARTICIPANT_DEFAULTS[type],
    }));
  }

  async function generateEntryId(participantType: ParticipantType) {
    if (!eventId) {throw new Error("No event selected.");}

    const eventCodeBase = slugify(
      currentEvent?.eventName || currentEvent?.name || "event",
    );

    const prefix = `${eventCodeBase}-${participantType}-`;

    const { data, error } = await supabase
      .from("event_import_rows")
      .select("entry_id")
      .eq("event_id", eventId)
      .ilike("entry_id", `${prefix}%`);

    if (error) {throw error;}

    let maxSeq = 0;
    for (const row of data || []) {
      const entryId = String(row.entry_id || "");
      const match = entryId.match(/-(\d+)$/);
      if (match) {
        const seq = Number(match[1]);
        if (Number.isFinite(seq) && seq > maxSeq) {maxSeq = seq;}
      }
    }

    return `${prefix}${pad3(maxSeq + 1)}`;
  }

  async function handleSave() {
    if (!eventId) {
      setError("No event selected.");
      return;
    }

    if (!form.firstName.trim() && !form.lastName.trim()) {
      setError("Enter at least a first or last name.");
      return;
    }

    setSaving(true);
    setError(null);
    setStatus("Saving participant...");

    try {
      const entryId = await generateEntryId(form.participantType);

      const attendeePayload = {
        event_id: eventId,
        entry_id: entryId,
        email: form.email.trim().toLowerCase() || null,
        pilot_first: form.firstName.trim() || null,
        pilot_last: form.lastName.trim() || null,
        copilot_first: null,
        copilot_last: null,
        nickname: form.nickname.trim() || null,
        copilot_nickname: null,
        membership_number: form.membershipNumber.trim() || null,
        primary_phone: form.primaryPhone.trim() || null,
        cell_phone: form.cellPhone.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        wants_to_volunteer:
          form.participantType === "helper" ||
          form.participantType === "volunteer",
        is_first_timer: form.isFirstTimer,
        coach_manufacturer: form.coachManufacturer.trim() || null,
        coach_model: form.coachModel.trim() || null,
        share_with_attendees: form.shareWithAttendees,
        special_events_raw: form.specialEventsRaw.trim() || null,
        raw_import: {
          manual_entry: true,
          participant_type: form.participantType,
          notes: form.notes,
        },
        participant_type: form.participantType,
        source_type: "manual_participant",
        include_in_headcount: form.includeInHeadcount,
        needs_name_tag: form.needsNameTag,
        needs_coach_plate: form.needsCoachPlate,
        needs_parking: form.needsParking,
        has_arrived: form.hasArrived,
        notes: form.notes.trim() || null,
      };

      const { error: attendeeError } = await supabase
        .from("attendees")
        .insert(attendeePayload);

      if (attendeeError) {throw attendeeError;}

      const importRowPayload = {
        event_id: eventId,
        import_type: "manual_participant",
        source_filename: "manual-entry",
        row_number: null,
        entry_id: entryId,
        email: form.email.trim().toLowerCase() || null,
        membership_number: form.membershipNumber.trim() || null,
        pilot_first: form.firstName.trim() || null,
        pilot_last: form.lastName.trim() || null,
        pilot_badge_nickname: form.nickname.trim() || null,
        copilot_first: null,
        copilot_last: null,
        copilot_badge_nickname: null,
        additional_attendees: null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        primary_phone: form.primaryPhone.trim() || null,
        cell_phone: form.cellPhone.trim() || null,
        share_with_attendees: form.shareWithAttendees,
        wants_to_volunteer:
          form.participantType === "helper" ||
          form.participantType === "volunteer",
        is_first_timer: form.isFirstTimer,
        coach_manufacturer: form.coachManufacturer.trim() || null,
        coach_model: form.coachModel.trim() || null,
        special_events_raw: form.specialEventsRaw.trim() || null,
        raw_import: {
          manual_entry: true,
          participant_type: form.participantType,
          notes: form.notes,
        },
        participant_type: form.participantType,
        source_type: "manual_participant",
        include_in_headcount: form.includeInHeadcount,
        needs_name_tag: form.needsNameTag,
        needs_coach_plate: form.needsCoachPlate,
        needs_parking: form.needsParking,
        notes: form.notes.trim() || null,
      };

      const { error: importRowError } = await supabase
        .from("event_import_rows")
        .insert(importRowPayload);

      if (importRowError) {throw importRowError;}

      setStatus(`Saved ${form.firstName} ${form.lastName} (${entryId}).`);
      setForm(makeInitialForm());
      onSaved?.();
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Could not save participant.");
      setStatus("");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {return null;}

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: 900,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 18,
          borderRadius: 14,
          background: "white",
        }}
      >
        <div
          style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
        >
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>
              Add Event Participant
            </h2>
            <div style={{ opacity: 0.8 }}>{eventLabel}</div>
          </div>
          <button onClick={onClose}>Close</button>
        </div>

        {error ? (
          <div
            style={{
              marginTop: 12,
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

        {status ? <div style={{ marginTop: 12 }}>{status}</div> : null}

        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            marginTop: 16,
          }}
        >
          <div>
            <label style={{ display: "block", marginBottom: 6 }}>
              Participant Type
            </label>
            <select
              value={form.participantType}
              onChange={(e) => applyDefaults(e.target.value as ParticipantType)}
              style={{ width: "100%" }}
            >
              <option value="attendee">Attendee</option>
              <option value="staff">Staff</option>
              <option value="host">Host</option>
              <option value="helper">Helper</option>
              <option value="volunteer">Volunteer</option>
              <option value="vip">VIP</option>
              <option value="vendor">Vendor</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6 }}>
              Member Number
            </label>
            <input
              value={form.membershipNumber}
              onChange={(e) => updateForm("membershipNumber", e.target.value)}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6 }}>
              First Name
            </label>
            <input
              value={form.firstName}
              onChange={(e) => updateForm("firstName", e.target.value)}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6 }}>
              Last Name
            </label>
            <input
              value={form.lastName}
              onChange={(e) => updateForm("lastName", e.target.value)}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6 }}>
              Nickname for Badge
            </label>
            <input
              value={form.nickname}
              onChange={(e) => updateForm("nickname", e.target.value)}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6 }}>Email</label>
            <input
              value={form.email}
              onChange={(e) => updateForm("email", e.target.value)}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6 }}>
              Primary Phone
            </label>
            <input
              value={form.primaryPhone}
              onChange={(e) => updateForm("primaryPhone", e.target.value)}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6 }}>
              Cell Phone
            </label>
            <input
              value={form.cellPhone}
              onChange={(e) => updateForm("cellPhone", e.target.value)}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6 }}>City</label>
            <input
              value={form.city}
              onChange={(e) => updateForm("city", e.target.value)}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6 }}>State</label>
            <input
              value={form.state}
              onChange={(e) => updateForm("state", e.target.value)}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6 }}>
              Coach Manufacturer
            </label>
            <input
              value={form.coachManufacturer}
              onChange={(e) => updateForm("coachManufacturer", e.target.value)}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6 }}>
              Coach Model
            </label>
            <input
              value={form.coachModel}
              onChange={(e) => updateForm("coachModel", e.target.value)}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6 }}>
              Coach Length
            </label>
            <input
              value={form.coachLength}
              onChange={(e) => updateForm("coachLength", e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <h3 style={{ marginBottom: 10 }}>Participation Options</h3>
          <div
            style={{
              display: "grid",
              gap: 10,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            {[
              ["includeInHeadcount", "Include in attendee headcount"],
              ["needsNameTag", "Needs name tag"],
              ["needsCoachPlate", "Needs coach plate"],
              ["needsParking", "Needs parking assignment"],
              ["isFirstTimer", "Is first timer"],
              ["shareWithAttendees", "Share with attendees"],
              ["hasArrived", "Has arrived"],
            ].map(([key, label]) => (
              <label
                key={key}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  border: "1px solid #ddd",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                <input
                  type="checkbox"
                  checked={!!form[key as keyof ManualParticipantForm]}
                  onChange={(e) =>
                    updateForm(
                      key as keyof ManualParticipantForm,
                      e.target.checked as never,
                    )
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <label style={{ display: "block", marginBottom: 6 }}>
            Special Events / Meals / Activities
          </label>
          <textarea
            value={form.specialEventsRaw}
            onChange={(e) => updateForm("specialEventsRaw", e.target.value)}
            rows={3}
            style={{ width: "100%" }}
          />
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={{ display: "block", marginBottom: 6 }}>Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => updateForm("notes", e.target.value)}
            rows={3}
            style={{ width: "100%" }}
          />
        </div>

        <div
          style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}
        >
          <button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? "Saving..." : "Save Participant"}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
