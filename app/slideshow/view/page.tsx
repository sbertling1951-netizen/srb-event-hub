"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { type PresentationFrame,presentationFrame } from "@/lib/presentationPlayback";
import { SLIDESHOW_AUDIENCE_MESSAGES } from "@/lib/storageKeys";
import { supabase } from "@/lib/supabase";

import PresentationSlideImage from "./PresentationSlideImage";

// Poll interval for the audience-safe authoritative read contract
// (Stage 6 Part 6). Durable database state remains authoritative; this
// is a short-interval refetch, not a second command/state model --
// anonymous Realtime/broadcast infrastructure is not yet tracked in
// this repository (see Stage 4/5 reports), and ~1s command latency is
// acceptable for v1.
const POLL_INTERVAL_MS = 1000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FullscreenCapableElement = HTMLDivElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenCapableDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

// The fullscreen root stays mounted across a presenter-directed session
// change. Only SlideshowSession remounts, which cancels the previous
// session's polls, caption reads and image requests.
export default function SlideshowViewPage() {
  const searchParams = useSearchParams();
  const sessionIdParam = searchParams.get("session");
  const link = searchParams.get("link");

  const [showCursor, setShowCursor] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const cursorTimerRef = useRef<number | null>(null);
  const slideshowRootRef = useRef<FullscreenCapableElement | null>(null);

  useLayoutEffect(() => {
    document.body.classList.add("slideshow-view-mode");

    return () => {
      document.body.classList.remove("slideshow-view-mode");
    };
  }, []);

  // Presenter-to-audience window protocol. A presenter-opened window carries a
  // random `link` token in its URL and accepts a new session id only from its
  // own opener, on this origin, naming that same link. It never looks up a
  // session by Event, so an ordinary shared viewer link cannot follow later
  // sessions; the session id remains the viewer's only authority input.
  useEffect(() => {
    const opener = window.opener as Window | null;
    if (!link || !UUID_PATTERN.test(link) || !opener) {
      return;
    }

    const currentSessionParam = () =>
      new URLSearchParams(window.location.search).get("session");

    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (
        event.origin !== window.location.origin ||
        event.source !== opener ||
        data?.type !== SLIDESHOW_AUDIENCE_MESSAGES.session ||
        data.link !== link ||
        typeof data.sessionId !== "string" ||
        !UUID_PATTERN.test(data.sessionId) ||
        data.sessionId === currentSessionParam()
      ) {
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.set("session", data.sessionId);
      window.history.replaceState(null, "", url);
    };

    // Lets the presenter tab that opened this window find it again after a
    // presenter refresh, and answer with a newly started session.
    const announce = () => {
      try {
        opener.postMessage(
          { type: SLIDESHOW_AUDIENCE_MESSAGES.status, link, sessionId: currentSessionParam() },
          window.location.origin,
        );
      } catch {
        // The opener closed or left this origin; nothing to reconnect to.
      }
    };

    window.addEventListener("message", handleMessage);
    announce();
    const timer = window.setInterval(announce, POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener("message", handleMessage);
      window.clearInterval(timer);
    };
  }, [link]);

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
      <SlideshowSession key={sessionIdParam ?? ""} sessionIdParam={sessionIdParam} link={link} />
    </div>
  );
}

