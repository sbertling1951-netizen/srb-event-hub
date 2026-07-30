// Single source of truth for vendor "Notice" types/labels, shared by the
// vendor workspace (write) and member-facing views (read-only display).
// Keep in sync with the status_type CHECK constraint in
// supabase/migrations/20260730160000_vendor_notice_terminology.sql.
//
// Backed by public.vendor_event_status: one row per (vendor_id, event_id).
// "Notice" is the product/UI name for that row; the underlying column is
// still status_type/message/expires_at/is_active (no schema rename).

export const VENDOR_NOTICE_TYPES = [
  "available_today",
  "show_special",
  "out_of_area",
  "closed",
  "other",
] as const;

export type VendorNoticeType = (typeof VENDOR_NOTICE_TYPES)[number];

export const VENDOR_NOTICE_META: Record<
  VendorNoticeType,
  { emoji: string; label: string }
> = {
  available_today: { emoji: "\u{1F7E2}", label: "Available Today" },
  show_special: { emoji: "⭐", label: "Show Special" },
  out_of_area: { emoji: "\u{1F4CD}", label: "Out of Area" },
  closed: { emoji: "\u{1F534}", label: "Closed" },
  other: { emoji: "\u{2139}\u{FE0F}", label: "Other" },
};

export function isVendorNoticeType(value: unknown): value is VendorNoticeType {
  return (
    typeof value === "string" &&
    (VENDOR_NOTICE_TYPES as readonly string[]).includes(value)
  );
}

export type VendorNotice = {
  status_type: VendorNoticeType;
  message: string | null;
  expires_at: string | null;
  is_active: boolean;
};

export function isVendorNoticeCurrentlyDisplayable(
  notice: Pick<VendorNotice, "is_active" | "expires_at"> | null,
): boolean {
  if (!notice || !notice.is_active) {
    return false;
  }
  if (!notice.expires_at) {
    return true;
  }
  return new Date(notice.expires_at).getTime() > Date.now();
}

// Returns a single display line (emoji + text), or null when the notice
// should not be shown (inactive, expired, or absent). Callers that need the
// raw row regardless of expiry (e.g. prefilling an edit form) should read
// the fields directly rather than calling this.
export function formatVendorNoticeDisplay(
  notice: VendorNotice | null,
): string | null {
  if (!isVendorNoticeCurrentlyDisplayable(notice)) {
    return null;
  }

  const meta = VENDOR_NOTICE_META[notice!.status_type] || VENDOR_NOTICE_META.other;
  const text = notice!.message?.trim() || meta.label;

  if (notice!.expires_at) {
    const until = new Date(notice!.expires_at).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    return `${meta.emoji} ${text} · Until ${until}`;
  }

  return `${meta.emoji} ${text}`;
}
