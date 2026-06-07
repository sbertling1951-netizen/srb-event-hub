// components/map/canvas/useMapInteraction.ts
//
// Authoring interaction layer — the SINGLE shared pipeline for the gestures
// that the viewport engine (GestureMapViewportV2) does not own: marquee/lasso
// selection and (reserved) marker drag. Built touch-first.
//
// Disambiguation that keeps this from becoming a second gesture system:
//   - single-finger immediate drag on empty space  -> PAN  (left to V2)
//   - long-press (touch) or Shift+drag (desktop) on empty -> MARQUEE (claimed here)
//   - two-finger                                     -> PINCH (left to V2)
//   - tap on empty (editable)                        -> PLACE (via V2 onTap)
//   - tap / shift-tap on a marker                    -> SELECT (MarkerLayer onClick)
//
// Desktop marquee requires Shift held during the drag. selectionMode="rectangle"
// enables this hook but does NOT itself trigger marquee capture — that would
// override V2 pan for every unmodified drag. Shift is the explicit signal.
//
// When this layer claims a gesture it (a) calls lockViewport() so V2 suspends
// pan for the duration, (b) captures the pointer, (c) preventDefaults. On
// release it unlocks. The lockViewport/unlockViewport + getTransform seam are
// the two small additions required on GestureMapViewportV2 (see README).

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

  // keep latest args in a ref so the effect can attach once
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

    let armed = false; // marquee active
    let pointerId: number | null = null;
    let startPct: MapPercentPoint | null = null;
    let startScreen: { x: number; y: number } | null = null;
    let longPressTimer: number | null = null;

    const a = () => ref.current; // live args

    const toPct = (clientX: number, clientY: number): MapPercentPoint => {
      const rect = el.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const { xPct, yPct } = screenToPercent(
        sx,
        sy,
        a().getTransform(),
        a().natural,
      );
      return { xPct, yPct };
    };

    const isOnMarker = (target: EventTarget | null) =>
      !!(target as HTMLElement | null)?.closest?.("[data-marker-id]");

    const beginMarquee = (clientX: number, clientY: number) => {
      armed = true;
      startPct = toPct(clientX, clientY);
      a().lockViewport?.();
      a().onMarqueeStart?.(startPct);
    };

    const clearLongPress = () => {
      if (longPressTimer != null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button != null && e.button !== 0) {
        return;
      } // primary only
      if (isOnMarker(e.target)) {
        return;
      } // marker handled by MarkerLayer

      pointerId = e.pointerId;
      startScreen = { x: e.clientX, y: e.clientY };

      if (e.pointerType === "mouse") {
        // Desktop marquee requires Shift — matching the design spec:
        // "Shift+drag (desktop) -> MARQUEE". An unmodified desktop drag is
        // always a pan (V2). selectionMode enables this hook but does not
        // itself claim the pointer; only Shift does.
        if (e.shiftKey) {
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            /* noop */
          }
          e.preventDefault();
          beginMarquee(e.clientX, e.clientY);
        }
        // No Shift = fall through, V2 handles pan normally.
      } else {
        // Touch: arm on long-press; if the finger moves first it becomes a pan (V2).
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

    const onPointerMove = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) {
        return;
      }

      if (!armed) {
        if (startScreen) {
          const dx = Math.abs(e.clientX - startScreen.x);
          const dy = Math.abs(e.clientY - startScreen.y);
          if (dx > moveThresholdPx || dy > moveThresholdPx) {
            if (e.pointerType !== "mouse") {
              // Touch moved past threshold before long-press fired — pan intent.
              // Cancel long-press and yield to V2.
              clearLongPress();
            } else if (e.shiftKey) {
              // Shift was not held at pointerdown but is held now during the
              // drag — arm the marquee from the original press position.
              try {
                el.setPointerCapture(e.pointerId);
              } catch {
                /* noop */
              }
              e.preventDefault();
              beginMarquee(startScreen.x, startScreen.y);
            }
            // No Shift on desktop = unmodified pan, stay out of V2's way.
          }
        }
        return;
      }

      // Marquee is armed — update the rectangle.
      e.preventDefault();
      if (startPct) {
        a().onMarqueeUpdate?.(startPct, toPct(e.clientX, e.clientY));
      }
    };

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
    // re-attach only when these structural inputs change
  }, [viewportRef, enabled, selectionMode, longPressMs, moveThresholdPx]);
}
