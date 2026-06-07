// components/map/canvas/useMapInteraction.ts
//
// Authoring interaction layer — the SINGLE shared pipeline for the gestures
// that the viewport engine (GestureMapViewportV2) does not own: marquee/lasso
// selection and (reserved) marker drag. Built touch-first.
//
// Disambiguation that keeps this from becoming a second gesture system:
//   - single-finger immediate drag on empty space  -> PAN  (left to V2)
//   - plain left-drag (mouse) past threshold       -> MARQUEE (claimed here)
//   - Shift+drag (mouse) immediate                 -> MARQUEE (claimed here)
//   - long-press (touch) on empty                  -> MARQUEE (claimed here)
//   - two-finger                                   -> PINCH (left to V2)
//   - tap on empty (editable)                      -> PLACE (via V2 onTap)
//   - tap / shift-tap on a marker                  -> SELECT (MarkerLayer onClick)
//
// Key rule: lockViewport() is NEVER called in onPointerDown for plain mouse
// drags. It is called only inside beginMarquee(), which is only reached after
// movement exceeds moveThresholdPx in onPointerMove. This keeps V2 free to pan
// until we are certain the user is drawing a rectangle, not tapping.

import { useEffect, useRef } from "react";

import { screenToPercent, type Size } from "./coords";
import type { MapPercentPoint, SelectionMode, ViewTransform } from "./types";

type Args = {
  /** the viewport element whose rect defines screen origin and that receives pointers */
  viewportRef: React.RefObject<HTMLElement | null>;
  getTransform: () => ViewTransform;
  natural: Size;
  selectionMode: SelectionMode;
  enabled: boolean;
  longPressMs?: number;
  moveThresholdPx?: number;

  onMarqueeStart?: (p: MapPercentPoint) => void;
  onMarqueeUpdate?: (a: MapPercentPoint, b: MapPercentPoint) => void;
  onMarqueeEnd?: (a: MapPercentPoint, b: MapPercentPoint) => void;

  lockViewport?: () => void;
  unlockViewport?: () => void;
};

export function useMapInteraction(args: Args) {
  const {
    viewportRef,
    getTransform,
    natural,
    selectionMode,
    enabled,
    longPressMs = 350,
    moveThresholdPx = 8,
    onMarqueeStart,
    onMarqueeUpdate,
    onMarqueeEnd,
    lockViewport,
    unlockViewport,
  } = args;

  // keep latest args in a ref so the effect closure never goes stale
  const ref = useRef(args);
  ref.current = args;

  useEffect(() => {
    const el = viewportRef.current;
    if (
      !el ||
      !enabled ||
      selectionMode === "none" ||
      selectionMode === "single"
    ) {
      return;
    }

    let armed = false; // marquee actively drawing
    let pointerId: number | null = null;
    let startPct: MapPercentPoint | null = null;
    let startScreen: { x: number; y: number } | null = null;
    let longPressTimer: number | null = null;

    const a = () => ref.current; // always-live args

    const toPct = (clientX: number, clientY: number): MapPercentPoint => {
      const rect = el.getBoundingClientRect();
      const { xPct, yPct } = screenToPercent(
        clientX - rect.left,
        clientY - rect.top,
        a().getTransform(),
        a().natural,
      );
      return { xPct, yPct };
    };

    const isOnMarker = (target: EventTarget | null) =>
      !!(target as HTMLElement | null)?.closest?.("[data-marker-id]");

    // Arm the marquee. Called only after we are committed to a drag gesture
    // (either Shift+down, long-press, or plain-drag past threshold).
    const beginMarquee = (clientX: number, clientY: number) => {
      armed = true;
      startPct = toPct(clientX, clientY);
      a().lockViewport?.(); // suspend V2 pan for the duration
      a().onMarqueeStart?.(startPct);
    };

    const clearLongPress = () => {
      if (longPressTimer != null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    // ── pointerdown ──────────────────────────────────────────────────────────
    const onPointerDown = (e: PointerEvent) => {
      if (e.button != null && e.button !== 0) {
        return;
      } // primary button only
      if (isOnMarker(e.target)) {
        return;
      } // markers handled by MarkerLayer

      pointerId = e.pointerId;
      startScreen = { x: e.clientX, y: e.clientY };

      const shift = e.shiftKey;

      if (e.pointerType === "mouse") {
        if (shift) {
          // Shift+click: arm immediately, same as before.
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            /* noop */
          }
          e.preventDefault();
          beginMarquee(e.clientX, e.clientY);
        }
        // Plain left-drag: do NOT arm yet. startScreen is recorded above.
        // onPointerMove will call beginMarquee once the threshold is crossed.
        // This keeps V2's pan handler free until we are certain.
      } else {
        // Touch: arm on long-press; early movement cancels and yields to V2 pan.
        clearLongPress();
        longPressTimer = window.setTimeout(() => {
          if (pointerId === e.pointerId && startScreen) {
            try {
              el.setPointerCapture(e.pointerId);
            } catch {
              /* noop */
            }
            beginMarquee(startScreen.x, startScreen.y);
          }
        }, a().longPressMs ?? longPressMs);
      }
    };

    // ── pointermove ──────────────────────────────────────────────────────────
    const onPointerMove = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) {
        return;
      }

      if (!armed) {
        if (!startScreen) {
          return;
        }

        const dx = Math.abs(e.clientX - startScreen.x);
        const dy = Math.abs(e.clientY - startScreen.y);
        const threshold = a().moveThresholdPx ?? moveThresholdPx;

        if (dx > threshold || dy > threshold) {
          if (e.pointerType === "mouse") {
            // Plain mouse drag has exceeded threshold — commit to marquee now.
            // Capture the pointer so we receive events outside the element,
            // lock the viewport so V2 stops panning, then start the rectangle
            // from the original down position (not the current position) so
            // the rect origin matches where the user first pressed.
            try {
              el.setPointerCapture(e.pointerId);
            } catch {
              /* noop */
            }
            beginMarquee(startScreen.x, startScreen.y);
            // Immediately push the current position so the rect is visible.
            if (startPct) {
              a().onMarqueeUpdate?.(startPct, toPct(e.clientX, e.clientY));
            }
          } else {
            // Touch moved before long-press fired → pan intent, cancel timer.
            clearLongPress();
          }
        }
        return;
      }

      // Marquee is armed — update the live rectangle.
      e.preventDefault();
      if (startPct) {
        a().onMarqueeUpdate?.(startPct, toPct(e.clientX, e.clientY));
      }
    };

    // ── pointerup / pointercancel ────────────────────────────────────────────
    const finish = (e: PointerEvent) => {
      clearLongPress();
      if (pointerId !== e.pointerId) {
        return;
      }

      if (armed && startPct) {
        e.preventDefault();
        a().onMarqueeEnd?.(startPct, toPct(e.clientX, e.clientY));
        a().unlockViewport?.();
      }

      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }

      armed = false;
      pointerId = null;
      startPct = null;
      startScreen = null;
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);

    return () => {
      clearLongPress();
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", finish);
      el.removeEventListener("pointercancel", finish);
    };

    // re-attach only when structural inputs change
  }, [viewportRef, enabled, selectionMode, longPressMs, moveThresholdPx]);
}
