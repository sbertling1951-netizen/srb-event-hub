import "server-only";

import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";

import {
  createVendorTokenBoundClient,
  readVendorAuthCookie,
} from "@/lib/server/vendorAccess";

export type VendorNoticesShadowOperation = "update" | "delete";
export type VendorNoticesShadowAuthorizationResult = "allowed" | "denied";

type RecordVendorNoticesAuthorityShadowParams = {
  cookies: ReadonlyRequestCookies;
  vendorId: string;
  eventId: string;
  operation: VendorNoticesShadowOperation;
  currentAuthorizationResult: VendorNoticesShadowAuthorizationResult;
};

/**
 * WR-19 Stage 2A: diagnostic-only. Computes and records, through the
 * governed evaluate_vendor_notices_authority_shadow RPC, whether the future
 * Assignment-based policy would allow this Vendor Notices action -- purely
 * for later comparison against the existing (authoritative) result.
 *
 * This function must never influence the live authorization decision or
 * HTTP response: it swallows every failure internally (a missing cookie, a
 * misconfigured client, an RPC error, a timeout) and never throws. Callers
 * intentionally do not read a return value from this function because the
 * shadow result has no live effect and the RPC's own result is never
 * exposed to the client.
 */
export async function recordVendorNoticesAuthorityShadow(
  params: RecordVendorNoticesAuthorityShadowParams,
): Promise<void> {
  try {
    const accessToken = readVendorAuthCookie(params.cookies);
    if (!accessToken) {
      return;
    }

    const supabase = createVendorTokenBoundClient(accessToken);
    if (!supabase) {
      return;
    }

    const { error } = await supabase.rpc(
      "evaluate_vendor_notices_authority_shadow",
      {
        p_vendor_id: params.vendorId,
        p_event_id: params.eventId,
        p_operation: params.operation,
        p_current_authorization_result: params.currentAuthorizationResult,
      },
    );

    if (error) {
      console.error(
        "Vendor Notices Assignment shadow evaluation RPC error:",
        error.message,
      );
    }
  } catch (err) {
    console.error("Vendor Notices Assignment shadow evaluation failed:", err);
  }
}
