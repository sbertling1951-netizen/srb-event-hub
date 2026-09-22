import { STORAGE_KEYS } from "@/lib/storageKeys";

export type AgendaForm = {
  id: string;
  external_id: string;
  title: string;
  description: string;
  location: string;
  speaker: string;
  category: string;
  color: string;
  agenda_date: string;
  start_time: string;
  end_time: string;
  sort_order: string;
  is_published: boolean;
};

export type AgendaDraft = { form: AgendaForm; original: AgendaForm; updatedAt: number };
const STRING_FIELDS = ["id", "external_id", "title", "description", "location", "speaker", "category", "color", "agenda_date", "start_time", "end_time", "sort_order"] as const;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function agendaDraftKey(accountId: string, eventId: string) {
  return `${STORAGE_KEYS.agendaItemDraftPrefix}::${encodeURIComponent(accountId)}::${encodeURIComponent(eventId)}`;
}

function isForm(value: unknown): value is AgendaForm {
  if (!value || typeof value !== "object") {return false;}
  const form = value as Record<string, unknown>;
  return STRING_FIELDS.every((key) => typeof form[key] === "string") &&
    typeof form.is_published === "boolean" && Object.keys(form).length === STRING_FIELDS.length + 1;
}

// Only temporary, per-tab recovery data, never authority or published content.
// Session storage survives reloads without leaving drafts in durable localStorage.
export function readAgendaDraft(key: string, now = Date.now()): AgendaDraft | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) {return null;}
    const draft = JSON.parse(raw) as AgendaDraft;
    if (!draft || !isForm(draft.form) || !isForm(draft.original) ||
        draft.form.id !== draft.original.id || !Number.isFinite(draft.updatedAt) ||
        draft.updatedAt > now || now - draft.updatedAt > MAX_AGE_MS) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function writeAgendaDraft(key: string, draft: AgendaDraft | null): boolean {
  try {
    if (draft) {window.sessionStorage.setItem(key, JSON.stringify(draft));}
    else {window.sessionStorage.removeItem(key);}
    return true;
  } catch {
    return false;
  }
}

// Called by the existing auth lifecycle even after leaving the Agenda page.
export function clearAgendaDrafts() {
  try {
    const storage = window.sessionStorage;
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (key?.startsWith(`${STORAGE_KEYS.agendaItemDraftPrefix}::`)) {storage.removeItem(key);}
    }
  } catch {
    // Storage can be unavailable; authentication must still complete normally.
  }
}
