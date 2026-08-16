"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  const [eventName, setEventName] = useState<string | null>(null);

  const checkSlideshowAccess = useCallback(async () => {
    const adminEvent = getCurrentAdminEvent();
    setEventId(adminEvent?.id ?? null);
    setEventName(adminEvent?.name ?? adminEvent?.eventName ?? null);

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
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  const [editDeckName, setEditDeckName] = useState("");
  const [editDeckDescription, setEditDeckDescription] = useState("");
  const [editDeckSelectionMode, setEditDeckSelectionMode] = useState<
    "all_approved" | "manual"
  >("all_approved");
  const [editDeckDurationSeconds, setEditDeckDurationSeconds] = useState(8);
  const [session, setSession] = useState<PresentationSession | null>(null);
  const [items, setItems] = useState<PresentationSessionItem[]>([]);
  const [currentPhoto, setCurrentPhoto] = useState<ResolvedPhoto | null>(
    null,
  );
  const [nextPhoto, setNextPhoto] = useState<ResolvedPhoto | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Presentation-diagnostic fix, revised after a semantic-ordering review.
  // session/items/currentPhoto/nextPhoto are populated by independent
  // async calls from four call sites (loadLiveSession's 5s interval +
  // initial load, handleStart, and runControl's five RPCs), and
  // loadSessionItems itself performs two SEQUENTIAL awaited network
  // round-trips -- by far the slowest path of the four.
  //
  // Two distinct problems, two distinct mechanisms:
  //
  // 1. A REQUEST can be superseded by a newer one before it resolves
  //    (e.g. a slow poll's photo-resolution completing after a manual
  //    Next already moved on). `stateGenerationRef` is a monotonic
  //    request-liveness stamp for this: claimed before async work,
  //    checked before applying a result, discarded if stale. This is
  //    the same discipline app/slideshow/view/page.tsx already uses
  //    (its `cancelled` closure flags per effect), generalized to a
  //    single ref because the guard spans multiple call sites, not one
  //    effect's own cleanup. It is a REQUEST-ordering tool only.
  //
  // 2. Request order is NOT the same thing as server-state order.
  //    Concretely: runControl claims its generation AFTER its mutation
  //    RPC already resolved, so a slower poll that both claimed an
  //    EARLIER generation and started its read earlier can still have
  //    its (correctly-not-yet-stale-by-generation) response describe
  //    OLDER server state than a mutation that resolves later. Freshness
  //    must be decided by the durable, already-authoritative
  //    `presentation_sessions.state_version` (strictly monotonic for a
  //    session's lifetime; every governed mutation and the Stage 6A
  //    timed-advance increment it by exactly one; a boundary no-op
  //    correctly leaves it unchanged) -- never by which request merely
  //    started or finished more recently. `acceptedSessionRef` is the
  //    high-water mark for this: every candidate row, regardless of
  //    origin, is checked against it before being applied.
  const stateGenerationRef = useRef(0);
  const acceptedSessionRef = useRef<{ id: string; version: number } | null>(
    null,
  );

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
    if (
      !window.confirm(
        `Archive "${deck.name}"? It will no longer be available to start a presentation.`,
      )
    ) {
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
    async (sessionId: string, currentIndex: number, generation: number) => {
      const { data, error: itemsError } = await supabase
        .from("presentation_session_items")
        .select("id, content_type, content_ref_id, sequence_number, duration_ms")
        .eq("session_id", sessionId)
        .order("sequence_number", { ascending: true });

      if (generation !== stateGenerationRef.current) {
        return;
      }

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

      const resolvedCurrent =
        current?.content_type === "photo"
          ? await resolvePhoto(current.content_ref_id)
          : null;
      if (generation !== stateGenerationRef.current) {
        return;
      }
      setCurrentPhoto(resolvedCurrent);

      const resolvedNext =
        next?.content_type === "photo"
          ? await resolvePhoto(next.content_ref_id)
          : null;
      if (generation !== stateGenerationRef.current) {
        return;
      }
      setNextPhoto(resolvedNext);
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

      if (row) {
        await loadSessionItems(row.id, row.current_index, generation);
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

  const selectedDeck = decks?.find((deck) => deck.id === selectedDeckId) ?? null;
  const selectedManualDeckId =
    selectedDeck?.selection_mode === "manual" ? selectedDeck.id : null;

  useEffect(() => {
    setSelectedDeckId("");
  }, [eventId]);

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
      void (async () => {
        try {
          const { error: heartbeatError } = await supabase.rpc(
            "advance_presentation_session_if_due",
            { p_session_id: sessionId },
          );
          if (heartbeatError) {
            console.error(
              "Failed to advance presentation session heartbeat",
              heartbeatError,
            );
          }
        } catch (heartbeatError) {
          console.error(
            "Failed to advance presentation session heartbeat",
            heartbeatError,
          );
        }
      })();
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

    const generation = ++stateGenerationRef.current;
    const row = data as PresentationSession;
    // A brand-new session always carries a different id from whatever
    // was previously accepted (or none), so acceptSessionRow always
    // applies it -- the version check only ever rejects an older row
    // for the SAME session id.
    if (acceptSessionRow(row)) {
      await loadSessionItems(row.id, row.current_index, generation);
    }
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
      // Bump the generation even though nothing here awaits further --
      // this is what invalidates any still-in-flight loadLiveSession
      // (e.g. from the 5s interval) so a late-arriving stale response
      // cannot resurrect session/items/photo state after End.
      ++stateGenerationRef.current;
      acceptSessionRow(null);
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

    const generation = ++stateGenerationRef.current;
    const row = data as PresentationSession;
    // This response is this session's own current_index/state_version
    // moving forward by exactly one from what THIS call itself sent as
    // p_expected_version, so it is only ever rejected here in the
    // pathological case where an even newer mutation (e.g. from a
    // second presenter) already advanced further before this response
    // arrived -- correctly keeping the newer state on screen instead.
    if (acceptSessionRow(row)) {
      await loadSessionItems(row.id, row.current_index, generation);
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
      <p style={{ marginTop: -8, opacity: 0.7 }}>
        Controlling event: <strong>{eventName || "Unnamed event"}</strong>
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
                          border: "1px solid #4ade80",
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
                          <input
                            value={editDeckName}
                            onChange={(e) => setEditDeckName(e.target.value)}
                            placeholder="Deck name"
                            style={{ padding: 8 }}
                          />
                          <input
                            value={editDeckDescription}
                            onChange={(e) =>
                              setEditDeckDescription(e.target.value)
                            }
                            placeholder="Description (optional)"
                            style={{ padding: 8 }}
                          />
                          <div
                            style={{
                              display: "flex",
                              gap: 16,
                              flexWrap: "wrap",
                              alignItems: "center",
                            }}
                          >
                            <select
                              value={editDeckSelectionMode}
                              onChange={(e) =>
                                setEditDeckSelectionMode(
                                  e.target.value as "all_approved" | "manual",
                                )
                              }
                              style={{ padding: 8 }}
                            >
                              <option value="all_approved">
                                All Approved Photos
                              </option>
                              <option value="manual">Manual Selection</option>
                            </select>
                            <label
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              Duration:
                              <input
                                type="number"
                                min={1}
                                value={editDeckDurationSeconds}
                                onChange={(e) =>
                                  setEditDeckDurationSeconds(
                                    Number(e.target.value) || 1,
                                  )
                                }
                                style={{ width: 70, padding: 8 }}
                              />
                              sec/slide
                            </label>
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <AppButton
                              variant="start"
                              onClick={handleSaveEditDeck}
                              disabled={deckActionBusy || !editDeckName.trim()}
                            >
                              Save
                            </AppButton>
                            <AppButton
                              variant="muted"
                              onClick={cancelEditDeck}
                              disabled={deckActionBusy}
                            >
                              Cancel
                            </AppButton>
                          </div>
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
                              ? "1px solid #4ade80"
                              : "1px solid #333",
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
                        <div style={{ display: "flex", gap: 8 }}>
                          <AppButton
                            variant="muted"
                            onClick={() => startEditDeck(deck)}
                            disabled={deckActionBusy}
                          >
                            Edit
                          </AppButton>
                          <AppButton
                            variant="danger"
                            onClick={() => handleArchiveDeck(deck)}
                            disabled={deckActionBusy}
                          >
                            Archive
                          </AppButton>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  gap: 16,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <AppButton
                  variant="start"
                  onClick={handleStart}
                  disabled={
                    !selectedDeckId ||
                    busy ||
                    (selectedDeck?.selection_mode === "manual" &&
                      (manualDeckLoading || manualDeckItems.length === 0))
                  }
                >
                  Start Presentation
                </AppButton>
                <AppButton
                  variant="muted"
                  onClick={() => setShowCreateDeckForm((v) => !v)}
                  disabled={deckActionBusy}
                >
                  {showCreateDeckForm ? "Cancel" : "+ Create New Deck"}
                </AppButton>
              </div>

              {showCreateDeckForm ? (
                <div
                  style={{
                    marginTop: 16,
                    border: "1px solid #444",
                    borderRadius: 8,
                    padding: 16,
                    background: "#111",
                  }}
                >
                  <h4 style={{ marginTop: 0 }}>Create Deck</h4>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 10 }}
                  >
                    <input
                      value={newDeckName}
                      onChange={(e) => setNewDeckName(e.target.value)}
                      placeholder="Deck name (e.g. Amana26 Slideshow)"
                      style={{ padding: 8 }}
                    />
                    <input
                      value={newDeckDescription}
                      onChange={(e) => setNewDeckDescription(e.target.value)}
                      placeholder="Description (optional)"
                      style={{ padding: 8 }}
                    />
                    <div
                      style={{
                        display: "flex",
                        gap: 16,
                        flexWrap: "wrap",
                        alignItems: "flex-end",
                      }}
                    >
                      <label
                        style={{ display: "flex", flexDirection: "column", gap: 4 }}
                      >
                        Selection
                        <select
                          value={newDeckSelectionMode}
                          onChange={(e) =>
                            setNewDeckSelectionMode(
                              e.target.value as "all_approved" | "manual",
                            )
                          }
                          style={{ padding: 8 }}
                        >
                          <option value="all_approved">
                            All Approved Photos
                          </option>
                          <option value="manual">Manual Selection</option>
                        </select>
                      </label>
                      <label
                        style={{ display: "flex", flexDirection: "column", gap: 4 }}
                      >
                        Duration (seconds/slide)
                        <input
                          type="number"
                          min={1}
                          value={newDeckDurationSeconds}
                          onChange={(e) =>
                            setNewDeckDurationSeconds(
                              Number(e.target.value) || 1,
                            )
                          }
                          style={{ width: 100, padding: 8 }}
                        />
                      </label>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      {newDeckSelectionMode === "all_approved"
                        ? "All currently approved Event photos are included when the presentation starts."
                        : "This deck will start with 0 items. Add photos to it before starting a presentation."}
                    </div>
                    <div>
                      <AppButton
                        variant="start"
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
        </div>
      ) : null}

      {!isLive && selectedDeck?.selection_mode === "manual" ? (
        <section
          aria-label="Manual deck authoring"
          style={{
            marginTop: 24,
            border: "1px solid #444",
            borderRadius: 8,
            padding: 20,
            background: "#161616",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Manual Deck: {selectedDeck.name}</h3>
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
                            border: "1px solid #333",
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
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <AppButton
                              variant="muted"
                              onClick={() => void moveManualDeckItem(item.id, -1)}
                              disabled={manualDeckActionBusy || index === 0}
                            >
                              Move Up
                            </AppButton>
                            <AppButton
                              variant="muted"
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
                          </div>
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
                            border: "1px solid #333",
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
                            variant="start"
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
        </section>
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
