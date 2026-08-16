import { supabase } from "@/lib/supabase";

export const ADMIN_PHOTO_METADATA_TTL_MS = 30_000;
export const ADMIN_PHOTO_SIGNED_URL_TTL_SECONDS = 60 * 60;
export const ADMIN_PHOTO_SIGNED_URL_RENEWAL_BUFFER_MS = 5 * 60 * 1000;

export type AdminPhotoMetadata = {
  id: string;
  attendee_id: string | null;
  storage_path: string;
  photo_status: "pending" | "approved" | "rejected";
  member_caption: string | null;
  admin_caption: string | null;
  show_caption: boolean;
  is_featured: boolean;
  featured_level: number;
  uploaded_at: string;
};

export type AdminPhotoSnapshot = {
  photos: AdminPhotoMetadata[];
  memberNamesByAttendeeId: Map<string, string>;
};

export type AdminPhotoTransformProfile =
  | "moderation-thumbnail-160"
  | "library-thumbnail-360x240"
  | "review-800";

type CacheScope = { userId: string; eventId: string };
type SnapshotEntry = { value: AdminPhotoSnapshot; freshUntil: number };
type SignedUrlEntry = { value: string; expiresAt: number };

function scopeKey({ userId, eventId }: CacheScope) {
  return `${userId}:${eventId}`;
}

function signedUrlKey(
  scope: CacheScope,
  storagePath: string,
  profile: AdminPhotoTransformProfile,
) {
  return `${scopeKey(scope)}:${profile}:${storagePath}`;
}

export function createAdminPhotoCache(now = () => Date.now()) {
  const snapshots = new Map<string, SnapshotEntry>();
  const snapshotRequests = new Map<string, Promise<AdminPhotoSnapshot>>();
  const snapshotGenerations = new Map<string, number>();
  const signedUrls = new Map<string, SignedUrlEntry>();
  const signedUrlRequests = new Map<string, Promise<string>>();
  const signedUrlGenerations = new Map<string, number>();

  return {
    async getSnapshot(
      scope: CacheScope,
      load: () => Promise<AdminPhotoSnapshot>,
    ) {
      const key = scopeKey(scope);
      const cached = snapshots.get(key);
      if (cached && cached.freshUntil > now()) {
        return cached.value;
      }

      const existingRequest = snapshotRequests.get(key);
      if (existingRequest) {
        return existingRequest;
      }

      const generation = (snapshotGenerations.get(key) || 0) + 1;
      snapshotGenerations.set(key, generation);
      const request = load()
        .then((value) => {
          if (snapshotGenerations.get(key) === generation) {
            snapshots.set(key, {
              value,
              freshUntil: now() + ADMIN_PHOTO_METADATA_TTL_MS,
            });
          }
          return value;
        })
        .finally(() => {
          snapshotRequests.delete(key);
        });
      snapshotRequests.set(key, request);
      return request;
    },

    async getSignedUrl(
      scope: CacheScope,
      storagePath: string,
      profile: AdminPhotoTransformProfile,
      create: () => Promise<string>,
    ) {
      const key = signedUrlKey(scope, storagePath, profile);
      const cached = signedUrls.get(key);
      if (
        cached &&
        cached.expiresAt - now() > ADMIN_PHOTO_SIGNED_URL_RENEWAL_BUFFER_MS
      ) {
        return cached.value;
      }

      const existingRequest = signedUrlRequests.get(key);
      if (existingRequest) {
        return existingRequest;
      }

      const generation = (signedUrlGenerations.get(key) || 0) + 1;
      signedUrlGenerations.set(key, generation);
      const request = create()
        .then((value) => {
          if (signedUrlGenerations.get(key) === generation) {
            signedUrls.set(key, {
              value,
              expiresAt: now() + ADMIN_PHOTO_SIGNED_URL_TTL_SECONDS * 1000,
            });
          }
          return value;
        })
        .finally(() => {
          signedUrlRequests.delete(key);
        });
      signedUrlRequests.set(key, request);
      return request;
    },

    invalidate(scope: CacheScope) {
      const prefix = `${scopeKey(scope)}:`;
      snapshots.delete(scopeKey(scope));
      snapshotRequests.delete(scopeKey(scope));
      snapshotGenerations.set(
        scopeKey(scope),
        (snapshotGenerations.get(scopeKey(scope)) || 0) + 1,
      );
      for (const key of signedUrls.keys()) {
        if (key.startsWith(prefix)) {signedUrls.delete(key);}
      }
      for (const key of signedUrlRequests.keys()) {
        if (key.startsWith(prefix)) {
          signedUrlRequests.delete(key);
          signedUrlGenerations.set(key, (signedUrlGenerations.get(key) || 0) + 1);
        }
      }
    },

    clearUser(userId: string) {
      const prefix = `${userId}:`;
      for (const key of snapshots.keys()) {
        if (key.startsWith(prefix)) {
          snapshots.delete(key);
          snapshotGenerations.set(key, (snapshotGenerations.get(key) || 0) + 1);
        }
      }
      for (const key of signedUrls.keys()) {
        if (key.startsWith(prefix)) {
          signedUrls.delete(key);
          signedUrlGenerations.set(key, (signedUrlGenerations.get(key) || 0) + 1);
        }
      }
      for (const key of snapshotRequests.keys()) {
        if (key.startsWith(prefix)) {
          snapshotRequests.delete(key);
          snapshotGenerations.set(key, (snapshotGenerations.get(key) || 0) + 1);
        }
      }
      for (const key of signedUrlRequests.keys()) {
        if (key.startsWith(prefix)) {
          signedUrlRequests.delete(key);
          signedUrlGenerations.set(key, (signedUrlGenerations.get(key) || 0) + 1);
        }
      }
    },
  };
}

