"use client";

import { FormEvent, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";

export default function NewEventPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_events">
      <NewEventPageInner />
    </AdminRouteGuard>
  );
}

function NewEventPageInner() {
  const [saved, setSaved] = useState(false);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
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
          <input className="input" defaultValue="FCOC Spring Junction" />
        </label>
        <label>
          Event code
          <input className="input" defaultValue="BRANSON26" />
        </label>
        <label>
          Location name
          <input className="input" defaultValue="Branson Rally Grounds" />
        </label>
        <label>
          Address
          <input
            className="input"
            defaultValue="1000 FCOC Drive, Branson, MO 65616"
          />
        </label>
        <label>
          Start date
          <input className="input" type="date" defaultValue="2026-04-22" />
        </label>
        <label>
          End date
          <input className="input" type="date" defaultValue="2026-04-26" />
        </label>
        <label>
          Registration closes
          <input
            className="input"
            type="datetime-local"
            defaultValue="2026-04-10T23:59"
          />
        </label>
        <label>
          Self-edit closes
          <input
            className="input"
            type="datetime-local"
            defaultValue="2026-04-12T23:59"
          />
        </label>
        <label>
          Cancellation deadline
          <input
            className="input"
            type="datetime-local"
            defaultValue="2026-04-10T23:59"
          />
        </label>
        <label>
          Refund deadline
          <input
            className="input"
            type="datetime-local"
            defaultValue="2026-04-08T23:59"
          />
        </label>
        <label className="grid" style={{ gridColumn: "1 / -1" }}>
          Event notes
          <textarea
            rows={5}
            defaultValue="Add coach parking notes, check-in instructions, and anything members should know before arrival."
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
