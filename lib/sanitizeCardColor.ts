const RESERVED_GREEN_COLORS = new Set([
  "green",
  "#f0fdf4",
  "#dcfce7",
  "#bbf7d0",
  "#86efac",
  "#4ade80",
  "#22c55e",
  "#16a34a",
  "#15803d",
  "#166534",
  "rgb(240, 253, 244)",
  "rgb(220, 252, 231)",
  "rgb(187, 247, 208)",
  "rgb(134, 239, 172)",
  "rgb(74, 222, 128)",
  "rgb(34, 197, 94)",
  "rgb(22, 163, 74)",
]);

export function sanitizeCardColor(
  color: string | null | undefined,
  fallback = "#f8fafc",
) {
  const value = (color || "").trim().toLowerCase();

  if (!value || RESERVED_GREEN_COLORS.has(value)) {
    return fallback;
  }

  return color || fallback;
}
