"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

// Poll interval for the audience-safe authoritative read contract
// (Stage 6 Part 6). Durable database state remains authoritative; this
// is a short-interval refetch, not a second command/state model --
// anonymous Realtime/broadcast infrastructure is not yet tracked in
// this repository (see Stage 4/5 reports), and ~1s command latency is
// acceptable for v1.
const POLL_INTERVAL_MS = 1000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PublicSessionRow = {
  session_active: boolean;
  event_id: string | null;
  playback_state: "playing" | "paused" | null;
  state_version: number | null;
  item_count: number | null;
  sequence_number: number | null;
  current_content_type: "photo" | "blank" | null;
  current_content_ref_id: string | null;
  current_storage_path: string | null;
  current_duration_ms: number | null;
  next_content_type: "photo" | "blank" | null;
  next_content_ref_id: string | null;
  next_storage_path: string | null;
  next_duration_ms: number | null;
};

export default function SlideshowViewPage() {
  type FullscreenCapableElement = HTMLDivElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };

  type FullscreenCapableDocument = Document & {
    webkitExitFullscreen?: () => Promise<void> | void;
    webkitFullscreenElement?: Element | null;
  };

  const searchParams = useSearchParams();
  const sessionIdParam = searchParams.get("session");
  const sessionId =
    sessionIdParam && UUID_PATTERN.test(sessionIdParam) ? sessionIdParam : null;
  const invalidSessionFormat = Boolean(sessionIdParam) && !sessionId;

  // The public session response is the single authoritative source for
  // everything about the show: whether it is live, playback state,
  // current position, and which content item is current/next. There is
  // deliberately no local currentIndex, no local selection logic, and
  // no local advance timer -- the viewer never decides slide order.
  const [publicState, setPublicState] = useState<PublicSessionRow | null>(
    null,
  );
  const [pollError, setPollError] = useState<string | null>(null);

  const [currentImageLoaded, setCurrentImageLoaded] = useState(false);
  const [currentCaption, setCurrentCaption] = useState<string | null>(null);
  const [photographerName, setPhotographerName] = useState<string | null>(
    null,
  );

  const [showCursor, setShowCursor] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const cursorTimerRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const slideshowRootRef = useRef<FullscreenCapableElement | null>(null);

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

  // Authoritative state: poll the public, anon-safe read contract by
  // session id from the URL. No Admin Event context is ever read here
  // -- the session id is the only input, exactly as
  // read_public_presentation_session itself requires (Stage 4 Part 5:
  // "knowing an Event ID alone must not resolve an active
  // presentation"). Not-found and ended sessions are intentionally
  // indistinguishable at the RPC layer (session_active = false for
  // both) -- the viewer honors that rather than trying to infer which
  // case it is.
  useEffect(() => {
    if (!sessionId) {
      setPublicState(null);
      return;
    }

    let cancelled = false;

    async function poll() {
      const { data, error } = await supabase.rpc(
        "read_public_presentation_session",
        { p_session_id: sessionId },
      );

      if (cancelled) {
        return;
      }

      if (error) {
        console.error("Failed to read presentation session", error);
        setPollError("Unable to reach the presentation right now.");
        return;
      }

      const row = (Array.isArray(data) ? data[0] : null) as
        | PublicSessionRow
        | null;

      setPollError(null);
      setPublicState(row ?? null);
    }

    void poll();
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionId]);

  // Caption/photographer supplement. read_public_presentation_session no
  // longer carries these fields (or a storage path -- see below); this
  // page now has no direct anon read of public.event_photos at all
  // (20261010000000 removed that grant). The governed
  // presentation-caption route re-derives the same live-session/slot
  // eligibility the presentation-image route requires and returns only
  // caption fields for the photo currently vouched for -- never a
  // storage path, never any other photo.
  useEffect(() => {
    if (!sessionId || publicState?.current_content_type !== "photo") {
      setCurrentCaption(null);
      setPhotographerName(null);
      return;
    }

    let cancelled = false;

    async function resolveCaption() {
      try {
        const response = await fetch(
          `/api/slideshow/presentation-caption?session=${sessionId}&slot=current`,
        );

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setCurrentCaption(null);
          setPhotographerName(null);
          return;
        }

        const body = await response.json();
        const caption = body?.caption as
          | {
              memberCaption: string | null;
              adminCaption: string | null;
              showCaption: boolean;
              photographerName: string | null;
            }
          | null;

        if (!caption) {
          setCurrentCaption(null);
          setPhotographerName(null);
          return;
        }

        setCurrentCaption(
          caption.showCaption
            ? caption.adminCaption?.trim() ||
                caption.memberCaption?.trim() ||
                null
            : null,
        );
        setPhotographerName(caption.photographerName?.trim() || null);
      } catch {
        if (!cancelled) {
          setCurrentCaption(null);
          setPhotographerName(null);
        }
      }
    }

    void resolveCaption();

    return () => {
      cancelled = true;
    };
  }, [sessionId, publicState?.current_content_type, publicState?.current_content_ref_id]);

  // Image delivery, current + next. Neither URL is a Supabase storage
  // signed URL any more -- both point at this app's own governed,
  // session/slot-scoped delivery route (20261010000000 removed the raw
  // storage_path from read_public_presentation_session's response
  // entirely, and the anonymous storage.objects policy that used to
  // authorize a direct read is gone). The route re-validates liveness
  // and re-resolves the real object on every single request, so these
  // URLs carry no reusable, long-lived access on their own. The
  // content_ref_id + sequence_number query values exist only to force
  // the browser to re-fetch when the underlying slide actually changes
  // (the route ignores their values); the route's own "Cache-Control:
  // no-store" response header is the real cache-correctness guarantee.
  const currentImageSrc =
    sessionId && publicState?.current_content_type === "photo"
      ? `/api/slideshow/presentation-image?session=${sessionId}&slot=current&cr=${publicState.current_content_ref_id ?? ""}&v=${publicState.sequence_number ?? 0}`
      : null;

  const nextImageSrc =
    sessionId && publicState?.next_content_type === "photo"
      ? `/api/slideshow/presentation-image?session=${sessionId}&slot=next&cr=${publicState.next_content_ref_id ?? ""}&v=${publicState.sequence_number ?? 0}`
      : null;

  useEffect(() => {
    setCurrentImageLoaded(false);
  }, [currentImageSrc]);

  // Display logging (record_photo_display) is deliberately not called.
  // Stage 1 found it untracked, PUBLIC-executable, unscoped, and
  // unvalidated; Stage 4 deferred its governed replacement. Display
  // analytics are temporarily deferred until session-scoped governed
  // logging is implemented -- that gap affects analytics only, not
  // presentation correctness.

  const isLive = publicState?.session_active === true;

  useEffect(() => {
    let isMounted = true;

    async function requestWakeLock() {
      try {
        if (isLive && "wakeLock" in navigator) {
          wakeLockRef.current = await (navigator as any).wakeLock.request(
            "screen",
          );

          wakeLockRef.current?.addEventListener?.("release", () => {
            console.warn("Wake Lock released");
          });

          console.warn("Wake Lock active");
        }
      } catch (error: any) {
        if (error?.name === "NotAllowedError") {
          console.warn("Wake Lock unavailable in this browser");
        } else {
          console.error("Wake Lock failed:", error);
        }
      }
    }

    void requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isMounted && isLive) {
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
  }, [isLive]);

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

  // Audience-safe status text. Never exposes internal IDs, raw
  // Postgres errors, or Task Authority/deck-configuration internals --
  // only these fixed, generic messages (Stage 6 Part 18).
  function statusMessage(): string {
    if (!sessionIdParam) {
      return "No presentation is currently available.";
    }
    if (invalidSessionFormat) {
      return "This presentation link is invalid.";
    }
    if (pollError) {
      return "Unable to reach the presentation right now.";
    }
    if (!publicState) {
      return "Loading presentation...";
    }
    if (!publicState.session_active) {
      return "This presentation is not currently live.";
    }
    if (publicState.current_content_type === "blank") {
      return "";
    }
    // The route re-derives eligibility (live session, matching slot,
    // approved photo) itself; a photo that is not currently eligible and a
    // photo that has merely not finished loading are deliberately
    // indistinguishable here, the same non-enumerating tolerance this file
    // already applies to a not-found vs. ended session above.
    if (publicState.current_content_type === "photo" && !currentImageLoaded) {
      return "Waiting for the next slide...";
    }
    return "";
  }

  const message = statusMessage();
  const showPhoto =
    isLive &&
    publicState?.current_content_type === "photo" &&
    !!currentImageSrc &&
    currentImageLoaded;

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
          {currentImageSrc ? (
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
              {/* Always rendered once a slot has a photo, so onLoad/onError
                  can actually fire; visibility is controlled separately so
                  a not-yet-loaded (or currently ineligible) image never
                  flashes a broken/partial frame. */}
              <img
                key={currentImageSrc}
                src={currentImageSrc}
                alt="Slideshow"
                onLoad={() => setCurrentImageLoaded(true)}
                onError={() => setCurrentImageLoaded(false)}
                style={{
                  maxWidth: "100vw",
                  maxHeight: "98vh",
                  objectFit: "contain",
                  display: showPhoto ? "block" : "none",
                }}
              />

              {currentCaption && showPhoto ? (
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

              {!showPhoto && message ? (
                <div style={{ fontSize: 24 }}>{message}</div>
              ) : null}
            </div>
          ) : message ? (
            <div style={{ fontSize: 24 }}>{message}</div>
          ) : null}
        </div>
      </main>

      {/* Preload only the next item, not the whole Event gallery. Fetched
          through the same governed, session/slot-scoped route as the
          current slide -- never a storage signed URL. */}
      {nextImageSrc ? (
        <img key={nextImageSrc} src={nextImageSrc} alt="" style={{ display: "none" }} />
      ) : null}
    </div>
  );
}
