"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

export default function SlideshowViewPage() {
  type FullscreenCapableElement = HTMLDivElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };

  type FullscreenCapableDocument = Document & {
    webkitExitFullscreen?: () => Promise<void> | void;
    webkitFullscreenElement?: Element | null;
  };

  const [eventName, setEventName] = useState("No Event Selected");
  const [eventId, setEventId] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready to load approved photos");

  type SlidePhoto = {
    id: string;
    url: string;
    member_caption: string | null;
    admin_caption: string | null;
    photographer_name_snapshot: string | null;
    show_caption: boolean;
    featured_level: number;
  };

  const [photos, setPhotos] = useState<SlidePhoto[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Publishes the current and next photo/caption state to epix-presentation-state
  const publishViewerState = (currentIdx: number) => {
    try {
      const current = photos[currentIdx];

      const nextIdx =
        photos.length > 1 ? (currentIdx + 1) % photos.length : currentIdx;

      const next = photos[nextIdx];

      const raw = localStorage.getItem("epix-presentation-state");
      const existing = raw ? JSON.parse(raw) : {};

      localStorage.setItem(
        "epix-presentation-state",
        JSON.stringify({
          ...existing,
          currentIndex: currentIdx,
          currentPhotoUrl: current?.url ?? null,
          currentCaption:
            current?.admin_caption?.trim() ||
            current?.member_caption?.trim() ||
            "",
          nextIndex: nextIdx,
          nextPhotoUrl: next?.url ?? null,
          nextCaption:
            next?.admin_caption?.trim() || next?.member_caption?.trim() || "",
          totalSlides: photos.length,
          paused: pausedRef.current,
          historyMode: historyModeRef.current,
          slidesShown: slidesShownRef.current,
        }),
      );
    } catch (error) {
      console.error("Publish viewer state failed", error);
    }
  };

  const showSlide = (index: number) => {
    setCurrentIndex(index);

    slidesShownRef.current += 1;
    setSlidesShown(slidesShownRef.current);

    const history = slideHistoryRef.current;

    if (historyPositionRef.current < history.length - 1) {
      history.splice(historyPositionRef.current + 1);
    }

    history.push(index);
    historyPositionRef.current = history.length - 1;

    // Track featured slide show counts
    const currentPhoto = photos[index];
    if (currentPhoto && currentPhoto.featured_level > 0) {
      featuredCooldownRef.current = slideHistoryRef.current.length;

      featuredShownCountRef.current[index] =
        (featuredShownCountRef.current[index] ?? 0) + 1;
    }

    const photoId = currentPhoto?.id;

    if (photoId) {
      void supabase
        .rpc("record_photo_display", {
          p_photo_id: photoId,
        })
        .then((result) => {
          console.log("DISPLAY RPC", result);
        });
    }
  };

  const [imagesReady, setImagesReady] = useState(false);
  const [preloadedCount, setPreloadedCount] = useState(0);
  const [totalSlides, setTotalSlides] = useState(0);
  const [slidesShown, setSlidesShown] = useState(0);
  const slidesShownRef = useRef(0);
  const recentSlidesRef = useRef<number[]>([]);
  const featuredCooldownRef = useRef(-9999);
  const featuredShownCountRef = useRef<Record<number, number>>({});
  const [showCursor, setShowCursor] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const cursorTimerRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const slideshowRootRef = useRef<FullscreenCapableElement | null>(null);

  const lastCommandAtRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const slideHistoryRef = useRef<number[]>([]);
  const historyPositionRef = useRef(-1);
  const historyModeRef = useRef(false);
  const livePositionRef = useRef(0);

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
    const fullscreenDocument = document as FullscreenCapableDocument;

    const syncFullscreenState = () => {
      const fullscreenElement =
        document.fullscreenElement ??
        fullscreenDocument.webkitFullscreenElement ??
        null;

      setIsFullscreen(fullscreenElement === slideshowRootRef.current);
    };

    syncFullscreenState();

    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener(
      "webkitfullscreenchange",
      syncFullscreenState as EventListener,
    );

    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener(
        "webkitfullscreenchange",
        syncFullscreenState as EventListener,
      );
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
        .select(
          "id, storage_path, member_caption, admin_caption, photographer_name_snapshot, show_caption, featured_level",
        )
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
            id: photo.id,
            url: signed.signedUrl,
            member_caption: photo.member_caption,
            admin_caption: photo.admin_caption,
            photographer_name_snapshot: photo.photographer_name_snapshot,
            show_caption: photo.show_caption ?? false,
            featured_level: photo.featured_level ?? 0,
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

      slidesShownRef.current = 1;
      setSlidesShown(1);

      slideHistoryRef.current = [0];
      historyPositionRef.current = 0;
      setCurrentIndex(0);
      setTimeout(() => publishViewerState(0), 100);
      livePositionRef.current = 0;
      historyModeRef.current = false;
      pausedRef.current = false;
      setImagesReady(true);
      setStatus(`Loaded and preloaded ${slides.length} approved photos`);
    }

    void loadPhotos();
  }, [eventId]);

  useEffect(() => {
    let isMounted = true;

    async function requestWakeLock() {
      try {
        if (imagesReady && photos.length > 0 && "wakeLock" in navigator) {
          wakeLockRef.current = await (navigator as any).wakeLock.request(
            "screen",
          );

          wakeLockRef.current?.addEventListener?.("release", () => {
            console.log("Wake Lock released");
          });

          console.log("Wake Lock active");
        }
      } catch (error: any) {
        if (error?.name === "NotAllowedError") {
          console.log("Wake Lock unavailable in this browser");
        } else {
          console.error("Wake Lock failed:", error);
        }
      }
    }

    void requestWakeLock();

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        isMounted &&
        imagesReady &&
        photos.length > 0
      ) {
        void requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (wakeLockRef.current) {
        void wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    };
  }, [imagesReady, photos.length]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      try {
        const raw = localStorage.getItem("epix-presentation-state");
        if (!raw) {
          return;
        }

        const state = JSON.parse(raw);
        const commandAt = Number(state.commandAt ?? 0);

        if (!commandAt || commandAt <= lastCommandAtRef.current) {
          return;
        }

        lastCommandAtRef.current = commandAt;

        // Update paused and historyMode refs from state
        pausedRef.current = state.paused === true;
        historyModeRef.current = state.historyMode === true;

        switch (state.command) {
          case "previous": {
            const history = slideHistoryRef.current;

            if (!historyModeRef.current) {
              historyModeRef.current = true;
              pausedRef.current = true;
              // Publish back updated state
              localStorage.setItem(
                "epix-presentation-state",
                JSON.stringify({
                  ...state,
                  paused: true,
                  historyMode: true,
                  commandAt: Date.now(),
                }),
              );
            }

            if (history.length > 1 && historyPositionRef.current > 0) {
              historyPositionRef.current -= 1;
              setCurrentIndex(history[historyPositionRef.current]);
            }

            break;
          }

          case "next": {
            const history = slideHistoryRef.current;

            if (historyModeRef.current) {
              if (historyPositionRef.current < history.length - 1) {
                historyPositionRef.current += 1;
                setCurrentIndex(history[historyPositionRef.current]);
              }

              break;
            }

            const recent = recentSlidesRef.current;
            const cooldownSize = Math.min(
              30,
              Math.max(15, Math.floor(photos.length / 4)),
            );

            const candidates = photos
              .map((photo, index) => ({ photo, index }))
              .filter(({ index }) => !recent.includes(index));

            const usable =
              candidates.length > 0
                ? candidates
                : photos.map((photo, index) => ({ photo, index }));

            const weightedPool: number[] = [];

            usable.forEach(({ photo, index }) => {
              const featuredCooldownSize = Math.max(
                12,
                Math.min(25, Math.floor(photos.length / 8)),
              );

              const slidesSinceFeatured =
                slideHistoryRef.current.length - featuredCooldownRef.current;

              let weight = 1;

              if (
                photo.featured_level > 0 &&
                slidesSinceFeatured < featuredCooldownSize
              ) {
                weight = 0;
              } else if (photo.featured_level === 3) {
                weight = 8;
              } else if (photo.featured_level === 2) {
                weight = 4;
              } else if (photo.featured_level === 1) {
                weight = 2;
              }

              weight = Math.max(weight, photo.featured_level === 0 ? 1 : 0);

              for (let i = 0; i < weight; i++) {
                weightedPool.push(index);
              }
            });

            // Safety fallback: if all featured are on cooldown, use all usable
            if (weightedPool.length === 0) {
              usable.forEach(({ index }) => weightedPool.push(index));
            }

            const nextIndex =
              weightedPool[Math.floor(Math.random() * weightedPool.length)];

            recent.push(nextIndex);

            while (recent.length > cooldownSize) {
              recent.shift();
            }

            showSlide(nextIndex);

            break;
          }

          case "restart": {
            recentSlidesRef.current = [];
            featuredCooldownRef.current = -9999;
            featuredShownCountRef.current = {};

            slidesShownRef.current = 1;
            setSlidesShown(1);

            slideHistoryRef.current = [0];
            historyPositionRef.current = 0;

            livePositionRef.current = 0;
            historyModeRef.current = false;
            pausedRef.current = false;

            setCurrentIndex(0);

            setTimeout(() => publishViewerState(0), 100);

            localStorage.setItem(
              "epix-presentation-state",
              JSON.stringify({
                ...state,
                paused: false,
                historyMode: false,
                commandAt: Date.now(),
              }),
            );

            break;
          }

          case "pause":
            pausedRef.current = true;
            break;

          case "resume":
            historyModeRef.current = false;
            pausedRef.current = false;

            // Publish back updated state
            localStorage.setItem(
              "epix-presentation-state",
              JSON.stringify({
                ...state,
                paused: false,
                historyMode: false,
                commandAt: Date.now(),
              }),
            );

            if (slideHistoryRef.current.length > 0) {
              historyPositionRef.current = slideHistoryRef.current.length - 1;
              setCurrentIndex(
                slideHistoryRef.current[historyPositionRef.current],
              );
            }

            break;
        }
      } catch (error) {
        console.error("Presentation command error", error);
      }
    }, 500);

    return () => window.clearInterval(timer);
  }, [photos.length]);

  useEffect(() => {
    if (!imagesReady || photos.length <= 1) {
      return;
    }

    const pickNextSlide = () => {
      if (pausedRef.current) {
        return;
      }

      const recent = recentSlidesRef.current;
      const cooldownSize = Math.min(
        30,
        Math.max(15, Math.floor(photos.length / 4)),
      );

      const candidates = photos
        .map((photo, index) => ({ photo, index }))
        .filter(({ index }) => !recent.includes(index));

      const usable =
        candidates.length > 0
          ? candidates
          : photos.map((photo, index) => ({ photo, index }));

      const weightedPool: number[] = [];

      usable.forEach(({ photo, index }) => {
        const featuredCooldownSize = Math.max(
          12,
          Math.min(25, Math.floor(photos.length / 8)),
        );

        const slidesSinceFeatured =
          slideHistoryRef.current.length - featuredCooldownRef.current;

        let weight = 1;

        if (
          photo.featured_level > 0 &&
          slidesSinceFeatured < featuredCooldownSize
        ) {
          weight = 0;
        } else if (photo.featured_level === 3) {
          weight = 8;
        } else if (photo.featured_level === 2) {
          weight = 4;
        } else if (photo.featured_level === 1) {
          weight = 2;
        }

        weight = Math.max(weight, photo.featured_level === 0 ? 1 : 0);

        for (let i = 0; i < weight; i++) {
          weightedPool.push(index);
        }
      });

      // Safety fallback: if all featured are on cooldown, use all usable
      if (weightedPool.length === 0) {
        usable.forEach(({ index }) => weightedPool.push(index));
      }

      const nextIndex =
        weightedPool[Math.floor(Math.random() * weightedPool.length)];

      recent.push(nextIndex);

      while (recent.length > cooldownSize) {
        recent.shift();
      }

      showSlide(nextIndex);
      livePositionRef.current = nextIndex;
    };

    const timer = window.setInterval(pickNextSlide, 8000);

    return () => window.clearInterval(timer);
  }, [imagesReady, photos]);

  const currentPhoto = photos[currentIndex] ?? null;

  useEffect(() => {
    if (photos.length === 0) {
      return;
    }
    publishViewerState(currentIndex);
  }, [currentIndex, photos]);

  const currentCaption = currentPhoto
    ? currentPhoto.admin_caption?.trim() ||
      currentPhoto.member_caption?.trim() ||
      ""
    : "";

  const photographerName =
    currentPhoto?.photographer_name_snapshot?.trim() || "";

  const toggleFullscreen = async () => {
    const slideshowRoot = slideshowRootRef.current;
    const fullscreenDocument = document as FullscreenCapableDocument;

    if (!slideshowRoot) {
      return;
    }

    try {
      if (
        document.fullscreenElement === slideshowRoot ||
        fullscreenDocument.webkitFullscreenElement === slideshowRoot
      ) {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
          return;
        }

        if (fullscreenDocument.webkitFullscreenElement) {
          await fullscreenDocument.webkitExitFullscreen?.();
        }

        return;
      }

      if (slideshowRoot.requestFullscreen) {
        await slideshowRoot.requestFullscreen();
        return;
      }

      await slideshowRoot.webkitRequestFullscreen?.();
    } catch (error) {
      console.error("Fullscreen toggle failed", error);
    }
  };

  return (
    <div
      ref={slideshowRootRef}
      style={{
        minHeight: "100vh",
        width: "100%",
        background: "black",
        color: "white",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        cursor: showCursor ? "default" : "none",
      }}
    >
      <button
        type="button"
        onClick={() => {
          void toggleFullscreen();
        }}
        aria-pressed={isFullscreen}
        style={{
          position: "fixed",
          top: "calc(16px + env(safe-area-inset-top, 0px))",
          right: "calc(16px + env(safe-area-inset-right, 0px))",
          zIndex: 10,
          padding: "10px 14px",
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.35)",
          background: "rgba(0,0,0,0.65)",
          color: "white",
          fontSize: 14,
          fontWeight: 600,
          lineHeight: 1.2,
          opacity: showCursor ? 1 : 0,
          pointerEvents: showCursor ? "auto" : "none",
          transition: "opacity 180ms ease",
        }}
      >
        {isFullscreen ? "Exit Full Screen" : "Enter Full Screen"}
      </button>
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
                  <>
                    <div>{currentCaption}</div>
                    {photographerName ? (
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 18,
                          opacity: 0.85,
                        }}
                      >
                        Photo by {photographerName}
                      </div>
                    ) : null}
                  </>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div>Loading Slideshow...</div>
              <div style={{ fontSize: 14 }}>Event ID: {eventId ?? "none"}</div>
              <div style={{ fontSize: 18 }}>{status}</div>
              <div style={{ fontSize: 14 }}>Photos Loaded: {photos.length}</div>
              <div style={{ fontSize: 14 }}>Approved Photos: {totalSlides}</div>
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
