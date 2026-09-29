"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  sessionId: string;
  contentRefId: string;
  slot: "current" | "next";
  caption: string | null;
  photographerName: string | null;
};

// One mounted image per authorized photo, keyed by session and photo in the
// viewer. Moving next -> current keeps the decoded image. This is a bounded
// in-memory display buffer, not an HTTP cache or a source of slide order.
export default function PresentationSlideImage({
  sessionId,
  contentRefId,
  slot,
  caption,
  photographerName,
}: Props) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const slotRef = useRef(slot);

  useEffect(() => {
    slotRef.current = slot;
  }, [slot]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    async function loadImage() {
      try {
        const response = await fetch(
          `/api/slideshow/presentation-image?session=${sessionId}&slot=${slotRef.current}`,
          { cache: "no-store", signal: controller.signal },
        );

        // The slot can advance while this request is in flight. Only trust
        // the identity returned by the governed resolver, never the requested
        // slot or a client-supplied photo id as proof of the returned bytes.
        if (
          !response.ok ||
          response.headers.get("X-Presentation-Content-Ref") !== contentRefId
        ) {
          throw new Error("Presentation image unavailable");
        }

        const blob = await response.blob();
        if (cancelled) { return; }
        objectUrl = URL.createObjectURL(blob);
        const decodedImage = new Image();
        decodedImage.src = objectUrl;
        await decodedImage.decode();
        if (!cancelled) { setImageSrc(objectUrl); }
      } catch {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
        // Retry delivery only; polling remains the sole source of position.
        // A failed next-slot fetch retries as current if it has since advanced.
        if (!cancelled) { retryTimer = setTimeout(() => void loadImage(), 1000); }
      }
    }

    void loadImage();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(retryTimer);
      if (objectUrl) { URL.revokeObjectURL(objectUrl); }
    };
  }, [sessionId, contentRefId]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: slot === "current" ? "flex" : "none",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {imageSrc ? (
        <>
          <img
            src={imageSrc}
            alt={slot === "current" ? "Slideshow" : ""}
            style={{ maxWidth: "100vw", maxHeight: "98vh", objectFit: "contain" }}
          />
          {caption && slot === "current" ? (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                background: "rgba(0,0,0,0.55)",
                color: "white",
                padding: "16px 24px",
                fontSize: 24,
                fontWeight: 500,
                textAlign: "center",
                textShadow: "0 1px 2px rgba(0,0,0,0.9)",
                pointerEvents: "none",
              }}
            >
              <div>{caption}</div>
              {photographerName ? (
                <div style={{ marginTop: 8, fontSize: 18, opacity: 0.85 }}>
                  Photo by {photographerName}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : slot === "current" ? (
        <div style={{ fontSize: 24 }}>Waiting for the next slide...</div>
      ) : null}
    </div>
  );
}
