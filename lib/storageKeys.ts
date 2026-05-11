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

  activeEventChanged: "fcoc-active-event-changed",

  announcementBannerDismissedPrefix: "fcoc-announcement-banner-dismissed",

  announcementPopupSeenPrefix: "fcoc-announcement-popup-seen",
} as const;

export const APP_EVENT_NAMES = {
  adminEventUpdated: "fcoc-admin-event-updated",
  memberEventUpdated: "fcoc-member-event-updated",
} as const;
