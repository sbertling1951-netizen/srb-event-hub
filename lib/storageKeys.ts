// ---------------------------------------------------------------------------
// Runtime storage / cookie / event identifier registry.
//
// Namespace migration — Stage A (Cohort N1). The canonical runtime prefix is
// `epicentrax-`. Tier 1–4 identity / session / Event-context / cross-tab
// signal / admin-permission-cache keys have been migrated to canonical names;
// their legacy `fcoc-` names live in LEGACY_STORAGE_KEYS for the compatibility
// window. New state writes canonical names only; consumers must use the
// helpers in lib/storageMigration.ts for canonical writes, legacy fallback /
// migrate-on-read, dual-key cleanup, and legacy event matching.
//
// Tier 5 preference / filter / handoff keys are canonicalized in Cohort N2.
// They are deliberately outside the N1 identity/session compatibility map.
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

  // --- Tier 5: canonical device-local preferences / handoffs (Cohort N2) ---
  adminEventsFilter: "epicentrax-admin-events-filter",
  adminReportPresets: "epicentrax-admin-report-presets",

  nearbyFavorites: "epicentrax-nearby-favorites",
  nearbySelectedAreaId: "epicentrax-nearby-selected-area-id",
  parkingFocusSite: "epicentrax-parking-focus-site",

  preRallyChecklistPrefix: "epicentrax-pre-rally-checklist",
  attendeeCommandCenterPrefs: "epicentrax-attendee-command-center-prefs",
  attendeeOpenEditId: "epicentrax-attendee-open-edit-id",

  announcementBannerDismissedPrefix: "epicentrax-announcement-banner-dismissed",
  announcementPopupSeenPrefix: "epicentrax-announcement-popup-seen",
} as const;

// Narrow migration sources for the few Tier 5 values where losing a
// browser-local value would disrupt an in-progress workflow. These are not
// part of LEGACY_STORAGE_KEYS: they carry no identity, session, authority, or
// cross-tab admission meaning and are read only by lib/tier5StorageMigration.
export const TIER5_MIGRATION_SOURCE_KEYS = {
  nearbyFavorites: "fcoc-nearby-favorites",
  preRallyChecklistPrefix: "fcoc-pre-rally-checklist",
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

// Event-scoped device-local preferences and import-run locators (Cohort N2).
export const EVENT_SCOPED_STORAGE_KEYS = {
  attendeeManagementView: (eventId: string) =>
    `epicentrax-attendee-management-view::${eventId}`,
  attendeeImportRun: (eventId: string) =>
    `epicentrax-attendee-import-run::${eventId}`,
  vendorImportRun: (eventId: string) =>
    `epicentrax-vendor-import-run::${eventId}`,
} as const;

// Narrow migration sources for governed import-run locators only. The IDs
// remain non-authoritative: each recovery path revalidates server authority.
export const TIER5_EVENT_SCOPED_MIGRATION_SOURCE_KEYS = {
  attendeeImportRun: (eventId: string) =>
    `fcoc-attendee-import-run::${eventId}`,
  vendorImportRun: (eventId: string) =>
    `fcoc-vendor-import-run::${eventId}`,
} as const;

// Vendor auth cookies. Server READS accept canonical then legacy. Stage B:
// cookie SET writes the canonical name only (no new fcoc-vendor-* cookie);
// DELETE still clears both name sets.
export const COOKIE_NAMES = {
  vendorAccessToken: "epicentrax-vendor-access-token",
  vendorSelectedVendorId: "epicentrax-vendor-selected-vendor-id",
} as const;

export const LEGACY_COOKIE_NAMES = {
  vendorAccessToken: "fcoc-vendor-access-token",
  vendorSelectedVendorId: "fcoc-vendor-selected-vendor-id",
} as const;

// Same-tab `window` CustomEvent. New writes dispatch the canonical name;
// listeners accept both names during the compatibility window.
export const APP_EVENT_NAMES = {
  adminEventUpdated: "epicentrax-admin-event-updated",
} as const;

export const LEGACY_APP_EVENT_NAMES = {
  adminEventUpdated: "fcoc-admin-event-updated",
} as const;
