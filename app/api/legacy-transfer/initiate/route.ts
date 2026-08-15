import { createHash, randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { validateTransferDestination } from "@/lib/legacyTransferDestination";
import { resolveAdminActorFromBearer } from "@/lib/server/adminAuthz";
import { resolveAuthenticatedRequest } from "@/lib/server/authenticationBoundary";
import { resolveAuthenticatedAccountPerson } from "@/lib/server/personResolutionBridge";
import { getSupabaseAdminClient } from "@/lib/server/supabaseAdmin";
import { resolveVendorAccessFromCookies } from "@/lib/server/vendorAccess";

// Legacy Login Transfer -- initiation boundary (Stage 3B).
//
// Verified live 2026-08-15 (DNS A/AAAA resolution, TLS certificate subject
// and SAN, and a live HTTPS response serving this exact application) as
// the canonical production hostname. Fixed, server-owned -- never derived
// from any request header (Host, X-Forwarded-Host) or client-supplied
// value.
const CANONICAL_HOST = "epicentrax.com";

type RoleClass = "admin" | "member" | "vendor";

type ResolvedIdentity = {
  authUserId: string;
  personId: string | null;
  roleClass: RoleClass;
};

function hashMetadata(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return createHash("md5").update(value).digest("hex");
}

function requestIp(req: NextRequest): string | null {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }
  return req.headers.get("x-real-ip")?.trim() || null;
}

/**
 * Resolves the caller's identity from its own already-validated legacy
 * session -- never from anything the request body claims. Bearer
 * (Admin/Member) is checked first, matching the repaired Stage 3A
 * architecture's chosen precedence; the vendor cookie is checked only if
 * no valid Bearer-authenticated account was found. Composes only
 * existing, already-governed helpers -- this function is transport glue,
 * not a new role-authority layer.
 */
async function resolveLegacyIdentity(
  req: NextRequest,
): Promise<ResolvedIdentity | null> {
  const authorizationHeader = req.headers.get("authorization");

  if (authorizationHeader) {
    const authenticated = await resolveAuthenticatedRequest(req.headers);

    if (authenticated.state === "authenticated") {
      const [adminResult, personResolution] = await Promise.all([
        resolveAdminActorFromBearer(authorizationHeader),
        resolveAuthenticatedAccountPerson(authenticated),
      ]);

      const personId =
        personResolution.state === "resolved" ? personResolution.personId : null;

      return {
        authUserId: authenticated.account.accountId,
        personId,
        roleClass: adminResult.admin ? "admin" : "member",
      };
    }
  }

  const cookieStore = await cookies();
  const vendorResolution = await resolveVendorAccessFromCookies(cookieStore);

  if (vendorResolution.ok) {
    return {
      authUserId: vendorResolution.context.authenticatedUserId,
      personId: vendorResolution.context.selectedVendor?.personId ?? null,
      roleClass: "vendor",
    };
  }

  return null;
}

function jsonNoStore(body: object) {
  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  const fail = () => jsonNoStore({ ok: false });

  try {
    let body: { destination?: unknown } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const identity = await resolveLegacyIdentity(req);
    if (!identity) {
      return fail();
    }

    // Stage 2 is the single canonical destination authority, called
    // exactly once, here, before the value is ever stored.
    const rawDestination =
      typeof body.destination === "string" ? body.destination : null;
    const canonicalDestination = validateTransferDestination(rawDestination);

    const supabaseAdmin = getSupabaseAdminClient();
    if (!supabaseAdmin) {
      return fail();
    }

    // The email used for the Supabase re-authentication credential comes
    // strictly from the already-server-derived auth_user_id -- never from
    // the request body.
    const { data: userData, error: userError } =
      await supabaseAdmin.auth.admin.getUserById(identity.authUserId);
    const email = userData?.user?.email;

    if (userError || !email) {
      return fail();
    }

    // generateLink() only generates the credential -- it never sends an
    // email or SMS itself (confirmed against the installed SDK's own
    // documentation; see Stage 3A repair report). No signInWithOtp,
    // inviteUserByEmail, or other delivery-triggering call is made here.
    const { data: linkData, error: linkError } =
      await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });

    if (linkError || !linkData?.properties?.hashed_token) {
      return fail();
    }

    // Raw token: generated here, hashed once for storage, never persisted
    // or logged, and used only to construct the fragment URL below.
    const rawToken = randomBytes(32).toString("base64url");
    const transferTokenHash = createHash("sha256").update(rawToken).digest("hex");

    const { data: createData, error: createError } = await supabaseAdmin.rpc(
      "create_legacy_login_transfer",
      {
        p_auth_user_id: identity.authUserId,
        p_person_id: identity.personId,
        p_role_class: identity.roleClass,
        p_supabase_hashed_token: linkData.properties.hashed_token,
        p_transfer_token_hash: transferTokenHash,
        p_destination_path: canonicalDestination,
        p_request_ip_hash: hashMetadata(requestIp(req)),
        p_user_agent_hash: hashMetadata(req.headers.get("user-agent")),
      },
    );

    if (createError || !Array.isArray(createData) || createData.length !== 1) {
      return fail();
    }

    const transferUrl = `https://${CANONICAL_HOST}/auth/legacy-transfer#t=${rawToken}`;
    return jsonNoStore({ ok: true, transfer_url: transferUrl });
  } catch (err) {
    console.error(
      "legacy-transfer initiate failed:",
      err instanceof Error ? err.message : "unknown error",
    );
    return fail();
  }
}
