"use client";

import { FormEvent, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";

type EventFormState = {
  name: string;
  code: string;
  venue_name: string;
  address: string;
  start_date: string;
  end_date: string;
  registration_close: string;
  self_edit_close: string;
  cancellation_deadline: string;
  refund_deadline: string;
  notes: string;
  lat: string;
  lng: string;
};

const DEFAULT_FORM: EventFormState = {
  name: "FCOC Spring Junction",
  code: "BRANSON26",
  venue_name: "Branson Rally Grounds",
  address: "1000 FCOC Drive, Branson, MO 65616",
  start_date: "2026-04-22",
  end_date: "2026-04-26",
  registration_close: "2026-04-10T23:59",
  self_edit_close: "2026-04-12T23:59",
  cancellation_deadline: "2026-04-10T23:59",
  refund_deadline: "2026-04-08T23:59",
  notes:
    "Add coach parking notes, check-in instructions, and anything members should know before arrival.",
  lat: "",
  lng: "",
};

export default function NewEventPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_events">
      <NewEventPageInner />
    </AdminRouteGuard>
  );
}

function NewEventPageInner() {
  const [saved, setSaved] = useState(false);
  const [loadingGeo, setLoadingGeo] = useState(false);

  const [form, setForm] = useState<EventFormState>(DEFAULT_FORM);

  async function geocodeAddress() {
    try {
      setLoadingGeo(true);

      const query = `${form.venue_name} ${form.address}`.trim();

      if (!query) {
        return;
      }

      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`,
      );

      const data = await response.json();

      if (!Array.isArray(data) || !data.length) {
        alert("Could not locate address.");
        return;
      }

      setForm((prev) => ({
        ...prev,
        lat: String(data[0].lat || ""),
        lng: String(data[0].lon || ""),
      }));
    } catch (err) {
      console.error("geocodeAddress error:", err);
      alert("Failed to geocode event location.");
    } finally {
      setLoadingGeo(false);
    }
  }

  function updateField<K extends keyof EventFormState>(
    key: K,
    value: EventFormState[K],
  ) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    console.log("SAVE EVENT", form);

    setSaved(true);
  }

  return (
    <div className="card">
      <div className="spread">
        <div>
          <h2>Create Event</h2>

          <p className="muted">
            Set event details, map anchor, and cutoff dates.
          </p>
        </div>

        {saved ? <span className="badge ok">Draft saved</span> : null}
      </div>

      <form className="grid grid-2" onSubmit={handleSubmit}>
        <label>
          Event name
          <input
            className="input"
            value={form.name}
            onChange={(e) => updateField("name", e.target.value)}
          />
        </label>

        <label>
          Event code
          <input
            className="input"
            value={form.code}
            onChange={(e) => updateField("code", e.target.value)}
          />
        </label>

        <label>
          Location name
          <input
            className="input"
            value={form.venue_name}
            onChange={(e) => updateField("venue_name", e.target.value)}
          />
        </label>

        <label>
          Address
          <input
            className="input"
            value={form.address}
            onChange={(e) => updateField("address", e.target.value)}
          />
        </label>

        <label>
          Start date
          <input
            className="input"
            type="date"
            value={form.start_date}
            onChange={(e) => updateField("start_date", e.target.value)}
          />
        </label>

        <label>
          End date
          <input
            className="input"
            type="date"
            value={form.end_date}
            onChange={(e) => updateField("end_date", e.target.value)}
          />
        </label>

        <label>
          Registration closes
          <input
            className="input"
            type="datetime-local"
            value={form.registration_close}
            onChange={(e) => updateField("registration_close", e.target.value)}
          />
        </label>

        <label>
          Self-edit closes
          <input
            className="input"
            type="datetime-local"
            value={form.self_edit_close}
            onChange={(e) => updateField("self_edit_close", e.target.value)}
          />
        </label>

        <label>
          Cancellation deadline
          <input
            className="input"
            type="datetime-local"
            value={form.cancellation_deadline}
            onChange={(e) =>
              updateField("cancellation_deadline", e.target.value)
            }
          />
        </label>

        <label>
          Refund deadline
          <input
            className="input"
            type="datetime-local"
            value={form.refund_deadline}
            onChange={(e) => updateField("refund_deadline", e.target.value)}
          />
        </label>

        <div
          className="card"
          style={{
            gridColumn: "1 / -1",
            background: "#f8fafc",
            border: "1px solid #dbeafe",
          }}
        >
          <div className="spread">
            <div>
              <div style={{ fontWeight: 800 }}>Event Map Coordinates</div>

              <div className="muted" style={{ marginTop: 4 }}>
                Used for Nearby sorting, maps, routing, and future travel tools.
              </div>
            </div>

            <button
              className="button-secondary"
              type="button"
              onClick={() => void geocodeAddress()}
              disabled={loadingGeo}
            >
              {loadingGeo ? "Locating..." : "Auto Locate"}
            </button>
          </div>

          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <label>
              Latitude
              <input
                className="input"
                value={form.lat}
                onChange={(e) => updateField("lat", e.target.value)}
              />
            </label>

            <label>
              Longitude
              <input
                className="input"
                value={form.lng}
                onChange={(e) => updateField("lng", e.target.value)}
              />
            </label>
          </div>

          {form.lat && form.lng ? (
            <div
              style={{
                marginTop: 14,
                fontSize: 13,
                color: "#2563eb",
                fontWeight: 700,
              }}
            >
              📍 Coordinates ready for Nearby distance calculations
            </div>
          ) : null}
        </div>

        <label className="grid" style={{ gridColumn: "1 / -1" }}>
          Event notes
          <textarea
            rows={5}
            value={form.notes}
            onChange={(e) => updateField("notes", e.target.value)}
          />
        </label>

        <div className="row" style={{ gridColumn: "1 / -1" }}>
          <button className="button" type="submit">
            Save Draft
          </button>

          <button className="button-secondary" type="button">
            Publish
          </button>
        </div>
      </form>
    </div>
  );
}
