import { NextResponse } from "next/server";

export type PhotoUploadAuthResolution =
  | { state: "authenticated"; credential: unknown }
  | { state: "unauthenticated" }
  | { state: "internal_error" };

export type PhotoUploadClient = {
  rpc: (
    name: string,
    parameters: Record<string, unknown>,
  ) => {
    maybeSingle: () => Promise<{
      data: unknown;
      error: { code?: string; message?: string } | null;
    }>;
  };
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: ArrayBuffer,
        options: { contentType: string; upsert: boolean },
      ) => Promise<{ error: { message?: string } | null }>;
      remove: (
        paths: string[],
      ) => Promise<{ error: { name?: string; message?: string } | null }>;
    };
  };
};

export type PhotoUploadDependencies = {
  resolveAuthenticatedRequest: (
    headers: Headers,
  ) => Promise<PhotoUploadAuthResolution>;
  createAuthenticatedUserClient: (
    credential: unknown,
  ) => PhotoUploadClient | null;
  randomUUID: () => string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function extensionForContentType(contentType: string): string {
  switch (contentType.toLowerCase()) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    default:
      return "jpg";
  }
}

export function createPhotoUploadHandler(
  dependencies: PhotoUploadDependencies,
) {
  return async function photoUploadHandler(request: Request) {
    const authResolution = await dependencies.resolveAuthenticatedRequest(
      request.headers,
    );
    if (authResolution.state === "internal_error") {
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
    if (authResolution.state === "unauthenticated") {
      return NextResponse.json({ error: "photo_upload_unavailable" }, { status: 404 });
    }

    const formData = await request.formData();
    const eventId = formData.get("eventId");
    const attendeeId = formData.get("attendeeId");
    const caption = formData.get("caption");
    const file = formData.get("file");

    if (
      !isUuid(eventId) ||
      !isUuid(attendeeId) ||
      !(file instanceof File) ||
      !file.type.startsWith("image/") ||
      (caption !== null && typeof caption !== "string")
    ) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    const supabase = dependencies.createAuthenticatedUserClient(
      authResolution.credential,
    );
    if (!supabase) {
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }

    const { data: contributorData, error: contributorError } = await supabase
      .rpc("resolve_event_photo_contributor", {
        p_event_id: eventId,
        p_attendee_id: attendeeId,
      })
      .maybeSingle();
    const contributor = contributorData as {
      contributor_person_id: string | null;
    } | null;

    if (contributorError) {
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
    if (!contributor?.contributor_person_id) {
      return NextResponse.json({ error: "photo_upload_unavailable" }, { status: 404 });
    }

    const storagePath = `${eventId}/${attendeeId}/${dependencies.randomUUID()}.${extensionForContentType(file.type)}`;
    const { error: uploadError } = await supabase.storage
      .from("event-photos")
      .upload(storagePath, await file.arrayBuffer(), {
        contentType: file.type,
        upsert: false,
      });
    if (uploadError) {
      return NextResponse.json({ error: "photo_upload_failed" }, { status: 502 });
    }

    const { data: finalizedPhoto, error: finalizeError } = await supabase
      .rpc("finalize_event_photo_upload", {
        p_event_id: eventId,
        p_attendee_id: attendeeId,
        p_storage_path: storagePath,
        p_member_caption:
          typeof caption === "string" ? caption.trim() || null : null,
      })
      .maybeSingle();
    const photo = finalizedPhoto as { photo_id?: string } | null;

    if (finalizeError || (finalizedPhoto !== null && !photo?.photo_id)) {
      return NextResponse.json(
        {
          error: "photo_upload_pending_finalization",
          message: "Refresh My Uploads to check whether the photo was saved.",
        },
        { status: 409 },
      );
    }

    if (!photo?.photo_id) {
      const { error: cleanupError } = await supabase.storage
        .from("event-photos")
        .remove([storagePath]);
      if (cleanupError) {
        return NextResponse.json(
          {
            error: "photo_upload_pending_finalization",
            message: "Refresh My Uploads to check whether the photo was saved.",
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "photo_upload_rejected" }, { status: 422 });
    }

    return NextResponse.json({ id: photo.photo_id });
  };
}