function SlideshowSession({ sessionIdParam, link }: { sessionIdParam: string | null; link: string | null }) {
  const sessionId =
    sessionIdParam && UUID_PATTERN.test(sessionIdParam) ? sessionIdParam : null;
  const invalidSessionFormat = Boolean(sessionIdParam) && !sessionId;

  // The public session response is the single authoritative source for
  // everything about the show: whether it is live, playback state,
  // current position, and which content item is current/next. There is
  // deliberately no local currentIndex, no local selection logic, and
  // no local advance timer -- the viewer never decides slide order.
  const [publicState, setPublicState] = useState<PresentationFrame | null>(
    null,
  );
  const [pollError, setPollError] = useState<string | null>(null);

  const [captionPhotoId, setCaptionPhotoId] = useState<string | null>(null);
  const [currentCaption, setCurrentCaption] = useState<string | null>(null);
  const [photographerName, setPhotographerName] = useState<string | null>(
    null,
  );

  const [wakeLockUnavailable, setWakeLockUnavailable] = useState(false);

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
    let polling = false;
    let generation = 0;
    let pairedUntil = 0;
    let version = -1;
    let ended = false;
    const opener = window.opener as Window | null;

    function acceptFrame(frame: PresentationFrame | null) {
      if (frame?.session_active && (ended || frame.state_version! < version)) { return; }
      if (frame?.session_active) { version = frame.state_version!; }
      if (frame && !frame.session_active) { ended = true; }
      setPollError(frame ? null : "Unable to reach the presentation right now.");
      setPublicState(frame);
    }

    // Pairing changes delivery, never authority or image access. Only our
    // opener, matching this origin/link/session, may relay its server frame.
    // The image routes still independently authorize every current/next asset.
    const handleFrame = (event: MessageEvent) => {
      const data = event.data;
      if (!link || !UUID_PATTERN.test(link) || !opener ||
          event.origin !== window.location.origin || event.source !== opener ||
          data?.type !== SLIDESHOW_AUDIENCE_MESSAGES.frame || data.link !== link ||
          data.sessionId !== sessionId) { return; }
      const frame = data.frame === null ? null : presentationFrame(data.frame);
      if (data.frame !== null && !frame) { return; }
      pairedUntil = Date.now() + 3000;
      ++generation; // an independent read started before pairing cannot overwrite it
      acceptFrame(frame);
    };

    async function poll() {
      if (polling || Date.now() < pairedUntil) { return; }
      polling = true;
      const request = ++generation;
      try {
        const { data, error } = await supabase.rpc(
          "read_public_presentation_session", { p_session_id: sessionId },
        );
        if (cancelled || request !== generation) { return; }
        if (error) { throw error; }
        const frame = presentationFrame(Array.isArray(data) ? data[0] : null);
        if (!frame) { throw new Error("Invalid presentation response"); }
        acceptFrame(frame);
      } catch (error) {
        if (!cancelled && request === generation) {
          console.error("Failed to read presentation session", error);
          acceptFrame(null);
        }
      } finally { polling = false; }
    }

    window.addEventListener("message", handleFrame);
    // Give an existing opener the first chance to supply its exact frame.
    // A shared link, lost opener, or presenter refresh resumes the governed
    // public read; no browser-local slide selection or timing is introduced.
    if (link && opener) {
      opener.postMessage({ type: SLIDESHOW_AUDIENCE_MESSAGES.status, link, sessionId }, window.location.origin);
    } else { void poll(); }
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.removeEventListener("message", handleFrame);
      window.clearInterval(timer);
    };
  }, [sessionId, link]);

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
    const photoId = publicState.current_content_ref_id;

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
        if (cancelled) { return; }
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

        setCaptionPhotoId(photoId);
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

  // Keep only the live, eligible current/next photos returned by the
  // authoritative poll. Stable photo keys promote the already-decoded next
  // image without a second download. Ended, denied or blank slots do not
  // retain the previous photo; polling failures release the buffer as well.
  const photos: { contentRefId: string; slot: "current" | "next" }[] = [];
  if (sessionId && publicState?.session_active && !pollError) {
    if (publicState.current_content_type === "photo" && publicState.current_content_ref_id) {
      photos.push({ contentRefId: publicState.current_content_ref_id, slot: "current" });
    }
    if (
      publicState.next_content_type === "photo" && publicState.next_content_ref_id &&
      !photos.some((photo) => photo.contentRefId === publicState.next_content_ref_id)
    ) {
      photos.push({ contentRefId: publicState.next_content_ref_id, slot: "next" });
    }
  }

  // Display logging (record_photo_display) is deliberately not called.
  // Stage 1 found it untracked, PUBLIC-executable, unscoped, and
  // unvalidated; Stage 4 deferred its governed replacement. Display
  // analytics are temporarily deferred until session-scoped governed
  // logging is implemented -- that gap affects analytics only, not
  // presentation correctness.

  const isLive = publicState?.session_active === true;

  useEffect(() => {
    let cancelled = false;
    let requesting = false;
    let lock: WakeLockSentinel | null = null;
    setWakeLockUnavailable(false);
    if (!isLive) { return; }
    if (!("wakeLock" in navigator)) {
      setWakeLockUnavailable(true);
      return;
    }

    async function requestWakeLock() {
      if (cancelled || requesting || document.visibilityState !== "visible" ||
          (lock && !lock.released)) { return; }
      requesting = true;
      try {
        const acquired = await navigator.wakeLock.request("screen");
        // End, a session change or hiding the viewer may precede resolution.
        // Never leave that late lock held by an abandoned effect.
        if (cancelled || document.visibilityState !== "visible") {
          await acquired.release();
          return;
        }
        lock = acquired;
        setWakeLockUnavailable(false);
        acquired.addEventListener("release", () => {
          if (!cancelled && lock === acquired) {
            lock = null;
            setWakeLockUnavailable(true);
          }
        });
        if (acquired.released) {
          lock = null;
          setWakeLockUnavailable(true);
        }
      } catch {
        if (!cancelled) { setWakeLockUnavailable(true); }
      } finally {
        requesting = false;
      }
    }

    const handleVisibilityChange = () => { void requestWakeLock(); };
    void requestWakeLock();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    // Retry released or denied locks while the live viewer is visible. A
    // bounded interval avoids a tight loop when the OS refuses protection.
    const timer = window.setInterval(() => { void requestWakeLock(); }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      const held = lock;
      lock = null;
      if (held && !held.released) { void held.release().catch(() => {}); }
    };
  }, [isLive]);

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
    return "";
  }

  const message = statusMessage();

  return (
    <main
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
      }}
    >
      {isLive && wakeLockUnavailable ? (
        <div role="status" style={{ position: "fixed", bottom: 16, left: 16, right: 16, zIndex: 10, padding: "8px 12px", background: "rgba(0,0,0,0.85)", color: "#fde68a", fontSize: 14, textAlign: "center" }}>
          Keep-awake protection is unavailable. This device may sleep during the slideshow.
        </div>
      ) : null}
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
        {photos.map((photo) => (
          <PresentationSlideImage
            key={`${sessionId}:${photo.contentRefId}`}
            sessionId={sessionId!}
            contentRefId={photo.contentRefId}
            slot={photo.slot}
            caption={photo.slot === "current" && captionPhotoId === photo.contentRefId ? currentCaption : null}
            photographerName={photo.slot === "current" && captionPhotoId === photo.contentRefId ? photographerName : null}
          />
        ))}
        {message ? <div style={{ fontSize: 24 }}>{message}</div> : null}
      </div>
    </main>
  );
}