const adminPhotoCache = createAdminPhotoCache();

async function fetchAdminPhotoSnapshot(eventId: string): Promise<AdminPhotoSnapshot> {
  const { data, error } = await supabase
    .from("event_photos")
    .select(
      "id,attendee_id,storage_path,photo_status,member_caption,admin_caption,show_caption,is_featured,featured_level,uploaded_at",
    )
    .eq("event_id", eventId)
    .order("uploaded_at", { ascending: false });

  if (error) {
    throw error;
  }

  const photos = (data || []) as AdminPhotoMetadata[];
  const attendeeIds = Array.from(
    new Set(
      photos
        .filter((photo) => photo.photo_status === "pending")
        .map((photo) => photo.attendee_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const memberNamesByAttendeeId = new Map<string, string>();

  if (attendeeIds.length > 0) {
    const { data: attendees, error: attendeeError } = await supabase
      .from("attendees")
      .select("id, nickname, pilot_first, pilot_last")
      .in("id", attendeeIds);

    if (attendeeError) {
      console.error("load photo member names error:", attendeeError);
    } else {
      for (const attendee of attendees || []) {
        const preferredFirst =
          attendee.nickname?.trim() || attendee.pilot_first?.trim() || "";
        const lastName = attendee.pilot_last?.trim() || "";
        const name = [preferredFirst, lastName].filter(Boolean).join(" ");
        if (name) {memberNamesByAttendeeId.set(attendee.id, name);}
      }
    }
  }

  return { photos, memberNamesByAttendeeId };
}

export function loadAdminPhotoSnapshot(scope: CacheScope) {
  return adminPhotoCache.getSnapshot(scope, () =>
    fetchAdminPhotoSnapshot(scope.eventId),
  );
}

export async function getAdminPhotoSignedUrl(
  scope: CacheScope,
  storagePath: string,
  profile: AdminPhotoTransformProfile,
) {
  return adminPhotoCache.getSignedUrl(scope, storagePath, profile, async () => {
    const options =
      profile === "moderation-thumbnail-160"
        ? { transform: { width: 160, height: 160, resize: "cover" as const } }
        : profile === "library-thumbnail-360x240"
          ? { transform: { width: 360, height: 240, resize: "cover" as const } }
          : { transform: { width: 800, resize: "contain" as const } };
    const { data, error } = await supabase.storage
      .from("event-photos")
      .createSignedUrl(storagePath, ADMIN_PHOTO_SIGNED_URL_TTL_SECONDS, options);
    if (error || !data?.signedUrl) {throw error || new Error("Unable to sign photo URL.");}
    return data.signedUrl;
  });
}

export function invalidateAdminPhotoCache(scope: CacheScope) {
  adminPhotoCache.invalidate(scope);
}

export function clearAdminPhotoCacheForUser(userId: string) {
  adminPhotoCache.clearUser(userId);
}
