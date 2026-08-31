import { createClient } from "@supabase/supabase-js";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";

import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";
import { COOKIE_NAMES } from "@/lib/storageKeys";

export const VENDOR_AUTH_COOKIE = COOKIE_NAMES.vendorAccessToken;
export const VENDOR_SELECTED_COOKIE = COOKIE_NAMES.vendorSelectedVendorId;

/**
 * A non-persistent client bound to the vendor's own already-validated
 * access token (never the service-role client). This is what lets a
 * SECURITY DEFINER RPC see the caller's real identity through auth.uid() --
 * the same low-level technique lib/server/authenticatedUserClient.ts uses
 * for the member/admin Bearer-token surfaces, applied here to the vendor
 * cookie's raw token directly. Diagnostic use only as of WR-19 Stage 2A;
 * it does not participate in the live Vendor Notices authorization
 * decision.
 */
export function createVendorTokenBoundClient(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return null;
  }

  return createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export type VendorAccessRow = {
  id: string;
  vendor_id: string;
  vendor_contact_id: string;
  person_id: string | null;
  auth_user_id: string | null;
  invitation_email: string;
  access_role: "vendor_admin" | "vendor_member";
  status: "pending" | "active" | "revoked" | "suspended";
  invited_for_event_id: string | null;
  invited_at: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
  vendor_contacts:
    | {
        id: string;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        mobile_phone: string | null;
        role_title: string | null;
        is_primary: boolean;
        status: string;
      }
    | {
        id: string;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        mobile_phone: string | null;
        role_title: string | null;
        is_primary: boolean;
        status: string;
      }[]
    | null;
  vendors:
    | {
        id: string;
        business_name: string | null;
        is_active: boolean | null;
      }
    | {
        id: string;
        business_name: string | null;
        is_active: boolean | null;
      }[]
    | null;
};

export type VendorAccessEntry = {
  accessId: string;
  vendorId: string;
  vendorName: string;
  vendorIsActive: boolean;
  vendorContactId: string;
  personId: string | null;
  role: "vendor_admin" | "vendor_member";
  status: "active";
  invitationEmail: string;
  invitedForEventId: string | null;
  invitedAt: string | null;
  acceptedAt: string | null;
  contact: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    mobilePhone: string | null;
    roleTitle: string | null;
    isPrimary: boolean;
    status: string;
  } | null;
};

export type VendorAccessContext = {
  authenticatedUserId: string;
  authenticatedUserEmail: string | null;
  permittedVendors: VendorAccessEntry[];
  selectedVendorId: string | null;
  selectedVendor: VendorAccessEntry | null;
  requiresVendorSelection: boolean;
};

export type VendorAccessResolution =
  | { ok: true; context: VendorAccessContext }
  | {
      ok: false;
      reason:
        | "missing_vendor_session"
        | "invalid_vendor_session"
        | "no_vendor_access";
      status: number;
      message: string;
    };

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] || null;
  }
  return value || null;
}

function cookieValue(
  cookies: ReadonlyRequestCookies,
  key: string,
): string | null {
  return cookies.get(key)?.value || null;
}

export async function resolveVendorAccessFromCookies(
  cookies: ReadonlyRequestCookies,
): Promise<VendorAccessResolution> {
  const supabaseAdmin = getSupabaseAdminClient();
  if (!supabaseAdmin) {
    return {
      ok: false,
      reason: "invalid_vendor_session",
      status: 500,
      message: "Vendor access service is not configured.",
    };
  }

  const accessToken = cookieValue(cookies, VENDOR_AUTH_COOKIE);
  if (!accessToken) {
    return {
      ok: false,
      reason: "missing_vendor_session",
      status: 401,
      message: "Vendor authentication is required.",
    };
  }

  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (authError || !user?.id) {
    return {
      ok: false,
      reason: "invalid_vendor_session",
      status: 401,
      message: "Vendor session is invalid or expired.",
    };
  }

  const { data, error } = await supabaseAdmin
    .from("vendor_org_access")
    .select(
      `
      id,
      vendor_id,
      vendor_contact_id,
      person_id,
      auth_user_id,
      invitation_email,
      access_role,
      status,
      invited_for_event_id,
      invited_at,
      accepted_at,
      revoked_at,
      vendor_contacts (
        id,
        first_name,
        last_name,
        email,
        mobile_phone,
        role_title,
        is_primary,
        status
      ),
      vendors (
        id,
        business_name,
        is_active
      )
    `,
    )
    .eq("auth_user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) {
    return {
      ok: false,
      reason: "invalid_vendor_session",
      status: 500,
      message: error.message,
    };
  }

  const rows = ((data || []) as VendorAccessRow[])
    .map((row): VendorAccessEntry | null => {
      const vendor = first(row.vendors);
      if (!vendor?.id) {
        return null;
      }
      const contact = first(row.vendor_contacts);

      return {
        accessId: row.id,
        vendorId: row.vendor_id,
        vendorName: vendor.business_name || "Vendor",
        vendorIsActive: vendor.is_active !== false,
        vendorContactId: row.vendor_contact_id,
        personId: row.person_id,
        role: row.access_role,
        status: "active",
        invitationEmail: row.invitation_email,
        invitedForEventId: row.invited_for_event_id,
        invitedAt: row.invited_at,
        acceptedAt: row.accepted_at,
        contact: contact
          ? {
              id: contact.id,
              firstName: contact.first_name,
              lastName: contact.last_name,
              email: contact.email,
              mobilePhone: contact.mobile_phone,
              roleTitle: contact.role_title,
              isPrimary: !!contact.is_primary,
              status: contact.status,
            }
          : null,
      };
    })
    .filter((entry): entry is VendorAccessEntry => !!entry);

  if (rows.length === 0) {
    return {
      ok: false,
      reason: "no_vendor_access",
      status: 403,
      message: "No active vendor access was found for this account.",
    };
  }

  const selectedFromCookie = cookieValue(cookies, VENDOR_SELECTED_COOKIE);
  let selectedVendor: VendorAccessEntry | null = null;

  if (selectedFromCookie) {
    selectedVendor = rows.find((row) => row.vendorId === selectedFromCookie) || null;
  }

  if (!selectedVendor && rows.length === 1) {
    selectedVendor = rows[0];
  }

  const context: VendorAccessContext = {
    authenticatedUserId: user.id,
    authenticatedUserEmail: user.email || null,
    permittedVendors: rows,
    selectedVendorId: selectedVendor?.vendorId || null,
    selectedVendor,
    requiresVendorSelection: rows.length > 1 && !selectedVendor,
  };

  return { ok: true, context };
}
