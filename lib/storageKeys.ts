export const STORAGE_KEYS = {
  memberSession: "fcoc-member-session",
  adminAccess: "fcoc-admin-access",

  adminAccessCache: "fcoc-admin-access-cache",
  adminAccessCacheTime: "fcoc-admin-access-cache-time",

  adminEventContext: "fcoc-admin-event-context",
  adminEventChanged: "fcoc-admin-event-changed",

  userMode: "fcoc-user-mode",
  userModeChanged: "fcoc-user-mode-changed",

  memberEventContext: "fcoc-member-event-context",
  memberEventChanged: "fcoc-member-event-changed",

  memberAttendeeId: "fcoc-member-attendee-id",
  memberEntryId: "fcoc-member-entry-id",
  memberEmail: "fcoc-member-email",
  memberHasArrived: "fcoc-member-has-arrived",
  memberName: "fcoc-member-name",
  // Account-origin marker: written only by the authenticated Account
  // login path (finishMemberLogin), and explicitly removed by the
  // Temporary Event Access path. Its presence distinguishes an
  // account-origin MemberSession from a Temporary Event Access one.
  memberAuthUserId: "fcoc-member-auth-user-id",

  activeEventChanged: "fcoc-active-event-changed",

  adminEmail: "fcoc-admin-email",
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

export const EVENT_SCOPED_STORAGE_KEYS = {
  attendeeManagementView: (eventId: string) =>
    `fcoc-attendee-management-view::${eventId}`,
  attendeeImportRun: (eventId: string) =>
    `fcoc-attendee-import-run::${eventId}`,
  vendorImportRun: (eventId: string) =>
    `fcoc-vendor-import-run::${eventId}`,
} as const;

export const COOKIE_NAMES = {
  vendorAccessToken: "fcoc-vendor-access-token",
  vendorSelectedVendorId: "fcoc-vendor-selected-vendor-id",
} as const;

export const APP_EVENT_NAMES = {
  adminEventUpdated: "fcoc-admin-event-updated",
  memberEventUpdated: "fcoc-member-event-updated",
} as const;
