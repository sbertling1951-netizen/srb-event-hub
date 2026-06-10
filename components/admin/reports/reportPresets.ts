export const REPORT_PRESETS_STORAGE_KEY = "fcoc-admin-report-presets";

export type ReportPreset = {
  id: string;
  name: string;
  reportType: any;
  sortType: any;
  participantTypeFilter: any;
  dataStatusFilter: any;
};

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

    return Array.isArray(parsed) ? (parsed as ReportPreset[]) : [];
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
