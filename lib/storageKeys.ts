// ---------------------------------------------------------------------------
// Runtime storage / cookie / event identifier registry.
//
// Namespace migration — Stage A (Cohort N1). The canonical runtime prefix is
// `epicentrax-`. Tier 1–4 identity / session / Event-context / cross-tab
// signal / admin-permission-cache keys have been migrated to canonical names;
// their legacy `fcoc-` names live in LEGACY_STORAGE_KEYS for the Stage A
// compatibility window. Consumers must NOT read/write these keys directly --
// use the helpers in lib/storageMigration.ts (read-canonical-then-legacy +
// migrate-on-read, dual-write, dual-remove, dual-signal, dual-match).
//
// Tier 5 preference / filter / handoff keys are intentionally NOT migrated in
// N1 (Cohort N2). They keep their `fcoc-` names and have no LEGACY_ entry.
// ---------------------------------------------------------------------------

export const STORAGE_KEYS = {
  // --- N1: canonical (epicentrax-*), Stage A dual-name compatibility ---
  memberSession: "epicentrax-member-session",
  memberAuthUserId: "epicentrax-member-auth-user-id",
  memberEventContext: "epicentrax-member-event-context",
  memberEventChanged: "epicentrax-member-event-changed",
  memberHasArrived: "epicentrax-member-has-arrived",
  userMode: "epicentrax-user-mode",
  userModeChanged: "epicentrax-user-mode-changed",
  adminEventContext: "epicentrax-admin-event-context",
  adminEventChanged: "epicentrax-admin-event-changed",
  adminAccessCache: "epicentrax-admin-access-cache",
  adminAccessCacheTime: "epicentrax-admin-access-cache-time",

  // --- Tier 5: not yet migrated (Cohort N2) ---
  adminEventsFilter: "fcoc-admin-events-filter",
  adminReportPresets: "fcoc-admin-report-presets",

  nearbyFavorites: "fcoc-nearby-favorites",
  nearbySelectedAreaId: "fcoc-nearby-selected-area-id",
  parkingFocusSite: "fcoc-parking-focus-site",

  preRallyChecklistPrefix: "fcoc-pre-rally-checklist",
  attendeeCommandCenterPrefs: "fcoc-attendee-command-center-prefs",
  attendeeOpenEditId: "fcoc-attendee-open-edit-id",

  announcementBannerDismissedPrefix: "fcoc-announcement-banner-dismissed",
  announcementPopupSeenPrefix: "fcoc-announcement-popup-seen",
} as const;

// Legacy `fcoc-` names for the N1-migrated keys ONLY. Property names match
// STORAGE_KEYS for the migrated subset so lib/storageMigration.ts can pair
// them 1:1. Retired in Stage D.
export const LEGACY_STORAGE_KEYS = {
  memberSession: "fcoc-member-session",
  memberAuthUserId: "fcoc-member-auth-user-id",
  memberEventContext: "fcoc-member-event-context",
  memberEventChanged: "fcoc-member-event-changed",
  memberHasArrived: "fcoc-member-has-arrived",
  userMode: "fcoc-user-mode",
  userModeChanged: "fcoc-user-mode-changed",
  adminEventContext: "fcoc-admin-event-context",
  adminEventChanged: "fcoc-admin-event-changed",
  adminAccessCache: "fcoc-admin-access-cache",
  adminAccessCacheTime: "fcoc-admin-access-cache-time",
} as const;

// Write-only browser state with ZERO readers (verified). Deliberately
// retired in N1 -- the writes are removed. No canonical replacement is
// created. Logout still sweeps the stale legacy value from older browsers
// during the compatibility window (see clearKnownAppStorageKeys).
export const RETIRED_LEGACY_STORAGE_KEYS = [
  "fcoc-admin-access", // was STORAGE_KEYS.adminAccess (sessionStorage, never read)
  "fcoc-admin-email", // was STORAGE_KEYS.adminEmail (never read)
] as const;

// Not migrated in N1 (Cohort N2).
export const EVENT_SCOPED_STORAGE_KEYS = {
  attendeeManagementView: (eventId: string) =>
    `fcoc-attendee-management-view::${eventId}`,
  attendeeImportRun: (eventId: string) =>
    `fcoc-attendee-import-run::${eventId}`,
  vendorImportRun: (eventId: string) =>
    `fcoc-vendor-import-run::${eventId}`,
} as const;

// Vendor auth cookies. Stage A: server READS accept canonical then legacy;
// cookie SET behaviour is unchanged (legacy name); DELETE clears both.
export const COOKIE_NAMES = {
  vendorAccessToken: "epicentrax-vendor-access-token",
  vendorSelectedVendorId: "epicentrax-vendor-selected-vendor-id",
} as const;

export const LEGACY_COOKIE_NAMES = {
  vendorAccessToken: "fcoc-vendor-access-token",
  vendorSelectedVendorId: "fcoc-vendor-selected-vendor-id",
} as const;

// Same-tab `window` CustomEvent. Stage A: dispatch both names, listen for
// both (covers a persisted layout provider still running pre-Stage-A code
// across a client-side navigation during the deploy window).
export const APP_EVENT_NAMES = {
  adminEventUpdated: "epicentrax-admin-event-updated",
} as const;

export const LEGACY_APP_EVENT_NAMES = {
  adminEventUpdated: "fcoc-admin-event-updated",
} as const;
