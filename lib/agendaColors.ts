export const DEFAULT_AGENDA_COLOR = "#e5e7eb";

export const AGENDA_CATEGORY_COLORS: Record<string, string> = {
  "check-in": "#dbeafe",
  seminar: "#dcfce7",
  class: "#dcfce7",
  training: "#dcfce7",
  social: "#fef3c7",
  happyhour: "#fef3c7",
  "happy hour": "#fef3c7",
  meal: "#fde68a",
  breakfast: "#fde68a",
  lunch: "#fde68a",
  dinner: "#fde68a",
  maintenance: "#fee2e2",
  tech: "#fee2e2",
  safety: "#fee2e2",
  travel: "#ede9fe",
  meeting: "#e0e7ff",
  business: "#e0e7ff",
  registration: "#fce7f3",
  entertainment: "#fed7aa",
};

export function normalizeAgendaCategory(category: string | null | undefined) {
  return (category || "").trim().toLowerCase();
}

export function getAgendaColor(
  category: string | null | undefined,
  explicitColor?: string | null,
) {
  const cleanExplicit = (explicitColor || "").trim();
  if (cleanExplicit) return cleanExplicit;

  const normalized = normalizeAgendaCategory(category);
  if (!normalized) return DEFAULT_AGENDA_COLOR;

  return AGENDA_CATEGORY_COLORS[normalized] || DEFAULT_AGENDA_COLOR;
}
