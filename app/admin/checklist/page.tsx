"use client";

import { useEffect, useMemo, useState } from "react";

type ChecklistSection = {
  title: string;
  items: string[];
};

const CHECKLIST_SECTIONS: ChecklistSection[] = [
  {
    title: "1 Week Before",
    items: [
      "Push latest code to GitHub",
      "Create rally tag (for example: amana26-ready)",
      "Test attendee import",
      "Test reports page",
      "Test name tag printing",
      "Test coach plate printing",
    ],
  },
  {
    title: "2–3 Days Before",
    items: [
      "Export full database backup",
      "Save attendee import file",
      "Save agenda import file",
      "Save logos and map files",
      "Generate name tag PDF",
      "Generate coach plate PDF",
      "Generate attendee roster PDF",
      "Generate parking report PDF",
    ],
  },
  {
    title: "Night Before",
    items: [
      "Final git push",
      "Optional final tag",
      "Verify all PDFs open correctly",
      "Copy all files to cloud storage",
      "Copy all files to local backup or USB",
      "Pack laptop and charger",
    ],
  },
  {
    title: "At Rally (Just In Case)",
    items: [
      "Have PDFs ready for printing",
      "Have attendee import file accessible",
      "Have database backup accessible",
      "Verify app loads on device",
      "Keep backup device or cloud access ready",
    ],
  },
];

const STORAGE_KEY_BASE = "fcoc-pre-rally-checklist";

export default function AdminChecklistPage() {
  const [storageKey, setStorageKey] = useState(STORAGE_KEY_BASE);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem("fcoc-admin-event-context");
      if (!raw) return;

      const parsed = JSON.parse(raw);
      const eventId = parsed?.id;

      if (eventId) {
        setStorageKey(`${STORAGE_KEY_BASE}-${eventId}`);
      }
    } catch (err) {
      console.error("Could not determine event context for checklist", err);
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        setChecked(JSON.parse(raw));
      } else {
        setChecked({});
      }
    } catch (err) {
      console.error("Could not load checklist state", err);
      setChecked({});
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(checked));
    } catch (err) {
      console.error("Could not save checklist state", err);
    }
  }, [checked, storageKey]);

  const totalItems = useMemo(
    () =>
      CHECKLIST_SECTIONS.reduce(
        (sum, section) => sum + section.items.length,
        0,
      ),
    [],
  );

  const completedItems = useMemo(
    () => Object.values(checked).filter(Boolean).length,
    [checked],
  );

  const percentComplete =
    totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  function toggleItem(key: string) {
    setChecked((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }

  function resetChecklist() {
    const confirmed = window.confirm("Reset the full pre-rally checklist?");
    if (!confirmed) return;
    setChecked({});
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Pre-Rally Checklist</h1>
        <p style={{ marginTop: 0, opacity: 0.8 }}>
          Track your rally readiness from setup through departure.
        </p>

        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            marginTop: 14,
          }}
        >
          <div className="card">
            <strong>Total Items</strong>
            <div style={{ fontSize: 28, marginTop: 6 }}>{totalItems}</div>
          </div>

          <div className="card">
            <strong>Completed</strong>
            <div style={{ fontSize: 28, marginTop: 6 }}>{completedItems}</div>
          </div>

          <div className="card">
            <strong>Progress</strong>
            <div style={{ fontSize: 28, marginTop: 6 }}>{percentComplete}%</div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <button onClick={resetChecklist}>Reset Checklist</button>
        </div>
      </div>

      {CHECKLIST_SECTIONS.map((section, sectionIndex) => (
        <div key={section.title} className="card" style={{ padding: 18 }}>
          <h2 style={{ marginTop: 0, marginBottom: 12 }}>{section.title}</h2>

          <div style={{ display: "grid", gap: 10 }}>
            {section.items.map((item, itemIndex) => {
              const key = `${sectionIndex}-${itemIndex}`;
              const isDone = !!checked[key];

              return (
                <label
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "10px 12px",
                    border: "1px solid #ddd",
                    borderRadius: 10,
                    background: isDone ? "#f0fff4" : "#fff",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isDone}
                    onChange={() => toggleItem(key)}
                    style={{ marginTop: 3 }}
                  />

                  <span
                    style={{
                      textDecoration: isDone ? "line-through" : "none",
                      opacity: isDone ? 0.75 : 1,
                    }}
                  >
                    {item}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
