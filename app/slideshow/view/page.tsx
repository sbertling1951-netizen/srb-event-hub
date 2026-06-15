"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function SlideshowViewPage() {
  const [eventName, setEventName] = useState("No Event Selected");
  const [eventId, setEventId] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready to load approved photos");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imagesReady, setImagesReady] = useState(false);
  const [preloadedCount, setPreloadedCount] = useState(0);

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

      const { data, error } = await supabase
        .from("event_photos")
        .select("id, storage_path")
        .eq("event_id", eventId)
        .eq("photo_status", "approved")
        .order("uploaded_at", { ascending: true })
        .limit(100);

      if (error) {
        console.error(error);
        setStatus("Photo query failed");
        return;
      }

      if (!data || data.length === 0) {
        setStatus("No approved photos found");
        return;
      }

      const urls: string[] = [];

      for (const photo of data) {
        const { data: signed } = await supabase.storage
          .from("event-photos")
          .createSignedUrl(photo.storage_path, 60 * 60);

        if (signed?.signedUrl) {
          urls.push(signed.signedUrl);
        }
      }

      setStatus(`Preloading ${urls.length} images...`);

      await Promise.all(
        urls.map(
          (url) =>
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

              img.src = url;
            }),
        ),
      );

      setPhotoUrls(urls);
      setCurrentIndex(0);
      setImagesReady(true);
      setStatus(`Loaded and preloaded ${urls.length} approved photos`);
    }

    void loadPhotos();
  }, [eventId]);

  useEffect(() => {
    if (!imagesReady || photoUrls.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % photoUrls.length);
    }, 8000);

    return () => window.clearInterval(timer);
  }, [imagesReady, photoUrls.length]);

  const currentPhoto = photoUrls[currentIndex] ?? null;
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "black",
        color: "white",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          height: 70,
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
          borderBottom: "1px solid #222",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            background: "#444",
            marginRight: 12,
          }}
        />

        <div style={{ fontSize: 24, fontWeight: 700 }}>{eventName}</div>
      </header>

      <main
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            border: "1px dashed #333",
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
            <img
              src={currentPhoto}
              alt="Slideshow"
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
              }}
            />
          ) : (
            <>
              <div>PHOTO AREA</div>
              <div style={{ fontSize: 14 }}>
                Event ID: {eventId ?? "none"}
              </div>
              <div style={{ fontSize: 18 }}>{status}</div>
              <div style={{ fontSize: 14 }}>
                Photos Loaded: {photoUrls.length}
              </div>
              <div style={{ fontSize: 14 }}>
                Preloaded: {preloadedCount} of {photoUrls.length}
              </div>
            </>
          )}
        </div>
      </main>

      <footer
        style={{
          minHeight: 90,
          padding: "16px 32px",
          textAlign: "center",
          fontSize: 32,
          fontWeight: 500,
          borderTop: "1px solid #222",
          flexShrink: 0,
        }}
      >
        <div>
          Photo {photoUrls.length === 0 ? 0 : currentIndex + 1} of {photoUrls.length}
        </div>
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() =>
              setCurrentIndex((prev) =>
                prev === 0 ? Math.max(photoUrls.length - 1, 0) : prev - 1,
              )
            }
          >
            Previous
          </button>
          <button
            style={{ marginLeft: 12 }}
            onClick={() =>
              setCurrentIndex((prev) =>
                photoUrls.length === 0 ? 0 : (prev + 1) % photoUrls.length,
              )
            }
          >
            Next
          </button>
        </div>
      </footer>
    </div>
  );
}
