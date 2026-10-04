"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import PresentationSlideImage, { PREVIEW_HEIGHT } from "@/app/slideshow/view/PresentationSlideImage";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { PageSection } from "@/components/ui/PageSection";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  getCurrentAdminEvent,
  useAdminWorkingEventScope,
} from "@/lib/adminWorkspaceContext";
import { type PresentationFrame,presentationFrame } from "@/lib/presentationPlayback";
import {
  EVENT_SCOPED_STORAGE_KEYS,
  SLIDESHOW_AUDIENCE_MESSAGES,
  STORAGE_KEYS,
} from "@/lib/storageKeys";
import { supabase } from "@/lib/supabase";

// One server-confirmed frame drives both previews and the paired audience.
const SESSION_REFRESH_INTERVAL_MS = 1000;

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

type ManualDeckItem = {
  id: string;
  content_ref_id: string | null;
  sort_order: number;
};

type AvailableApprovedPhoto = {
  id: string;
  member_caption: string | null;
  admin_caption: string | null;
  uploaded_at: string;
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
  invalid_slide: "That slide is not part of this presentation.",
  invalid_name: "Please enter a deck name.",
  invalid_default_duration_ms: "Slide duration must be between 1 and 300 seconds.",
  invalid_selection_mode: "Please choose a valid selection mode.",
  deck_has_items:
    "Remove this deck's manual items before switching it to All Approved Photos.",
  deck_not_manual: "Only Manual Selection decks can be edited here.",
  photo_not_found: "That photo is no longer available.",
  photo_event_mismatch: "That photo belongs to a different event.",
  photo_not_approved: "Only approved photos can be added to this deck.",
  photo_already_in_deck: "That photo is already in this deck.",
  item_not_found: "That deck item no longer exists.",
  item_set_mismatch:
    "This deck changed elsewhere. Its current order has been reloaded.",
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

// The random token pairing this presenter tab with the audience window it
// opened for an Event. sessionStorage keeps it across a presenter refresh in
// the same tab only; the in-memory copy covers storage being unavailable.
// Window handles live here too, keyed by link, because the presenter
// component can remount (for example on an Admin auth refresh) while its
// audience window stays open.
const audienceLinks = new Map<string, string>();
const audienceWindows = new Map<string, Window>();

function audienceLinkFor(eventId: string): string {
  const key = EVENT_SCOPED_STORAGE_KEYS.slideshowAudienceLink(eventId);
  let link = audienceLinks.get(eventId) ?? null;
  try {
    link = link ?? window.sessionStorage.getItem(key);
  } catch {}
  if (!link) {
    link = crypto.randomUUID();
  }
  audienceLinks.set(eventId, link);
  try {
    window.sessionStorage.setItem(key, link);
  } catch {}
  return link;
}

export default function AdminSlideshowPage() {
  return (
    <AdminRouteGuard requiredTask="event.slideshow.manage">
      <AdminShellAdapter
        pageTitle="Slideshow Presenter"
        backTarget={{ href: "/admin/photos", label: "Photos" }}
      >
        <AdminSlideshowPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

function AdminSlideshowPageInner() {
  // Page-access authority (event.slideshow.manage for the current admin
  // working Event) is now owned entirely by AdminRouteGuard's
  // requiredTask -- this component never mounts without it already
  // being granted. What remains here is Event-context tracking for
  // this page's OWN data loading (deck list, live session, restart
  // candidate) -- a separate concern
  // from access, re-read on every Admin working-Event change via the
  // same canonical subscription so this page's own data reloads for
  // the newly selected Event, not to recheck authority.
  const [eventId, setEventId] = useState<string | null>(null);

  const syncCurrentAdminEvent = useCallback(() => {
    const adminEvent = getCurrentAdminEvent();
    setEventId(adminEvent?.id ?? null);
  }, []);

  useEffect(() => {
    syncCurrentAdminEvent();
  }, [syncCurrentAdminEvent]);

  const [audienceDisplayMode, setAudienceDisplayMode] = useState<"tab" | "window">("tab");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEYS.slideshowAudienceDisplayMode);
      if (saved === "tab" || saved === "window") { setAudienceDisplayMode(saved); }
    } catch {}
  }, []);

  function changeAudienceDisplayMode(mode: "tab" | "window") {
    setAudienceDisplayMode(mode);
    try {
      window.localStorage.setItem(STORAGE_KEYS.slideshowAudienceDisplayMode, mode);
    } catch {}
  }

  const [decks, setDecks] = useState<PresentationDeck[] | null>(null);
  const [selectedDeckId, setSelectedDeckId] = useState<string>("");
  // Presenter Restart State Repair: the deck id of this Event's most
  // recently ended presentation session, restored on load/reload and set
  // again by explicit End -- compared against selectedDeckId only to
  // decide the Start button's label ("Start Again" vs "Start
  // Presentation"). It never itself gates or starts anything; handleStart
  // always uses selectedDeckId, exactly as before this repair.
  const [restartCandidateDeckId, setRestartCandidateDeckId] = useState<
    string | null
  >(null);
  const [manualDeckItems, setManualDeckItems] = useState<ManualDeckItem[]>([]);
  const [availableApprovedPhotos, setAvailableApprovedPhotos] = useState<
    AvailableApprovedPhoto[]
  >([]);
  const [manualDeckLoading, setManualDeckLoading] = useState(false);
  const [manualDeckActionBusy, setManualDeckActionBusy] = useState(false);

  // Deck authoring (Stage 6B). Additive to the existing deck-selection
  // surface -- creation/edit/archive all route through the same
  // governed RPCs Stage 3 already built (create_presentation_deck,
  // update_presentation_deck, archive_presentation_deck). No new
  // Presentation table write, no new authority model: every call below
  // is gated server-side by the same event.slideshow.manage check the
  // session RPCs already use.
  const [showCreateDeckForm, setShowCreateDeckForm] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const [newDeckDescription, setNewDeckDescription] = useState("");
  const [newDeckSelectionMode, setNewDeckSelectionMode] = useState<
    "all_approved" | "manual"
  >("all_approved");
  const [newDeckDurationSeconds, setNewDeckDurationSeconds] = useState(8);
  const [deckActionBusy, setDeckActionBusy] = useState(false);
  // Archive/End confirmation now routes through the canonical ConfirmDialog
  // instead of window.confirm -- same two consequential actions, same
  // gating, only the presentation primitive changed.
  const [archiveConfirmDeck, setArchiveConfirmDeck] =
    useState<PresentationDeck | null>(null);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  const [editDeckName, setEditDeckName] = useState("");
  const [editDeckDescription, setEditDeckDescription] = useState("");
  const [editDeckSelectionMode, setEditDeckSelectionMode] = useState<
    "all_approved" | "manual"
  >("all_approved");
  const [editDeckDurationSeconds, setEditDeckDurationSeconds] = useState(8);
  const [session, setSession] = useState<PresentationSession | null>(null);
  const [items, setItems] = useState<PresentationSessionItem[]>([]);
  const [preview, setPreview] = useState<PresentationFrame | null>(null);
  const previewRef = useRef<{ sessionId: string; frame: PresentationFrame | null; readAt: number } | null>(null);
  const loadedItemsSessionRef = useRef<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Request generation rejects work superseded by a command, Event switch,
  // or effect cleanup. Server state_version independently rejects older rows
  // even when their requests happened to finish last.
  const stateGenerationRef = useRef(0);
  const acceptedSessionRef = useRef<{ id: string; version: number } | null>(
    null,
  );

  // Presenter Restart State Repair: canonical-event guard for
  // loadRestartCandidate's two sequential awaited reads. Kept in sync by
  // its own effect below (eventId state -> ref) so a restore triggered
  // for one Event, still in flight when the admin switches to a
  // different Event, is discarded rather than applied into the newly
  // selected Event's UI -- the same "compare against the current truth,
  // not which request started/finished when" discipline acceptSessionRow
  // already uses for session rows.
  const eventIdRef = useRef<string | null>(null);

  const publishPreview = useCallback((sessionId: string, frame: PresentationFrame | null) => {
    previewRef.current = { sessionId, frame, readAt: Date.now() };
    setPreview(frame);
    const currentEventId = eventIdRef.current;
    if (!currentEventId) { return; }
    const link = audienceLinkFor(currentEventId);
    const audience = audienceWindows.get(link);
    if (audience && !audience.closed) {
      audience.postMessage({ type: SLIDESHOW_AUDIENCE_MESSAGES.frame, link, sessionId, frame }, window.location.origin);
    }
  }, []);

  const clearPreview = useCallback((notifyEnded = true) => {
    if (notifyEnded && previewRef.current) {
      publishPreview(previewRef.current.sessionId, presentationFrame({ session_active: false }));
    }
    previewRef.current = null;
    loadedItemsSessionRef.current = null;
    setPreview(null);
  }, [publishPreview]);

  // The single gate every session row -- from a poll, Start, or any
  // control RPC -- must pass through before it is allowed to update
  // `session`. Returns whether the row was applied. A different session
  // id (a fresh Start, or reconnect after the previous one ended) is
  // always accepted, since state_version only orders rows WITHIN one
  // session's lifetime, not across different sessions. A `null` (no
  // live session) is always accepted here -- callers are responsible
  // for only reaching this point with a null they still trust (the
  // generation guard already ensures that), since a lifecycle
  // transition to "ended"/"not found" carries no version of its own to
  // compare. An equal version is accepted (a same-position refresh),
  // never treated as regression; only a STRICTLY older version for the
  // SAME session id is rejected.
  function acceptSessionRow(row: PresentationSession | null): boolean {
    if (row === null) {
      acceptedSessionRef.current = null;
      setSession(null);
      return true;
    }

    const accepted = acceptedSessionRef.current;
    if (
      accepted &&
      accepted.id === row.id &&
      row.state_version < accepted.version
    ) {
      return false;
    }

    acceptedSessionRef.current = { id: row.id, version: row.state_version };
    setSession(row);
    return true;
  }

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
  // decks only -- archived decks (Stage 6B's Archive action) drop out
  // of this list automatically since it's the same query used to
  // populate it initially.
  const loadDecks = useCallback(async (currentEventId: string) => {
    const { data, error: loadError } = await supabase
      .from("presentation_decks")
      .select(
        "id, name, selection_mode, default_duration_ms, lifecycle_status, presentation_deck_items(count)",
      )
      .eq("event_id", currentEventId)
      .eq("lifecycle_status", "active")
      .order("created_at", { ascending: false });

    // The working Event changed while this was in flight (e.g. a stale
    // mutation's follow-up reload): never apply Event A's decks to Event B.
    // Matches loadLiveSession/loadRestartCandidate's own guard.
    if (eventIdRef.current !== currentEventId) {
      return;
    }

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

  // Manual deck authoring reads only the selected deck's ordered items and
  // this Event's approved-photo pool. The governing RPCs still enforce the
  // same Event, approved status, duplicate prohibition, and authority at
  // mutation time; these queries only provide a bounded authoring view.
  const loadManualDeckAuthoring = useCallback(
    async (deckId: string, currentEventId: string) => {
      setManualDeckLoading(true);

      const [itemsResult, photosResult] = await Promise.all([
        supabase
          .from("presentation_deck_items")
          .select("id, content_ref_id, sort_order")
          .eq("deck_id", deckId)
          .order("sort_order", { ascending: true }),
        supabase
          .from("event_photos")
          .select("id, member_caption, admin_caption, uploaded_at")
          .eq("event_id", currentEventId)
          .eq("photo_status", "approved")
          .order("uploaded_at", { ascending: false }),
      ]);

      if (itemsResult.error || photosResult.error) {
        console.error(
          "Failed to load Manual deck authoring data",
          itemsResult.error || photosResult.error,
        );
        setManualDeckItems([]);
        setAvailableApprovedPhotos([]);
        setManualDeckLoading(false);
        return;
      }

      setManualDeckItems((itemsResult.data || []) as ManualDeckItem[]);
      setAvailableApprovedPhotos(
        (photosResult.data || []) as AvailableApprovedPhoto[],
      );
      setManualDeckLoading(false);
    },
    [],
  );

  // Deck authoring handlers (Stage 6B). Each calls the exact governed
  // RPC Stage 3 already exposes -- no direct presentation_decks write
  // exists or is added here. Server bounds (name non-blank, duration
  // 1000-300000ms, selection_mode validity, deck_has_items on an
  // unsafe manual->all_approved switch) are treated as authoritative:
  // this UI does not re-implement them, only surfaces the RPC's own
  // error via mapPresentationRpcError.
  async function handleCreateDeck() {
    if (!eventId || deckActionBusy) {
      return;
    }
    if (!newDeckName.trim()) {
      showError("Please enter a deck name.");
      return;
    }

    setDeckActionBusy(true);
    showStatus("Creating deck...");

    const { data, error: createError } = await supabase.rpc(
      "create_presentation_deck",
      {
        p_event_id: eventId,
        p_name: newDeckName.trim(),
        p_description: newDeckDescription.trim() || null,
        p_default_duration_ms: Math.round(newDeckDurationSeconds * 1000),
        p_selection_mode: newDeckSelectionMode,
      },
    );

    if (createError) {
      showError(
        mapPresentationRpcError(
          new Error(createError.message),
          "Could not create the deck.",
        ),
      );
      setDeckActionBusy(false);
      return;
    }

    const created = data as { id: string; name: string };
    await loadDecks(eventId);
    setSelectedDeckId(created.id);
    setNewDeckName("");
    setNewDeckDescription("");
    setNewDeckSelectionMode("all_approved");
    setNewDeckDurationSeconds(8);
    setShowCreateDeckForm(false);
    showStatus(`Deck "${created.name}" created and selected.`);
    setDeckActionBusy(false);
  }

  function startEditDeck(deck: PresentationDeck) {
    setEditingDeckId(deck.id);
    setEditDeckName(deck.name);
    setEditDeckDescription("");
    setEditDeckSelectionMode(deck.selection_mode);
    setEditDeckDurationSeconds(Math.round(deck.default_duration_ms / 1000));
  }

  function cancelEditDeck() {
    setEditingDeckId(null);
  }

  async function handleSaveEditDeck() {
    if (!editingDeckId || !eventId || deckActionBusy) {
      return;
    }
    if (!editDeckName.trim()) {
      showError("Please enter a deck name.");
      return;
    }

    setDeckActionBusy(true);
    showStatus("Saving deck...");

    const { error: updateError } = await supabase.rpc(
      "update_presentation_deck",
      {
        p_deck_id: editingDeckId,
        p_name: editDeckName.trim(),
        p_description: editDeckDescription.trim() || null,
        p_default_duration_ms: Math.round(editDeckDurationSeconds * 1000),
        p_selection_mode: editDeckSelectionMode,
      },
    );

    if (updateError) {
      showError(
        mapPresentationRpcError(
          new Error(updateError.message),
          "Could not update the deck.",
        ),
      );
      setDeckActionBusy(false);
      return;
    }

    await loadDecks(eventId);
    setEditingDeckId(null);
    showStatus("Deck updated.");
    setDeckActionBusy(false);
  }

  async function handleArchiveDeck(deck: PresentationDeck) {
    if (!eventId || deckActionBusy) {
      return;
    }

    setDeckActionBusy(true);
    showStatus("Archiving deck...");

    const { error: archiveError } = await supabase.rpc(
      "archive_presentation_deck",
      { p_deck_id: deck.id },
    );

    if (archiveError) {
      showError(
        mapPresentationRpcError(
          new Error(archiveError.message),
          "Could not archive the deck.",
        ),
      );
      setDeckActionBusy(false);
      return;
    }

    if (selectedDeckId === deck.id) {
      setSelectedDeckId("");
    }
    if (editingDeckId === deck.id) {
      setEditingDeckId(null);
    }
    await loadDecks(eventId);
    showStatus(`Deck "${deck.name}" archived.`);
    setDeckActionBusy(false);
  }

  const loadSessionItems = useCallback(
    async (row: PresentationSession, generation: number) => {
      const sessionId = row.id;
      // Immutable session items serve the presenter's jump controls only.
      // Display eligibility, Current and Next come exclusively from the public
      // resolver, just as they do for an independently opened audience link.
      if (loadedItemsSessionRef.current !== sessionId) {
        const { data, error: itemsError } = await supabase
          .from("presentation_session_items")
          .select("id, content_type, content_ref_id, sequence_number, duration_ms")
          .eq("session_id", sessionId)
          .order("sequence_number", { ascending: true });
        if (generation !== stateGenerationRef.current) { return; }
        if (itemsError) { setItems([]); }
        else { setItems(data || []); loadedItemsSessionRef.current = sessionId; }
      }
      try {
        const { data, error } = await supabase.rpc("read_public_presentation_session", { p_session_id: sessionId });
        if (generation !== stateGenerationRef.current) { return; }
        if (error) { throw error; }
        const frame = presentationFrame(Array.isArray(data) ? data[0] : null);
        if (!frame) { throw new Error("Invalid presentation response"); }
        const accepted = acceptedSessionRef.current;
        if (!accepted || accepted.id !== sessionId ||
            (frame.session_active && frame.state_version! < accepted.version)) { return; }
        if (frame.session_active) {
          acceptSessionRow({ ...row, current_index: frame.sequence_number!,
            state_version: frame.state_version!, playback_state: frame.playback_state! });
        } else { acceptSessionRow(null); }

        publishPreview(sessionId, frame);
      } catch {
        if (generation === stateGenerationRef.current) {
          // Both displays clear on a failed authority read; never keep a
          // previously authorized photo indefinitely through a disconnection.
          publishPreview(sessionId, null);
        }
      }
    },
    [publishPreview],
  );

  // Session discovery/reconnect (Stage 5 Part 6): on load or refresh,
  // ask the database whether the current Event already has a live
  // session -- never create one merely because the page opened. This
  // is what makes presenter refresh durable: there is no browser-local
  // state to lose.
  const loadLiveSession = useCallback(
    async (currentEventId: string) => {
      const generation = ++stateGenerationRef.current;

      const { data, error: sessionError } = await supabase
        .from("presentation_sessions")
        .select("*")
        .eq("event_id", currentEventId)
        .eq("status", "live")
        .maybeSingle();

      if (generation !== stateGenerationRef.current) {
        // A newer state-changing call (manual action or a later refresh)
        // already started while this select was in flight -- discard
        // this now-stale request outright, before it can even reach the
        // version check below.
        return;
      }

      if (sessionError) {
        console.error("Failed to load presentation session", sessionError);
        if (previewRef.current) { publishPreview(previewRef.current.sessionId, null); }
        return;
      }

      const row = (data as PresentationSession | null) ?? null;

      // Even though this request is still the most recent one to have
      // started, its read may describe OLDER server state than a
      // mutation that resolved more recently (request order and
      // server-state order are not the same thing -- see the
      // acceptSessionRow comment above). acceptSessionRow is the actual
      // correctness gate; a stale row is discarded here regardless of
      // generation.
      if (!acceptSessionRow(row)) {
        return;
      }

      if (!row) {
        setItems([]);
        clearPreview();
      } else {
        await loadSessionItems(row, generation);
      }
    },
    [loadSessionItems, clearPreview, publishPreview],
  );

  // Presenter Restart State Repair (LEM CMD): on load/reload, ask whether
  // this exact Event's most recently ended presentation session's deck is
  // still an active, authorized deck for this exact Event, and if so
  // restore it as the selected/restart candidate. This never creates,
  // starts, or touches a session -- it only restores presenter UI state
  // that was always volatile (selectedDeckId lives only in this page's
  // React state; loadDecks reloading the durable deck list never
  // restored it, which is what left an ended presentation's deck
  // unselectable, with every session control disabled, after a refresh).
  // Both reads go through the same governed, RLS-scoped SELECT boundary
  // loadDecks/loadLiveSession already use -- no new table, RPC, or
  // authority path. An archived, missing, or cross-event deck is simply
  // never restored: the second query's own event_id + lifecycle_status =
  // 'active' filters (identical to loadDecks') are what enforce that,
  // not a client-side re-check of loadDecks' already-fetched list.
  const loadRestartCandidate = useCallback(async (currentEventId: string) => {
    const { data: endedSession, error: endedError } = await supabase
      .from("presentation_sessions")
      .select("deck_id")
      .eq("event_id", currentEventId)
      .eq("status", "ended")
      .order("ended_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (eventIdRef.current !== currentEventId) {
      return;
    }
    if (endedError || !endedSession) {
      return;
    }

    const { data: deckRow, error: deckError } = await supabase
      .from("presentation_decks")
      .select("id")
      .eq("id", endedSession.deck_id)
      .eq("event_id", currentEventId)
      .eq("lifecycle_status", "active")
      .maybeSingle();

    if (eventIdRef.current !== currentEventId) {
      return;
    }
    if (deckError || !deckRow) {
      return;
    }

    setSelectedDeckId(deckRow.id);
    setRestartCandidateDeckId(deckRow.id);
  }, []);

  useEffect(() => {
    if (!eventId) {
      return;
    }
    void loadDecks(eventId);
    void loadLiveSession(eventId);
    void loadRestartCandidate(eventId);
  }, [eventId, loadDecks, loadLiveSession, loadRestartCandidate]);

  const selectedDeck = decks?.find((deck) => deck.id === selectedDeckId) ?? null;
  const selectedManualDeckId =
    selectedDeck?.selection_mode === "manual" ? selectedDeck.id : null;
  const isRestartCandidate =
    !!selectedDeckId && selectedDeckId === restartCandidateDeckId;

  useEffect(() => {
    eventIdRef.current = eventId;
    setSelectedDeckId("");
    setRestartCandidateDeckId(null);
  }, [eventId]);

  // Working-Event change (this tab or another): synchronously drop Event A's
  // deck list / live session / selection so Start can never be pressed for an
  // Event A deck while the header reads Event B, and supersede any in-flight
  // reads. The eventId state update then drives the reload effect above.
  useAdminWorkingEventScope(() => {
    stateGenerationRef.current += 1;
    setDecks(null);
    setSelectedDeckId("");
    setItems([]);
    clearPreview(false);
    // session is only ever cleared/set through acceptSessionRow (its
    // documented single write path); a null row resets acceptedSessionRef.
    acceptSessionRow(null);
    syncCurrentAdminEvent();
  });

  useEffect(() => {
    if (!selectedManualDeckId || !eventId) {
      setManualDeckItems([]);
      setAvailableApprovedPhotos([]);
      setManualDeckLoading(false);
      return;
    }

    void loadManualDeckAuthoring(selectedManualDeckId, eventId);
  }, [eventId, loadManualDeckAuthoring, selectedManualDeckId]);

  async function refreshManualDeckAuthoring(deckId: string) {
    if (!eventId) {
      return;
    }
    await Promise.all([
      loadDecks(eventId),
      loadManualDeckAuthoring(deckId, eventId),
    ]);
  }

  async function addManualDeckPhoto(photoId: string) {
    if (!selectedDeck || selectedDeck.selection_mode !== "manual") {
      return;
    }

    setManualDeckActionBusy(true);
    const { error: addError } = await supabase.rpc(
      "add_presentation_deck_photo",
      {
        p_deck_id: selectedDeck.id,
        p_photo_id: photoId,
        p_duration_ms: null,
      },
    );

    if (addError) {
      showError(
        mapPresentationRpcError(
          new Error(addError.message),
          "Could not add that photo to the deck.",
        ),
      );
      setManualDeckActionBusy(false);
      return;
    }

    await refreshManualDeckAuthoring(selectedDeck.id);
    showStatus("Photo added to the deck.");
    setManualDeckActionBusy(false);
  }

  async function removeManualDeckItem(itemId: string) {
    if (!selectedDeck || selectedDeck.selection_mode !== "manual") {
      return;
    }

    setManualDeckActionBusy(true);
    const { error: removeError } = await supabase.rpc(
      "remove_presentation_deck_item",
      { p_item_id: itemId },
    );

    if (removeError) {
      showError(
        mapPresentationRpcError(
          new Error(removeError.message),
          "Could not remove that photo from the deck.",
        ),
      );
      setManualDeckActionBusy(false);
      return;
    }

    await refreshManualDeckAuthoring(selectedDeck.id);
    showStatus("Photo removed from the deck.");
    setManualDeckActionBusy(false);
  }

  async function moveManualDeckItem(itemId: string, direction: -1 | 1) {
    if (!selectedDeck || selectedDeck.selection_mode !== "manual") {
      return;
    }

    const itemIndex = manualDeckItems.findIndex((item) => item.id === itemId);
    const nextIndex = itemIndex + direction;
    if (itemIndex < 0 || nextIndex < 0 || nextIndex >= manualDeckItems.length) {
      return;
    }

    const orderedItemIds = manualDeckItems.map((item) => item.id);
    [orderedItemIds[itemIndex], orderedItemIds[nextIndex]] = [
      orderedItemIds[nextIndex],
      orderedItemIds[itemIndex],
    ];

    setManualDeckActionBusy(true);
    const { error: reorderError } = await supabase.rpc(
      "reorder_presentation_deck_items",
      {
        p_deck_id: selectedDeck.id,
        p_item_ids: orderedItemIds,
      },
    );

    if (reorderError) {
      showError(
        mapPresentationRpcError(
          new Error(reorderError.message),
          "Could not reorder this deck. Its current order has been reloaded.",
        ),
      );
      await refreshManualDeckAuthoring(selectedDeck.id);
      setManualDeckActionBusy(false);
      return;
    }

    await refreshManualDeckAuthoring(selectedDeck.id);
    showStatus("Deck order updated.");
    setManualDeckActionBusy(false);
  }

  useEffect(() => {
    if (!eventId || session?.status !== "live") {
      return;
    }
    let refreshing = false;
    // Clearing the interval cannot stop a tick already awaiting advancement;
    // this flag stops that tick from reading once its Event or session has
    // been replaced, ended or unmounted.
    let cancelled = false;
    const timer = setInterval(() => {
      // read_public_presentation_session performs the governed advance-if-due
      // check. Paired audiences consume this very response, not a second poll.
      if (refreshing) { return; }
      refreshing = true;
      void (async () => {
        try {
          if (!cancelled && eventIdRef.current === eventId) {
            await loadLiveSession(eventId);
          }
        } finally {
          refreshing = false;
        }
      })();
    }, SESSION_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      ++stateGenerationRef.current;
      clearInterval(timer);
    };
  }, [eventId, session?.status, session?.id, loadLiveSession]);

  // A presenter-opened audience window reports the session it shows once a
  // second. Answer only our own window for this Event's link, on this origin,
  // with this Event's live session, so End followed by Start reconnects it.
  const liveSessionId = session?.status === "live" ? session.id : null;
  useEffect(() => {
    if (!eventId) {
      return;
    }
    const link = audienceLinkFor(eventId);
    // After End this tab stops refreshing, so a show restarted from another
    // presenter tab or device would never reach the audience it opened. While
    // that audience keeps reporting, look up this Event's live session.
    let discovering = false;

    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      const source = event.source as Window | null;
      if (
        event.origin !== window.location.origin ||
        !source ||
        source.opener !== window ||
        data?.type !== SLIDESHOW_AUDIENCE_MESSAGES.status ||
        data.link !== link
      ) {
        return;
      }
      audienceWindows.set(link, source);
      if (!liveSessionId && !discovering) {
        discovering = true;
        void loadLiveSession(eventId).finally(() => { discovering = false; });
      }
      if (liveSessionId && data.sessionId !== liveSessionId) {
        source.postMessage(
          { type: SLIDESHOW_AUDIENCE_MESSAGES.session, link, sessionId: liveSessionId },
          window.location.origin,
        );
      }
      const snapshot = previewRef.current;
      if (snapshot && data.sessionId === snapshot.sessionId && Date.now() - snapshot.readAt < 2500) {
        source.postMessage({ type: SLIDESHOW_AUDIENCE_MESSAGES.frame, link, ...snapshot }, window.location.origin);
      }

    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [eventId, liveSessionId, loadLiveSession]);

  // Reuse this Event's audience window while it is open; otherwise open one.
  // Must run from the click itself so the browser permits the popup.
  function openAudienceScreen() {
    if (!eventId || !liveSessionId) {
      return;
    }
    const link = audienceLinkFor(eventId);
    const existing = audienceWindows.get(link);
    if (existing && !existing.closed) {
      existing.postMessage(
        { type: SLIDESHOW_AUDIENCE_MESSAGES.session, link, sessionId: liveSessionId },
        window.location.origin,
      );
      // Chromium leaves fullscreen when focus() reaches a fullscreen window,
      // so bring the window forward only while it is not presenting.
      let presenting = false;
      try {
        const audienceDocument = existing.document as Document & {
          webkitFullscreenElement?: Element | null;
        };
        presenting = Boolean(
          audienceDocument.fullscreenElement ??
            audienceDocument.webkitFullscreenElement,
        );
      } catch {}
      if (!presenting) {
        existing.focus();
      }
      return;
    }
    const opened = window.open(
      `/slideshow/view?session=${liveSessionId}&link=${link}`,
      // Naming the window by its link lets a click right after a presenter
      // refresh reuse it rather than open a second one.
      link,
      audienceDisplayMode === "window" ? "popup=yes,width=1280,height=800" : undefined,
    );
    if (!opened) {
      showError(
        "The browser blocked the audience screen. Allow pop-ups for this site, then try again.",
      );
      return;
    }
    audienceWindows.set(link, opened);
  }

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

    if (eventIdRef.current !== eventId) { setBusy(false); return; }

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

    const generation = ++stateGenerationRef.current;
    const row = data as PresentationSession;
    // A brand-new session always carries a different id from whatever
    // was previously accepted (or none), so acceptSessionRow always
    // applies it -- the version check only ever rejects an older row
    // for the SAME session id.
    if (acceptSessionRow(row)) {
      await loadSessionItems(row, generation);
    }
    showStatus("Presentation started.");
    setBusy(false);
  }

  type ControlRpc =
    | "pause_presentation_session"
    | "resume_presentation_session"
    | "next_presentation_slide"
    | "previous_presentation_slide"
    | "jump_presentation_slide"
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
    args: Record<string, number> = {},
  ) {
    if (!session || busy) {
      return;
    }
    setBusy(true);
    showStatus(pendingMessage);

    let { data, error: controlError } = await supabase.rpc(rpcName, {
      p_session_id: session.id,
      p_expected_version: session.state_version,
      ...args,
    });

    if (eventIdRef.current !== eventId) { setBusy(false); return; }

    // End targets this session, not a slide position. A looping session's
    // timed advance moves state_version between this console's refreshes,
    // so a confirmed End retries once with the authoritative version when
    // the same session is still live. The RPC still enforces that version.
    if (
      rpcName === "end_presentation_session" &&
      controlError &&
      isStalePresentationVersionError(new Error(controlError.message))
    ) {
      const { data: liveRow } = await supabase
        .from("presentation_sessions")
        .select("state_version")
        .eq("id", session.id)
        .eq("status", "live")
        .maybeSingle();
      if (eventIdRef.current !== eventId) { setBusy(false); return; }
      if (liveRow) {
        ({ data, error: controlError } = await supabase.rpc(rpcName, {
          p_session_id: session.id,
          p_expected_version: liveRow.state_version,
        }));
      }
    }

    if (eventIdRef.current !== eventId) { setBusy(false); return; }

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
      // Bump the generation even though nothing here awaits further --
      // this is what invalidates any still-in-flight loadLiveSession
      // (e.g. from the periodic refresh) so a late-arriving stale response
      // cannot resurrect session/items/photo state after End.
      ++stateGenerationRef.current;
      // Presenter Restart State Repair: the ended session's own deck
      // stays selected as the restart candidate -- End no longer blanks
      // selectedDeckId. This is what makes the deck restartable
      // immediately, in the same console session, without depending on a
      // reload to run loadRestartCandidate.
      setSelectedDeckId(session.deck_id);
      setRestartCandidateDeckId(session.deck_id);
      acceptSessionRow(null);
      setItems([]);
      clearPreview();
      showStatus("Presentation ended.");
      setBusy(false);
      if (eventId) {
        void loadDecks(eventId);
      }
      return;
    }

    const generation = ++stateGenerationRef.current;
    const row = data as PresentationSession;
    // This response is this session's own current_index/state_version
    // moving forward by exactly one from what THIS call itself sent as
    // p_expected_version, so it is only ever rejected here in the
    // pathological case where an even newer mutation (e.g. from a
    // second presenter) already advanced further before this response
    // arrived -- correctly keeping the newer state on screen instead.
    if (acceptSessionRow(row)) {
      await loadSessionItems(row, generation);
    }
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
  // One atomic server move to an existing session position; the order fixed
  // at Start and the playing/paused state are unchanged.
  const handleJump = (sequenceNumber: number) =>
    runControl("jump_presentation_slide", "Changing slide...", "", {
      p_sequence_number: sequenceNumber,
    });

  function handleEnd() {
    if (!session || busy) {
      return;
    }
    setShowEndConfirm(true);
  }

  const isLive = session?.status === "live";
  const isPlaying = isLive && session?.playback_state === "playing";
  const currentPosition = session ? session.current_index + 1 : 0;
  const totalSlides = items.length;
  const isFirstSlide = session ? session.current_index <= 0 : true;
  const isLastSlide = session ? session.current_index >= totalSlides - 1 : true;

  // Audience links carry a session capability. Pairing is scoped to the
  // opener's Event link and never discovers a session from an Event ID.
  // otherwise imply a live show that does not exist.
  const audienceUrl = session
    ? `/slideshow/view?session=${session.id}`
    : null;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <PageSection title="Presentation Preview">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
          {/* Stable photo keys retain the decoded Next image when it moves into
              Current. CSS placement changes; the mounted image does not. */}
          {(["current", "next"] as const).map((slot, index) => (
            <h3 key={slot} style={{ gridColumn: index + 1, gridRow: 1 }}>{slot === "current" ? "Current Slide" : "Next Slide"}</h3>
          ))}
          {preview?.session_active && liveSessionId ? (
            (["current", "next"] as const).map((slot, index) => {
              const photoId = slot === "current" ? preview.current_content_ref_id : preview.next_content_ref_id;
              const type = slot === "current" ? preview.current_content_type : preview.next_content_type;
              // A one-photo loop has the same content in both panes. The second
              // instance is distinct only in that special case.
              const duplicate = slot === "next" && photoId === preview.current_content_ref_id;
              return type === "photo" && photoId ? (
                <PresentationSlideImage key={`${liveSessionId}:${photoId}${duplicate ? ":duplicate" : ""}`}
                  sessionId={liveSessionId} contentRefId={photoId} slot={slot}
                  caption={null} photographerName={null} previewColumn={index + 1} />
              ) : <div key={`blank:${slot}`} style={{ gridColumn: index + 1, gridRow: 2, height: PREVIEW_HEIGHT, background: "#000" }} />;
            })
          ) : <div style={{ gridColumn: "1 / -1", height: isLive ? PREVIEW_HEIGHT : undefined, minHeight: 80, color: "var(--color-text-muted)" }}>{isLive ? "Loading presentation..." : "No live presentation."}</div>}
        </div>

        {isLive && items.length > 1 ? (
          <div
            role="group"
            aria-label="Choose slide"
            style={{
              marginTop: 16,
              display: "flex",
              flexWrap: "wrap",
            }}
          >
            {/* Keyboard focus draws a ring around the round marker, never a
                square around the 45px target; box-shadow cannot move layout. */}
            <style>{`
              .slideshow-dot:focus-visible {
                outline: none;
              }
              .slideshow-dot:focus-visible > span {
                box-shadow: 0 0 0 3px var(--color-bg-panel), 0 0 0 5px var(--color-focus-ring);
              }
            `}</style>
            {/* Each dot keeps a full touch target around its small visual mark;
                long decks wrap into rows so every dot stays visible. */}
            {items.map((item) => {
              const isCurrent = item.sequence_number === session?.current_index;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="slideshow-dot"
                  aria-label={`Slide ${item.sequence_number + 1} of ${totalSlides}`}
                  aria-current={isCurrent ? "true" : undefined}
                  title={`Slide ${item.sequence_number + 1}`}
                  // aria-disabled, not disabled: disabling the focused dot
                  // would drop keyboard focus to the page during each jump.
                  aria-disabled={busy || undefined}
                  onClick={() => { if (!busy) { void handleJump(item.sequence_number); } }}
                  style={{
                    flex: "0 0 auto",
                    width: "var(--touch-target-min)",
                    height: "var(--touch-target-min)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                    border: "none",
                    borderRadius: 8,
                    background: "transparent",
                    cursor: busy ? "default" : "pointer",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: isCurrent ? 14 : 10,
                      height: isCurrent ? 14 : 10,
                      borderRadius: "50%",
                      background: isCurrent
                        ? "var(--color-selected)"
                        : "var(--color-border-strong)",
                    }}
                  />
                </button>
              );
            })}
          </div>
        ) : null}

      </PageSection>

      {/* Status sits below the previews and dots so its changes never move them.
          While live, a one-line slot is kept so clearing a message cannot
          shorten the page and pull the scroll position (and the dots) up. */}
      {isLive || status || error ? (
        <div style={{ display: "grid", gap: 20, minHeight: isLive ? 45 : undefined }}>
          {status ? <Alert tone="info">{status}</Alert> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      ) : null}

      <PageSection title="Show Control">
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <Field label="Open audience in">
            {(controlProps) => (
              <Select
                {...controlProps}
                value={audienceDisplayMode}
                onChange={(event) => changeAudienceDisplayMode(event.target.value as "tab" | "window")}
              >
                <option value="tab">Tab</option>
                <option value="window">Separate window</option>
              </Select>
            )}
          </Field>
          <AppButton
            variant="primary"
            disabled={!audienceUrl}
            title={
              audienceUrl
                ? "Opens or reuses the audience screen for this presentation."
                : "Start a presentation before opening the audience screen."
            }
            onClick={openAudienceScreen}
          >
            Open Audience Screen
          </AppButton>
          {audienceUrl ? (
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.6 }}>
              An open audience screen is reused. Close it to change where it opens.
              Browser settings may affect whether a tab or window opens.
            </div>
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          <StatusBadge tone={isLive ? (isPlaying ? "success" : "warning") : "neutral"}>
            {isLive ? (isPlaying ? "Live" : "Paused") : "Not live"}
          </StatusBadge>
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
            // Pause is an ordinary, reversible control action -- not a
            // destructive/termination step -- so it takes the same
            // secondary treatment as Previous, per AppButton's own
            // "stop" scoping (reserved for a Dialog/ConfirmDialog
            // Confirm step only, never a general "stop/end this" button).
            <AppButton
              variant="secondary"
              onClick={handlePause}
              disabled={!isLive || busy}
            >
              Pause
            </AppButton>
          ) : (
            <AppButton
              variant="primary"
              onClick={handleResume}
              disabled={!isLive || busy}
            >
              Resume
            </AppButton>
          )}
          <AppButton
            variant="secondary"
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
      </PageSection>

      {!isLive ? (
        <PageSection title="Prepare a Presentation">

          {decks === null ? (
            <div style={{ opacity: 0.7 }}>Loading presentation decks...</div>
          ) : (
            <>
              {decks.length === 0 ? (
                <div style={{ opacity: 0.8, marginBottom: 16 }}>
                  No presentation deck exists for this event yet. Create a
                  presentation deck before starting the audience screen.
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    marginBottom: 16,
                  }}
                >
                  {decks.map((deck) =>
                    editingDeckId === deck.id ? (
                      <div
                        key={deck.id}
                        style={{
                          border: "1px solid var(--color-selected)",
                          borderRadius: 8,
                          padding: 12,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          <Field label="Deck name">
                            {(controlProps) => (
                              <Input
                                {...controlProps}
                                value={editDeckName}
                                onChange={(e) => setEditDeckName(e.target.value)}
                              />
                            )}
                          </Field>
                          <Field label="Description (optional)">
                            {(controlProps) => (
                              <Input
                                {...controlProps}
                                value={editDeckDescription}
                                onChange={(e) => setEditDeckDescription(e.target.value)}
                              />
                            )}
                          </Field>
                          <div
                            style={{
                              display: "flex",
                              gap: 16,
                              flexWrap: "wrap",
                              alignItems: "center",
                            }}
                          >
                            <Field label="Selection">
                              {(controlProps) => (
                                <Select
                                  {...controlProps}
                                  value={editDeckSelectionMode}
                                  onChange={(e) => setEditDeckSelectionMode(e.target.value as "all_approved" | "manual")}
                                >
                                  <option value="all_approved">All Approved Photos</option>
                                  <option value="manual">Manual Selection</option>
                                </Select>
                              )}
                            </Field>
                            <Field label="Duration (seconds/slide)">
                              {(controlProps) => (
                                <Input
                                  {...controlProps}
                                  type="number"
                                  min={1}
                                  value={editDeckDurationSeconds}
                                  onChange={(e) => setEditDeckDurationSeconds(Number(e.target.value) || 1)}
                                />
                              )}
                            </Field>
                          </div>
                          <FormActions>
                            <AppButton
                              variant="primary"
                              onClick={handleSaveEditDeck}
                              disabled={deckActionBusy || !editDeckName.trim()}
                            >
                              Save
                            </AppButton>
                            <AppButton
                              variant="secondary"
                              onClick={cancelEditDeck}
                              disabled={deckActionBusy}
                            >
                              Cancel
                            </AppButton>
                          </FormActions>
                        </div>
                      </div>
                    ) : (
                      <div
                        key={deck.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          flexWrap: "wrap",
                          border:
                            selectedDeckId === deck.id
                              ? "1px solid var(--color-selected)"
                              : "1px solid var(--color-border-default)",
                          borderRadius: 8,
                          padding: 12,
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            flex: "1 1 240px",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="radio"
                            name="deck-select"
                            checked={selectedDeckId === deck.id}
                            onChange={() => setSelectedDeckId(deck.id)}
                          />
                          <span style={{ wordBreak: "break-word" }}>
                            <strong>{deck.name}</strong>
                            <div style={{ fontSize: 12, opacity: 0.7 }}>
                              {deck.selection_mode === "all_approved"
                                ? "All approved photos"
                                : `Manual, ${deck.item_count} item${deck.item_count === 1 ? "" : "s"}`}
                              {" · "}
                              {Math.round(deck.default_duration_ms / 1000)}
                              s/slide
                            </div>
                          </span>
                        </label>
                        <FormActions>
                          <AppButton
                            variant="secondary"
                            onClick={() => startEditDeck(deck)}
                            disabled={deckActionBusy}
                          >
                            Edit
                          </AppButton>
                          <AppButton
                            variant="danger"
                            onClick={() => setArchiveConfirmDeck(deck)}
                            disabled={deckActionBusy}
                          >
                            Archive
                          </AppButton>
                        </FormActions>
                      </div>
                    ),
                  )}
                </div>
              )}

              <FormActions>
                <AppButton
                  variant="primary"
                  onClick={handleStart}
                  disabled={
                    !selectedDeckId ||
                    busy ||
                    (selectedDeck?.selection_mode === "manual" &&
                      (manualDeckLoading || manualDeckItems.length === 0))
                  }
                >
                  {isRestartCandidate ? "Start Again" : "Start Presentation"}
                </AppButton>
                <AppButton
                  variant="secondary"
                  onClick={() => setShowCreateDeckForm((v) => !v)}
                  disabled={deckActionBusy}
                >
                  {showCreateDeckForm ? "Cancel" : "+ Create New Deck"}
                </AppButton>
              </FormActions>

              {showCreateDeckForm ? (
                <div
                  style={{
                    marginTop: 16,
                    border: "1px solid var(--color-border-default)",
                    borderRadius: 8,
                    padding: 16,
                    background: "var(--color-bg-muted)",
                  }}
                >
                  <h4 style={{ marginTop: 0 }}>Create Deck</h4>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 10 }}
                  >
                    <Field label="Deck name">
                      {(controlProps) => (
                        <Input
                          {...controlProps}
                          value={newDeckName}
                          onChange={(e) => setNewDeckName(e.target.value)}
                        />
                      )}
                    </Field>
                    <Field label="Description (optional)">
                      {(controlProps) => (
                        <Input
                          {...controlProps}
                          value={newDeckDescription}
                          onChange={(e) => setNewDeckDescription(e.target.value)}
                        />
                      )}
                    </Field>
                    <div
                      style={{
                        display: "flex",
                        gap: 16,
                        flexWrap: "wrap",
                        alignItems: "flex-end",
                      }}
                    >
                      <Field label="Selection">
                        {(controlProps) => (
                          <Select
                            {...controlProps}
                            value={newDeckSelectionMode}
                            onChange={(e) => setNewDeckSelectionMode(e.target.value as "all_approved" | "manual")}
                          >
                            <option value="all_approved">All Approved Photos</option>
                            <option value="manual">Manual Selection</option>
                          </Select>
                        )}
                      </Field>
                      <Field label="Duration (seconds/slide)">
                        {(controlProps) => (
                          <Input
                            {...controlProps}
                            type="number"
                            min={1}
                            value={newDeckDurationSeconds}
                            onChange={(e) => setNewDeckDurationSeconds(Number(e.target.value) || 1)}
                          />
                        )}
                      </Field>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      {newDeckSelectionMode === "all_approved"
                        ? "All currently approved Event photos are included when the presentation starts."
                        : "This deck will start with 0 items. Add photos to it before starting a presentation."}
                    </div>
                    <div>
                      <AppButton
                        variant="primary"
                        onClick={handleCreateDeck}
                        disabled={deckActionBusy || !newDeckName.trim()}
                      >
                        Create Deck
                      </AppButton>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </PageSection>
      ) : null}

      {!isLive && selectedDeck?.selection_mode === "manual" ? (
        <section
          aria-label="Manual deck authoring"
        >
          <PageSection title={`Manual Deck: ${selectedDeck.name}`}>
          <p style={{ marginTop: 0, opacity: 0.75 }}>
            Arrange the photos exactly as this presentation should play.
            Changes are saved to this event&apos;s deck before starting.
          </p>

          {manualDeckLoading ? (
            <div style={{ opacity: 0.7 }}>Loading deck photos...</div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 20,
              }}
            >
              <div>
                <h4 style={{ marginTop: 0 }}>Deck Photos</h4>
                {manualDeckItems.length === 0 ? (
                  <div style={{ opacity: 0.75 }}>
                    This Manual deck is empty. Add approved photos before
                    starting a presentation.
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {manualDeckItems.map((item, index) => {
                      const photo = availableApprovedPhotos.find(
                        (availablePhoto) =>
                          availablePhoto.id === item.content_ref_id,
                      );
                      const photoLabel = photo
                        ? photo.admin_caption?.trim() ||
                          photo.member_caption?.trim() ||
                          `Photo ${photo.id.slice(0, 8)}`
                        : `Photo ${item.content_ref_id?.slice(0, 8) || "unavailable"}`;

                      return (
                        <div
                          key={item.id}
                          style={{
                            border: "1px solid var(--color-border-default)",
                            borderRadius: 6,
                            padding: 10,
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            flexWrap: "wrap",
                          }}
                        >
                          <strong style={{ minWidth: 24 }}>{index + 1}</strong>
                          <div style={{ flex: "1 1 140px", minWidth: 0 }}>
                            <div style={{ overflowWrap: "anywhere" }}>
                              {photoLabel}
                            </div>
                            {!photo ? (
                              <div style={{ fontSize: 12, opacity: 0.65 }}>
                                No longer approved or available. It will be
                                skipped when a session is started.
                              </div>
                            ) : null}
                          </div>
                          <FormActions>
                            <AppButton
                              variant="secondary"
                              onClick={() => void moveManualDeckItem(item.id, -1)}
                              disabled={manualDeckActionBusy || index === 0}
                            >
                              Move Up
                            </AppButton>
                            <AppButton
                              variant="secondary"
                              onClick={() => void moveManualDeckItem(item.id, 1)}
                              disabled={
                                manualDeckActionBusy ||
                                index === manualDeckItems.length - 1
                              }
                            >
                              Move Down
                            </AppButton>
                            <AppButton
                              variant="danger"
                              onClick={() => void removeManualDeckItem(item.id)}
                              disabled={manualDeckActionBusy}
                            >
                              Remove
                            </AppButton>
                          </FormActions>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <h4 style={{ marginTop: 0 }}>Available Approved Photos</h4>
                {availableApprovedPhotos.filter(
                  (photo) =>
                    !manualDeckItems.some(
                      (item) => item.content_ref_id === photo.id,
                    ),
                ).length === 0 ? (
                  <div style={{ opacity: 0.75 }}>
                    No additional approved photos are available for this event.
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {availableApprovedPhotos
                      .filter(
                        (photo) =>
                          !manualDeckItems.some(
                            (item) => item.content_ref_id === photo.id,
                          ),
                      )
                      .map((photo) => (
                        <div
                          key={photo.id}
                          style={{
                            border: "1px solid var(--color-border-default)",
                            borderRadius: 6,
                            padding: 10,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            flexWrap: "wrap",
                          }}
                        >
                          <div style={{ flex: "1 1 140px", minWidth: 0 }}>
                            <div style={{ overflowWrap: "anywhere" }}>
                              {photo.admin_caption?.trim() ||
                                photo.member_caption?.trim() ||
                                `Photo ${photo.id.slice(0, 8)}`}
                            </div>
                            <div style={{ fontSize: 12, opacity: 0.65 }}>
                              Added {new Date(photo.uploaded_at).toLocaleString()}
                            </div>
                          </div>
                          <AppButton
                            variant="primary"
                            onClick={() => void addManualDeckPhoto(photo.id)}
                            disabled={manualDeckActionBusy}
                          >
                            Add
                          </AppButton>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
          </PageSection>
        </section>
      ) : null}

      <ConfirmDialog
        open={archiveConfirmDeck !== null}
        title="Archive deck?"
        message={
          archiveConfirmDeck
            ? `Archive "${archiveConfirmDeck.name}"? It will no longer be available to start a presentation.`
            : ""
        }
        danger
        busy={deckActionBusy}
        onConfirm={async () => {
          const deck = archiveConfirmDeck;
          if (deck) {
            await handleArchiveDeck(deck);
          }
          setArchiveConfirmDeck(null);
        }}
        onCancel={() => setArchiveConfirmDeck(null)}
      />

      <ConfirmDialog
        open={showEndConfirm}
        title="End presentation?"
        message="End this presentation for the audience? This cannot be undone -- you can start a new one afterward."
        danger
        busy={busy}
        onConfirm={async () => {
          setShowEndConfirm(false);
          await runControl("end_presentation_session", "Ending presentation...", "");
        }}
        onCancel={() => setShowEndConfirm(false)}
      />
    </div>
  );
}
