"use client";

import { useCallback, useEffect, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { AppButton } from "@/components/ui/AppButton";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { supabase } from "@/lib/supabase";

// Presenter concurrency-awareness refresh interval. This is not the
// presenter's authoritative state transport (each command applies the
// RPC's own directly-returned row -- see runControl below) -- it exists
// only so a second open presenter console, or a future external actor,
// is noticed at a coarse interval appropriate for a slow-moving
// presentation control surface. It replaces the retired 500ms/1000ms
// localStorage poll with something far less aggressive because it is no
// longer the source of truth, merely a staleness check.
const SESSION_REFRESH_INTERVAL_MS = 5000;
const PHOTO_SIGNED_URL_TTL_SECONDS = 60 * 60;

type PresentationDeck = {
  id: string;
  name: string;
  selection_mode: "all_approved" | "manual";
  default_duration_ms: number;
  lifecycle_status: string;
  item_count: number;
};

type PresentationSession = {
  id: string;
  event_id: string;
  deck_id: string;
  status: "live" | "ended";
  playback_state: "playing" | "paused";
  current_index: number;
  state_version: number;
  started_at: string;
  ended_at: string | null;
};

type PresentationSessionItem = {
  id: string;
  content_type: "photo" | "blank";
  content_ref_id: string | null;
  sequence_number: number;
  duration_ms: number;
};

type ResolvedPhoto = {
  url: string | null;
  caption: string | null;
};

// Maps the governed session RPCs' RAISE EXCEPTION codes (Stage 4) to
// presenter-facing text. Exported for focused testing, mirroring
// app/admin/agenda/page.tsx's mapAgendaRpcError/isStaleAgendaVersionError
// precedent exactly.
const PRESENTATION_ERROR_MESSAGES: Record<string, string> = {
  unauthorized:
    "You no longer have Slideshow management authority for this event.",
  deck_not_found: "That presentation deck no longer exists.",
  deck_archived: "That deck has been archived and can no longer be started.",
  deck_has_no_playable_items:
    "This deck has no playable slides yet (no approved photos or manual items).",
  session_already_active:
    "A presentation is already live for this event. End it before starting another.",
  session_not_found: "That presentation session no longer exists.",
  session_not_live: "This presentation has already ended.",
};

export function mapPresentationRpcError(
  err: unknown,
  fallback: string,
): string {
  const raw = err instanceof Error ? err.message : "";
  return PRESENTATION_ERROR_MESSAGES[raw] || raw || fallback;
}

export function isStalePresentationVersionError(err: unknown): boolean {
  return err instanceof Error && err.message === "stale_version";
}

export default function AdminSlideshowPage() {
  return (
    <AdminRouteGuard>
      <AdminShellAdapter pageTitle="Slideshow Presenter">
        <AdminSlideshowPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

function AdminSlideshowPageInner() {
  // Page-content access is governed by the canonical Task Authority
  // resolver (event.slideshow.manage for the current admin working
  // Event), the same pattern app/admin/agenda/page.tsx already
  // established: this page never inspects privilege_group/
  // is_super_admin or reimplements has_event_task_authority's
  // semantics itself -- it only asks the existing governed resolver
  // the one question it needs answered. null = not yet checked (no
  // Event selected, or check in flight).
  const [hasSlideshowAccess, setHasSlideshowAccess] = useState<
    boolean | null
  >(null);
  const [eventId, setEventId] = useState<string | null>(null);

  const checkSlideshowAccess = useCallback(async () => {
    const adminEvent = getCurrentAdminEvent();
    setEventId(adminEvent?.id ?? null);

    if (!adminEvent?.id) {
      setHasSlideshowAccess(null);
      return;
    }

    const { data, error } = await supabase.rpc("has_event_task_authority", {
      p_task_key: "event.slideshow.manage",
      p_event_id: adminEvent.id,
    });

    if (error) {
      console.error("Failed to check Slideshow access", error);
      setHasSlideshowAccess(false);
      return;
    }

    setHasSlideshowAccess(!!data);
  }, []);

  useEffect(() => {
    void checkSlideshowAccess();

    return subscribeToAdminWorkspace(() => {
      void checkSlideshowAccess();
    });
  }, [checkSlideshowAccess]);

  const [decks, setDecks] = useState<PresentationDeck[] | null>(null);
  const [selectedDeckId, setSelectedDeckId] = useState<string>("");
  const [session, setSession] = useState<PresentationSession | null>(null);
  const [items, setItems] = useState<PresentationSessionItem[]>([]);
  const [currentPhoto, setCurrentPhoto] = useState<ResolvedPhoto | null>(
    null,
  );
  const [nextPhoto, setNextPhoto] = useState<ResolvedPhoto | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function showStatus(message: string) {
    setError("");
    setStatus(message);
  }

  function showError(message: string) {
    setStatus("");
    setError(message);
  }

  // Deck list: durable Presentation decks for the current Event, read
  // through Stage 3's established direct-RLS admin read boundary
  // (has_event_task_authority-gated SELECT policy) -- the same
  // governed/direct-read contract Stage 3 built, not a new one. Active
  // decks only; deck authoring/editing is a separate future UI surface
  // and is deliberately not built here.
  const loadDecks = useCallback(async (currentEventId: string) => {
    const { data, error: loadError } = await supabase
      .from("presentation_decks")
      .select(
        "id, name, selection_mode, default_duration_ms, lifecycle_status, presentation_deck_items(count)",
      )
      .eq("event_id", currentEventId)
      .eq("lifecycle_status", "active")
      .order("created_at", { ascending: false });

    if (loadError) {
      console.error("Failed to load presentation decks", loadError);
      setDecks([]);
      return;
    }

    const normalized: PresentationDeck[] = (data || []).map((deck: any) => ({
      id: deck.id,
      name: deck.name,
      selection_mode: deck.selection_mode,
      default_duration_ms: deck.default_duration_ms,
      lifecycle_status: deck.lifecycle_status,
      item_count: Array.isArray(deck.presentation_deck_items)
        ? deck.presentation_deck_items[0]?.count ?? 0
        : 0,
    }));

    setDecks(normalized);
  }, []);

  // Resolves a photo slide's presentation-safe URL/caption the same way
  // app/slideshow/view/page.tsx already does (signed storage URL +
  // show_caption-gated admin/member caption fallback) -- reused here,
  // not reinvented, and Presentation never copies this into its own
  // durable state; it is looked up fresh every time.
  const resolvePhoto = useCallback(
    async (photoId: string | null): Promise<ResolvedPhoto | null> => {
      if (!photoId) {
        return null;
      }

      const { data, error: photoError } = await supabase
        .from("event_photos")
        .select("storage_path, member_caption, admin_caption, show_caption")
        .eq("id", photoId)
        .maybeSingle();

      if (photoError || !data) {
        return null;
      }

      const { data: signed } = await supabase.storage
        .from("event-photos")
        .createSignedUrl(data.storage_path, PHOTO_SIGNED_URL_TTL_SECONDS);

      const caption = data.show_caption
        ? data.admin_caption?.trim() || data.member_caption?.trim() || null
        : null;

      return { url: signed?.signedUrl ?? null, caption: caption || null };
    },
    [],
  );

  const loadSessionItems = useCallback(
    async (sessionId: string, currentIndex: number) => {
      const { data, error: itemsError } = await supabase
        .from("presentation_session_items")
        .select("id, content_type, content_ref_id, sequence_number, duration_ms")
        .eq("session_id", sessionId)
        .order("sequence_number", { ascending: true });

      if (itemsError) {
        console.error("Failed to load session items", itemsError);
        setItems([]);
        setCurrentPhoto(null);
        setNextPhoto(null);
        return;
      }

      const rows: PresentationSessionItem[] = data || [];
      setItems(rows);

      const current = rows.find((i) => i.sequence_number === currentIndex);
      const next = rows.find((i) => i.sequence_number === currentIndex + 1);

      setCurrentPhoto(
        current?.content_type === "photo"
          ? await resolvePhoto(current.content_ref_id)
          : null,
      );
      setNextPhoto(
        next?.content_type === "photo"
          ? await resolvePhoto(next.content_ref_id)
          : null,
      );
    },
    [resolvePhoto],
  );

  // Session discovery/reconnect (Stage 5 Part 6): on load or refresh,
  // ask the database whether the current Event already has a live
  // session -- never create one merely because the page opened. This
  // is what makes presenter refresh durable: there is no browser-local
  // state to lose.
  const loadLiveSession = useCallback(
    async (currentEventId: string) => {
      const { data, error: sessionError } = await supabase
        .from("presentation_sessions")
        .select("*")
        .eq("event_id", currentEventId)
        .eq("status", "live")
        .maybeSingle();

      if (sessionError) {
        console.error("Failed to load presentation session", sessionError);
        return;
      }

      const row = (data as PresentationSession | null) ?? null;
      setSession(row);

      if (row) {
        await loadSessionItems(row.id, row.current_index);
      } else {
        setItems([]);
        setCurrentPhoto(null);
        setNextPhoto(null);
      }
    },
    [loadSessionItems],
  );

  useEffect(() => {
    if (hasSlideshowAccess !== true || !eventId) {
      return;
    }
    void loadDecks(eventId);
    void loadLiveSession(eventId);
  }, [hasSlideshowAccess, eventId, loadDecks, loadLiveSession]);

  useEffect(() => {
    if (!eventId || session?.status !== "live") {
      return;
    }
    const sessionId = session.id;
    const timer = setInterval(() => {
      // Stage 6A: governed timed advance is driven primarily by the
      // audience viewer's own required poll of
      // read_public_presentation_session (that RPC performs the atomic
      // advance-if-due check as an internal side effect -- see the
      // 20260811430000 migration). This presenter-side call is a
      // supplementary trigger, not a requirement: it only matters when
      // no audience viewer is currently connected (e.g. rehearsal),
      // and this presenter closing does NOT stop auto-advance as long
      // as an audience screen remains open elsewhere.
      void supabase.rpc("advance_presentation_session_if_due", {
        p_session_id: sessionId,
      });
      void loadLiveSession(eventId);
    }, SESSION_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [eventId, session?.status, session?.id, loadLiveSession]);

  // Reconcile after a stale state_version conflict (a second presenter,
  // or this console's own prior command, already moved the session):
  // reload the authoritative row and say so plainly, rather than
  // retrying blindly or silently overwriting -- same reasoning as
  // app/admin/agenda/page.tsx's reconcileAfterStaleVersion.
  async function reconcileAfterStaleVersion() {
    showError(
      "Another presenter changed this session. Reloaded the current state -- please review before retrying.",
    );
    if (eventId) {
      await loadLiveSession(eventId);
    }
  }

  async function handleStart() {
    if (!selectedDeckId || busy) {
      return;
    }
    setBusy(true);
    showStatus("Starting presentation...");

    const { data, error: startError } = await supabase.rpc(
      "start_presentation_session",
      { p_deck_id: selectedDeckId },
    );

    if (startError) {
      showError(
        mapPresentationRpcError(
          new Error(startError.message),
          "Could not start the presentation.",
        ),
      );
      setBusy(false);
      return;
    }

    const row = data as PresentationSession;
    setSession(row);
    await loadSessionItems(row.id, row.current_index);
    showStatus("Presentation started.");
    setBusy(false);
  }

  type ControlRpc =
    | "pause_presentation_session"
    | "resume_presentation_session"
    | "next_presentation_slide"
    | "previous_presentation_slide"
    | "end_presentation_session";

  // Shared control path for every session mutation after start. Always
  // sends the session's currently-known state_version (Stage 4's
  // optimistic-concurrency contract) and, on success, adopts the RPC's
  // own returned row as the new authoritative state -- never a locally
  // guessed value. A stale_version response routes to reconciliation
  // instead of a generic error.
  async function runControl(
    rpcName: ControlRpc,
    pendingMessage: string,
    successMessage: string,
  ) {
    if (!session || busy) {
      return;
    }
    setBusy(true);
    showStatus(pendingMessage);

    const { data, error: controlError } = await supabase.rpc(rpcName, {
      p_session_id: session.id,
      p_expected_version: session.state_version,
    });

    if (controlError) {
      if (isStalePresentationVersionError(new Error(controlError.message))) {
        await reconcileAfterStaleVersion();
        setBusy(false);
        return;
      }
      showError(
        mapPresentationRpcError(
          new Error(controlError.message),
          "That action could not be completed.",
        ),
      );
      setBusy(false);
      return;
    }

    if (rpcName === "end_presentation_session") {
      setSession(null);
      setItems([]);
      setCurrentPhoto(null);
      setNextPhoto(null);
      setSelectedDeckId("");
      showStatus("Presentation ended.");
      setBusy(false);
      if (eventId) {
        void loadDecks(eventId);
      }
      return;
    }

    const row = data as PresentationSession;
    setSession(row);
    await loadSessionItems(row.id, row.current_index);
    if (successMessage) {
      showStatus(successMessage);
    } else {
      setStatus("");
      setError("");
    }
    setBusy(false);
  }

  const handlePause = () =>
    runControl("pause_presentation_session", "Pausing...", "Paused.");
  const handleResume = () =>
    runControl("resume_presentation_session", "Resuming...", "Live.");
  const handleNext = () =>
    runControl("next_presentation_slide", "Advancing...", "");
  const handlePrevious = () =>
    runControl("previous_presentation_slide", "Going back...", "");

  function handleEnd() {
    if (!session || busy) {
      return;
    }
    if (
      !window.confirm(
        "End this presentation for the audience? This cannot be undone -- you can start a new one afterward.",
      )
    ) {
      return;
    }
    void runControl("end_presentation_session", "Ending presentation...", "");
  }

  if (hasSlideshowAccess !== true) {
    return (
      <div
        style={{
          background: "#111",
          color: "white",
          padding: 24,
        }}
      >
        <div>
          {hasSlideshowAccess === null
            ? "No admin working event selected."
            : "You do not have Slideshow management authority for this event."}
        </div>
      </div>
    );
  }

  const isLive = session?.status === "live";
  const isPlaying = isLive && session?.playback_state === "playing";
  const currentPosition = session ? session.current_index + 1 : 0;
  const totalSlides = items.length;
  const isFirstSlide = session ? session.current_index <= 0 : true;
  const isLastSlide = session ? session.current_index >= totalSlides - 1 : true;

  // Audience-launch transitional decision (Stage 5 Part 12, option B):
  // the session id is appended as ?session=<id> so the URL shape is
  // already correct for Stage 6, but app/slideshow/view/page.tsx does
  // not read that param yet -- it is inert today, not functional live
  // sync. The button is disabled entirely (not merely mislabeled) when
  // there is no live session, since "launch the audience screen" would
  // otherwise imply a live show that does not exist.
  const audienceUrl = session
    ? `/slideshow/view?session=${session.id}`
    : null;

  return (
    <div
      style={{
        background: "#111",
        color: "white",
      }}
    >
      <p style={{ opacity: 0.8 }}>
        Governed by the durable Presentation deck/session foundation.
      </p>

      {status ? (
        <div style={{ marginTop: 12, color: "#4ade80" }}>{status}</div>
      ) : null}
      {error ? (
        <div style={{ marginTop: 12, color: "#f87171" }}>{error}</div>
      ) : null}

      {!isLive ? (
        <div
          style={{
            marginTop: 24,
            border: "1px solid #444",
            borderRadius: 8,
            padding: 20,
            background: "#161616",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Start a Presentation</h3>

          {decks === null ? (
            <div style={{ opacity: 0.7 }}>Loading presentation decks...</div>
          ) : decks.length === 0 ? (
            <div style={{ opacity: 0.8 }}>
              No presentation deck exists for this event yet. Create a
              presentation deck before starting the audience screen.
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                gap: 16,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <select
                value={selectedDeckId}
                onChange={(e) => setSelectedDeckId(e.target.value)}
                style={{
                  padding: 8,
                  minWidth: 260,
                  maxWidth: "100%",
                  wordBreak: "break-word",
                }}
              >
                <option value="">Select a deck...</option>
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name} ({deck.selection_mode === "all_approved"
                      ? "all approved photos"
                      : `manual, ${deck.item_count} item${deck.item_count === 1 ? "" : "s"}`}
                    , {Math.round(deck.default_duration_ms / 1000)}s/slide)
                  </option>
                ))}
              </select>

              <AppButton
                variant="start"
                onClick={handleStart}
                disabled={!selectedDeckId || busy}
              >
                Start Presentation
              </AppButton>
            </div>
          )}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
          marginTop: 24,
        }}
      >
        <div
          style={{
            border: "1px solid #444",
            borderRadius: 8,
            padding: 16,
            minHeight: 320,
          }}
        >
          <h3>Current Slide</h3>
          {currentPhoto?.url ? (
            <>
              <img
                src={currentPhoto.url}
                alt="Current"
                style={{ width: "100%", maxHeight: 340, objectFit: "contain" }}
              />
              {currentPhoto.caption ? (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
                  {currentPhoto.caption}
                </div>
              ) : null}
            </>
          ) : (
            <div style={{ opacity: 0.6, marginTop: 12 }}>
              {isLive ? "No renderable content for this slide." : "No live presentation."}
            </div>
          )}
        </div>

        <div
          style={{
            border: "1px solid #444",
            borderRadius: 8,
            padding: 16,
            minHeight: 320,
          }}
        >
          <h3>Next Slide</h3>
          {nextPhoto?.url ? (
            <>
              <img
                src={nextPhoto.url}
                alt="Next"
                style={{ width: "100%", maxHeight: 340, objectFit: "contain" }}
              />
              {nextPhoto.caption ? (
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
                  {nextPhoto.caption}
                </div>
              ) : null}
            </>
          ) : (
            <div style={{ opacity: 0.6, marginTop: 12 }}>
              {isLive && !isLastSlide
                ? "No renderable content for the next slide."
                : "End of deck."}
            </div>
          )}
        </div>
      </div>

      {isLive && items.length > 1 ? (
        <div
          style={{
            marginTop: 16,
            overflowX: "auto",
            display: "flex",
            gap: 6,
            paddingBottom: 4,
          }}
        >
          {items.map((item) => (
            <div
              key={item.id}
              title={`Slide ${item.sequence_number + 1}`}
              style={{
                flex: "0 0 auto",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background:
                  item.sequence_number === session?.current_index
                    ? "#4ade80"
                    : "#444",
              }}
            />
          ))}
        </div>
      ) : null}

      <div
        style={{
          marginTop: 24,
          border: "1px solid #444",
          borderRadius: 8,
          padding: 20,
          background: "#161616",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <AppButton
            variant="success"
            disabled={!audienceUrl}
            title={
              audienceUrl
                ? "Opens the legacy audience display. Full live-session sync arrives in Stage 6."
                : "Start a presentation before opening the audience screen."
            }
            onClick={() => {
              if (audienceUrl) {
                window.open(audienceUrl, "_blank");
              }
            }}
          >
            Open Audience Screen
          </AppButton>
          {audienceUrl ? (
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.6 }}>
              Opens the current legacy audience display. Full live-session
              sync arrives in Stage 6.
            </div>
          ) : null}
        </div>
      </div>

      <div
        style={{
          marginTop: 24,
          border: "1px solid #444",
          borderRadius: 8,
          padding: 20,
          background: "#161616",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          <h3 style={{ margin: 0 }}>Show Control</h3>
          <div
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              background: isLive
                ? isPlaying
                  ? "#14532d"
                  : "#78350f"
                : "#3f3f46",
              color: isLive ? (isPlaying ? "#4ade80" : "#fbbf24") : "#a1a1aa",
              fontWeight: "bold",
              fontSize: 12,
            }}
          >
            {isLive ? (isPlaying ? "● LIVE" : "❙❙ PAUSED") : "○ NOT LIVE"}
          </div>
          {isLive ? (
            <div style={{ opacity: 0.7, fontSize: 13 }}>
              Slide {currentPosition} of {totalSlides}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: 12,
          }}
        >
          {isPlaying ? (
            <AppButton
              variant="stop"
              onClick={handlePause}
              disabled={!isLive || busy}
            >
              Pause
            </AppButton>
          ) : (
            <AppButton
              variant="start"
              onClick={handleResume}
              disabled={!isLive || busy}
            >
              Resume
            </AppButton>
          )}
          <AppButton
            variant="muted"
            onClick={handlePrevious}
            disabled={!isLive || busy || isFirstSlide}
          >
            ⬅ Previous
          </AppButton>
          <AppButton
            variant="primary"
            onClick={handleNext}
            disabled={!isLive || busy || isLastSlide}
          >
            Next ➡
          </AppButton>
          <AppButton
            variant="danger"
            onClick={handleEnd}
            disabled={!isLive || busy}
          >
            End Presentation
          </AppButton>
        </div>
      </div>
    </div>
  );
}
