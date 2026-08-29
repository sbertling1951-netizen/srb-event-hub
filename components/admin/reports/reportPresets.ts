export const REPORT_PRESETS_STORAGE_KEY = "fcoc-admin-report-presets";

export type ReportDataStatusFilter =
  | "all"
  | "pending"
  | "corrected"
  | "reviewed";

export type ReportPreset = {
  id: string;
  name: string;
  reportType: any;
  sortType: any;
  participantTypeFilter: any;
  dataStatusFilter: ReportDataStatusFilter;
};

export function normalizeReportDataStatusFilter(
  value: unknown,
): ReportDataStatusFilter {
  return ["all", "pending", "corrected", "reviewed"].includes(value as string)
    ? (value as ReportDataStatusFilter)
    : "all";
}

export function normalizeStoredReportPresets(
  presets: ReportPreset[],
): ReportPreset[] {
  return presets.map((preset) => ({
    ...preset,
    dataStatusFilter: normalizeReportDataStatusFilter(preset.dataStatusFilter),
  }));
}

export function loadStoredReportPresets(): ReportPreset[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = localStorage.getItem(REPORT_PRESETS_STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    const presets = parsed as ReportPreset[];
    const normalizedPresets = normalizeStoredReportPresets(presets);

    if (JSON.stringify(normalizedPresets) !== JSON.stringify(presets)) {
      localStorage.setItem(
        REPORT_PRESETS_STORAGE_KEY,
        JSON.stringify(normalizedPresets),
      );
    }

    return normalizedPresets;
  } catch {
    return [];
  }
}

export function saveStoredReportPresets(presets: ReportPreset[]): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(REPORT_PRESETS_STORAGE_KEY, JSON.stringify(presets));
}
