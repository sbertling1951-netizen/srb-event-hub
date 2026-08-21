"use client";

import { useEffect, useMemo, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { AppButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Checkbox } from "@/components/ui/Field";
import { PageSection } from "@/components/ui/PageSection";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";

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

export function checklistStorageKeyForEvent(eventId: string | null | undefined) {
  return eventId ? `${STORAGE_KEY_BASE}-${eventId}` : STORAGE_KEY_BASE;
}

export default function AdminChecklistPage() {
  return (
    <AdminRouteGuard requiredPermission="can_view_admin_dashboard">
      <AdminShellAdapter pageTitle="Pre-Rally Checklist">
        <AdminChecklistPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

function AdminChecklistPageInner() {
  const [storageKey, setStorageKey] = useState(STORAGE_KEY_BASE);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  useEffect(() => {
    const syncStorageKey = () => {
      setStorageKey(checklistStorageKeyForEvent(getCurrentAdminEvent()?.id));
    };

    syncStorageKey();
    return subscribeToAdminWorkspace(syncStorageKey);
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
    } finally {
      // Do not persist the prior Event's in-memory state under this new key
      // until the new Event's device-local state has been read.
      setLoadedStorageKey(storageKey);
    }
  }, [storageKey]);

  useEffect(() => {
    if (loadedStorageKey !== storageKey) {
      return;
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify(checked));
    } catch (err) {
      console.error("Could not save checklist state", err);
    }
  }, [checked, loadedStorageKey, storageKey]);

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

  function confirmReset() {
    setChecked({});
    setResetDialogOpen(false);
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-6)", minWidth: 0 }}>
      <ConfirmDialog
        open={resetDialogOpen}
        title="Reset Checklist"
        message="Reset the full pre-rally checklist? This clears every checked item on this device."
        confirmLabel="Reset Checklist"
        danger
        onCancel={() => setResetDialogOpen(false)}
        onConfirm={confirmReset}
      />

      <PageSection variant="card">
        <p className="app-subtle-text" style={{ marginTop: 0 }}>
          Track your rally readiness from setup through departure.
        </p>

        <div
          style={{
            display: "grid",
            gap: "var(--space-4)",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(180px, 100%), 1fr))",
            marginTop: "var(--space-5)",
          }}
        >
          <div>
            <strong>Total Items</strong>
            <div style={{ fontSize: 28, marginTop: "var(--space-2)" }}>{totalItems}</div>
          </div>

          <div>
            <strong>Completed</strong>
            <div style={{ fontSize: 28, marginTop: "var(--space-2)" }}>{completedItems}</div>
          </div>

          <div>
            <strong>Progress</strong>
            <div style={{ fontSize: 28, marginTop: "var(--space-2)" }}>{percentComplete}%</div>
          </div>
        </div>

        <div style={{ marginTop: "var(--space-6)" }}>
          <AppButton variant="danger" onClick={() => setResetDialogOpen(true)}>
            Reset Checklist
          </AppButton>
        </div>
      </PageSection>

      {CHECKLIST_SECTIONS.map((section, sectionIndex) => (
        <PageSection key={section.title} variant="section" title={section.title}>
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            {section.items.map((item, itemIndex) => {
              const key = `${sectionIndex}-${itemIndex}`;
              const isDone = !!checked[key];

              return (
                <div
                  key={key}
                  style={{
                    minWidth: 0,
                    padding: "var(--space-3) var(--space-4)",
                    border: "var(--border-width-default) solid var(--color-border-default)",
                    borderRadius: "var(--radius-medium)",
                    background: isDone
                      ? "var(--color-status-success-bg)"
                      : "var(--color-bg-panel)",
                  }}
                >
                  <Checkbox
                    checked={isDone}
                    onChange={() => toggleItem(key)}
                    label={
                      <span
                        style={{
                          textDecoration: isDone ? "line-through" : "none",
                          opacity: isDone ? 0.75 : 1,
                          minWidth: 0,
                          overflowWrap: "anywhere",
                        }}
                      >
                        {item}
                      </span>
                    }
                  />
                </div>
              );
            })}
          </div>
        </PageSection>
      ))}
    </div>
  );
}
