import { NextResponse } from "next/server";

import type { AuthenticatedRequestCredential } from "@/lib/server/authenticationBoundary";

export type PhotoOriginalAuthResolution =
  | { state: "authenticated"; credential: unknown }
  | { state: "unauthenticated" }
  | { state: "internal_error" };

export type PhotoOriginalUserClient = {
  rpc: (
    name: string,
    parameters: Record<string, unknown>,
  ) => {
    maybeSingle: () => Promise<{
      data: unknown;
      error: { code?: string; message?: string } | null;
    }>;
  };
};

export type PhotoOriginalAdminClient = {
  storage: {
    from: (bucket: string) => {
      download: (
        path: string,
      ) => Promise<{ data: Blob | null; error: { message?: string } | null }>;
    };
  };
};

export type PhotoOriginalDependencies = {
  resolveAuthenticatedRequest: (
    headers: Headers,
  ) => Promise<PhotoOriginalAuthResolution>;
  createAuthenticatedUserClient: (
    credential: unknown,
  ) => PhotoOriginalUserClient | null;
  getSupabaseAdminClient: () => PhotoOriginalAdminClient | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function unavailableResponse() {
  return NextResponse.json({ error: "photo_unavailable" }, { status: 404 });
}

export function createPhotoOriginalHandler(
  dependencies: PhotoOriginalDependencies,
) {
  return async function photoOriginalHandler(request: Request) {
    const photoId = new URL(request.url).searchParams.get("photoId");
    if (!isUuid(photoId)) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    const authResolution = await dependencies.resolveAuthenticatedRequest(
      request.headers,
    );
    if (authResolution.state === "internal_error") {
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
    if (authResolution.state === "unauthenticated") {
      return unavailableResponse();
    }

    const supabase = dependencies.createAuthenticatedUserClient(
      authResolution.credential,
    );
    const admin = dependencies.getSupabaseAdminClient();
    if (!supabase || !admin) {
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }

    const { data: pathRow, error: pathError } = await supabase
      .rpc("read_event_photo_original_path", { p_photo_id: photoId })
      .maybeSingle();

    if (pathError) {
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }

    const storagePath =
      pathRow && typeof pathRow === "object" && "storage_path" in pathRow
        ? pathRow.storage_path
        : null;

    if (typeof storagePath !== "string" || !storagePath) {
      return unavailableResponse();
    }

    const { data: object, error: downloadError } = await admin.storage
      .from("event-photos")
      .download(storagePath);

    if (downloadError || !object) {
      return NextResponse.json({ error: "photo_download_failed" }, { status: 502 });
    }

    return new Response(object, {
      status: 200,
      headers: {
        "Content-Type": object.type || "application/octet-stream",
        "Content-Disposition": `attachment; filename="event-photo-${photoId}"`,
        "Cache-Control": "no-store",
      },
    });
  };
}