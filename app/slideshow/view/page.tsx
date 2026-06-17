"use client";

import { useEffect, useLayoutEffect, useState, useRef } from "react";

import { supabase } from "@/lib/supabase";

export default function SlideshowViewPage() {
  const [eventName, setEventName] = useState("No Event Selected");
  const [eventId, setEventId] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready to load approved photos");

  type SlidePhoto = {
    url: string;
    member_caption: string | null;
    admin_caption: string | null;
    show_caption: boolean;
  };

  const [photos, setPhotos] = useState<SlidePhoto[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imagesReady, setImagesReady] = useState(false);
  const [preloadedCount, setPreloadedCount] = useState(0);
  const [totalSlides, setTotalSlides] = useState(0);
  const [showCursor, setShowCursor] = useState(true);
  const cursorTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    document.body.classList.add("slideshow-view-mode");

    return () => {
      document.body.classList.remove("slideshow-view-mode");
    };
  }, []);

  useEffect(() => {
    const resetCursorTimer = () => {
      setShowCursor(true);

      if (cursorTimerRef.current) {
        window.clearTimeout(cursorTimerRef.current);
      }

      cursorTimerRef.current = window.setTimeout(() => {
        setShowCursor(false);
      }, 3000);
    };

    resetCursorTimer();

    window.addEventListener("mousemove", resetCursorTimer);
    window.addEventListener("mousedown", resetCursorTimer);
    window.addEventListener("touchstart", resetCursorTimer);

    return () => {
      window.removeEventListener("mousemove", resetCursorTimer);
      window.removeEventListener("mousedown", resetCursorTimer);
      window.removeEventListener("touchstart", resetCursorTimer);

      if (cursorTimerRef.current) {
        window.clearTimeout(cursorTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("fcoc-admin-event-context");

      if (!raw) {
        setStatus("No admin event context found");
        return;
      }

      const event = JSON.parse(raw);

      setEventName(event?.name ?? "Unknown Event");
      setEventId(event?.id ?? null);

      setStatus("Admin event found. Photo loading is next.");
    } catch (error) {
      console.error(error);
      setStatus("Unable to read admin event context");
    }
  }, []);

  useEffect(() => {
    async function loadPhotos() {
      if (!eventId) {
        return;
      }

      setStatus("Loading approved photos...");
      console.log("LOADING PHOTOS FOR EVENT:", eventId);

      const { data, error } = await supabase
        .from("event_photos")
        .select("id, storage_path, member_caption, admin_caption, show_caption")
        .eq("event_id", eventId)
        .eq("photo_status", "approved")
        .order("uploaded_at", { ascending: true })
        .range(0, 999);
      console.log("QUERY RETURNED");
      console.log("ERROR:", error);
      console.log("ROWS:", data?.length);

      if (error) {
        console.error(error);
        setStatus("Photo query failed");
        return;
      }

      if (!data || data.length === 0) {
        setStatus("No approved photos found");
        return;
      }

      const slides: SlidePhoto[] = [];

      for (const photo of data) {
        const { data: signed } = await supabase.storage
          .from("event-photos")
          .createSignedUrl(photo.storage_path, 60 * 60 * 24);

        if (signed?.signedUrl) {
          slides.push({
            url: signed.signedUrl,
            member_caption: photo.member_caption,
            admin_caption: photo.admin_caption,
            show_caption: photo.show_caption ?? false,
          });
        } else {
          console.log("FAILED SIGN URL:", photo.storage_path);
        }
      }

      setTotalSlides(slides.length);
      setStatus(`Preloading ${slides.length} images...`);
      console.log("SLIDES:", slides.length);

      await Promise.all(
        slides.map(
          (slide) =>
            new Promise<void>((resolve) => {
              const img = new Image();

              img.onload = () => {
                setPreloadedCount((prev) => prev + 1);
                resolve();
              };

              img.onerror = () => {
                setPreloadedCount((prev) => prev + 1);
                resolve();
              };

              img.src = slide.url;
            }),
        ),
      );

      setPhotos(slides);
      setCurrentIndex(0);
      setImagesReady(true);
      setStatus(`Loaded and preloaded ${slides.length} approved photos`);
    }

    void loadPhotos();
  }, [eventId]);

  useEffect(() => {
    if (!imagesReady || photos.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % photos.length);
    }, 8000);

    return () => window.clearInterval(timer);
  }, [imagesReady, photos.length]);

  const currentPhoto = photos[currentIndex] ?? null;

  const currentCaption = currentPhoto
    ? currentPhoto.admin_caption?.trim() ||
      currentPhoto.member_caption?.trim() ||
      ""
    : "";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "black",
        color: "white",
        display: "flex",
        flexDirection: "column",
        cursor: showCursor ? "default" : "none",
      }}
    >
      <main
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 42,
            opacity: 0.8,
            gap: 16,
          }}
        >
          {currentPhoto ? (
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <img
                src={currentPhoto.url}
                alt="Slideshow"
                style={{
                  maxWidth: "100vw",
                  maxHeight: "98vh",
                  objectFit: "contain",
                }}
              />

              {currentPhoto.show_caption && currentCaption ? (
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
                  {currentCaption}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div>Loading Slideshow...</div>
              <div style={{ fontSize: 14 }}>Event ID: {eventId ?? "none"}</div>
              <div style={{ fontSize: 18 }}>{status}</div>
              <div style={{ fontSize: 14 }}>Photos Loaded: {photos.length}</div>
              <div style={{ fontSize: 14 }}>
                Approved Photos: {totalSlides}
              </div>
              <div style={{ fontSize: 14 }}>
                Preloaded: {preloadedCount} of {totalSlides}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
