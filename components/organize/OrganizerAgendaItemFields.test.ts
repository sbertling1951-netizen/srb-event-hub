import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  emptyOrganizerAgendaItem,
  organizerAgendaItemValues,
} from "./OrganizerAgendaItemFields";

const shared = readFileSync(
  fileURLToPath(new URL("./OrganizerAgendaItemFields.tsx", import.meta.url)),
  "utf8",
);
const agendaPage = readFileSync(
  fileURLToPath(new URL("../../app/organize/[eventId]/agenda/page.tsx", import.meta.url)),
  "utf8",
);
const workspacePage = readFileSync(
  fileURLToPath(new URL("../../app/organize/[eventId]/page.tsx", import.meta.url)),
  "utf8",
);

test("the shared component owns the one organizer agenda-item field set", () => {
  for (const label of ["Title", "Description", "Location", "Speaker", "Date", "Start time", "End time"]) {
    assert.ok(shared.includes(label), `shared agenda field set must render "${label}"`);
  }
  assert.match(shared, /export function OrganizerAgendaItemFields/);
});

test("the add form and the edit form use the ONE shared component -- no duplicate field impl", () => {
  assert.match(agendaPage, /from "@\/components\/organize\/OrganizerAgendaItemFields"/);
  assert.equal((agendaPage.match(/<OrganizerAgendaItemFields\b/g) ?? []).length, 2, "add + edit both render it");
  assert.doesNotMatch(agendaPage, /function AgendaItemFields\(|<input[^>]*"Speaker"/);
});

test("emptyOrganizerAgendaItem / organizerAgendaItemValues shape and prefill", () => {
  assert.deepEqual(emptyOrganizerAgendaItem(), {
    title: "", description: "", location: "", speaker: "", agendaDate: "", startTime: "", endTime: "",
  });
  assert.deepEqual(
    organizerAgendaItemValues({
      id: "i1", title: "Opening", description: "hi", location: null, speaker: null,
      agendaDate: "2026-10-10", startTime: "09:00:00", endTime: "09:30:00",
    }),
    {
      title: "Opening", description: "hi", location: "", speaker: "",
      agendaDate: "2026-10-10", startTime: "09:00", endTime: "09:30",
    },
  );
});

test("the shared agenda field set carries no published / category / reorder control", () => {
  const code = shared.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /publish|category|categor|reorder|sort order|visible_to_members/i);
});

test("the organizer workspace exposes the Agenda entry point for the eligible draft", () => {
  assert.match(workspacePage, /<PageSection title="Agenda"/);
  assert.match(workspacePage, /href=\{`\/organize\/\$\{encodeURIComponent\(draft\.event_id\)\}\/agenda`\}/);
  assert.match(workspacePage, /Open the agenda/);
  // the entry point only renders once a real owned draft has loaded (state === "ready", draft set)
  assert.match(workspacePage, /if \(state === "missing" \|\| !draft\) \{[\s\S]*?return[\s\S]*?\}\s*\n\s*return \(/);
});

test("the agenda route makes the private-draft, no-publish boundary explicit", () => {
  assert.match(agendaPage, /Planning for [^\n]*a private draft/);
  assert.match(agendaPage, /Private draft — not live/);
  assert.match(agendaPage, /nothing here is published/i);
});

test("the agenda route ships NO publish / import / template / CSV / reorder / category feature", () => {
  // no publish toggle or "make public" control
  assert.doesNotMatch(agendaPage, /is_published|isPublished|setPublished|Make public|Publish agenda|toggle.*publish/i);
  // no CSV / spreadsheet / template / import machinery
  assert.doesNotMatch(agendaPage, /papaparse|xlsx|Papa\.|XLSX\.|template_to_event|apply_agenda_template|import_event_agenda|replace_agenda_from_template/);
  // no reorder / drag control
  assert.doesNotMatch(agendaPage, /reorder_event_agenda|onDragStart|draggable|sort_order|\bmove_?up\b|\bmove_?down\b/i);
  // no category management
  assert.doesNotMatch(agendaPage, /create_agenda_category|agenda_categories|manage categor/i);
  // it only ever calls the four P-3B organizer agenda RPCs
  const rpcCalls = [...agendaPage.matchAll(/\b(get|create|update|delete)MyPrivateDraftAgenda\w*/g)].map((m) => m[0]);
  assert.deepEqual(new Set(rpcCalls), new Set([
    "getMyPrivateDraftAgenda", "createMyPrivateDraftAgendaItem",
    "updateMyPrivateDraftAgendaItem", "deleteMyPrivateDraftAgendaItem",
  ]));
});

test("agenda flows preserve the current event context (routes stay under /organize/[eventId])", () => {
  assert.match(agendaPage, /getMyPrivateEventDraft\(supabase, id\)/);
  assert.match(agendaPage, /getMyPrivateDraftAgenda\(supabase, id\)/);
  assert.match(agendaPage, /href=\{`\/organize\/\$\{encodeURIComponent\(eventId\)\}`\}/);
  assert.doesNotMatch(agendaPage, /\/admin\/|useAdmin|AdminRouteGuard|selectedEvent|has_event_task/);
});

test("add / edit / delete are wired to the organizer agenda adapter with optimistic concurrency", () => {
  assert.match(agendaPage, /createMyPrivateDraftAgendaItem\(supabase, \{ eventId, values: addForm \}\)/);
  assert.match(agendaPage, /updateMyPrivateDraftAgendaItem\(supabase, \{\s*\n\s*eventId,\s*\n\s*itemId: editingId,\s*\n\s*expectedVersion: version,/);
  assert.match(agendaPage, /deleteMyPrivateDraftAgendaItem\(supabase, \{\s*\n\s*eventId,\s*\n\s*itemId: item\.id,\s*\n\s*expectedVersion: version,/);
  // a stale result shows a refresh-required message and does not overwrite
  assert.match(agendaPage, /result\.status === "stale"/);
  assert.match(agendaPage, /setStale\(true\)/);
  assert.match(agendaPage, /changed somewhere else since you opened it/i);
  assert.match(agendaPage, /Refresh this page to load the latest agenda/i);
});
