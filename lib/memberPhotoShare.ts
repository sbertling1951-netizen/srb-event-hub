export type PhotoShareResult = "shared" | "cancelled" | "fallback";

export interface ProtectedPhotoShareDependencies {
  getAccessToken: () => Promise<string | null>;
  fetch: typeof globalThis.fetch;
  File: typeof globalThis.File;
  canShare: (data: ShareData) => boolean;
  share: (data: ShareData) => Promise<void>;
}

export async function shareProtectedPhotoFile(
  photoId: string,
  fileName: string,
  dependencies: ProtectedPhotoShareDependencies,
): Promise<PhotoShareResult> {
  const accessToken = await dependencies.getAccessToken();
  if (!accessToken) {
    return "fallback";
  }

  try {
    const response = await dependencies.fetch(
      `/api/photos/original?photoId=${photoId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      return "fallback";
    }

    const file = new dependencies.File([await response.blob()], fileName, {
      type: response.headers.get("content-type") || "image/jpeg",
    });
    if (!dependencies.canShare({ files: [file] })) {
      return "fallback";
    }

    try {
      await dependencies.share({ files: [file], title: "Event photo" });
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return "cancelled";
      }
      return "fallback";
    }
  } catch {
    return "fallback";
  }
}