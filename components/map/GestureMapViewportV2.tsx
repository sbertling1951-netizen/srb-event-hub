"use client";

import { useDrag, usePinch, useWheel } from "@use-gesture/react";
import {
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";

type GestureMapViewportProps = {
  width: number;
  height: number;
  children?: ReactNode;
  minScale?: number;
  maxScale?: number;
  initialScale?: number;
  viewportHeight?: string | number;
  onTap?: (args: {
    screenX: number;
    screenY: number;
    mapX: number;
    mapY: number;
  }) => void;
};

export type GestureMapViewportHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  centerOn: (mapX: number, mapY: number, scale?: number) => void;
  getViewportTransform: () => { x: number; y: number; scale: number };
  setViewportTransform: (t: { x: number; y: number; scale: number }) => void;
  setGestureLocked: (locked: boolean) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Whether a touchend should let the browser's native click-synthesis
 * proceed (by skipping preventDefault) instead of the default cancel path
 * every other touchend outcome still takes. True only for a genuine,
 * unhurried single-finger tap -- never a drag, never a two-finger gesture
 * -- whose end point sits over an interactive [data-marker-id] element.
 * This is the exact, and only, contract MarkerLayer's onClick (or any
 * other consumer's own click handler on a marker/label element) depends
 * on to fire from a finger tap the same way it already fires from a mouse
 * click. Pure and DOM-independent beyond the supplied target's own
 * `closest` lookup, so it can be exercised directly by a test without a
 * real browser's touch-to-click synthesis (which no DOM test environment
 * implements).
 */
export function shouldAllowNativeClickThrough({
  tapCandidate,
  startedWithTwoTouches,
  target,
}: {
  tapCandidate: boolean;
  startedWithTwoTouches: boolean;
  target: { closest(selector: string): unknown } | null | undefined;
}): boolean {
  return (
    tapCandidate &&
    !startedWithTwoTouches &&
    !!target?.closest("[data-marker-id]")
  );
}

function clampPan(
  x: number,
  y: number,
  scale: number,
  viewportWidth: number,
  viewportHeight: number,
  contentWidth: number,
  contentHeight: number,
) {
  const scaledWidth = contentWidth * scale;
  const scaledHeight = contentHeight * scale;

  const overscrollX = Math.min(60, viewportWidth * 0.08);
  const overscrollY = Math.min(40, viewportHeight * 0.06);

  const minX = Math.min(0, viewportWidth - scaledWidth) - overscrollX;
  const minY = Math.min(0, viewportHeight - scaledHeight) - overscrollY;

  return {
    x:
      scaledWidth <= viewportWidth
        ? clamp(x, -overscrollX * 1.5, overscrollX * 1.5)
        : clamp(x, minX, overscrollX),

    y:
      scaledHeight <= viewportHeight
        ? clamp(y, -overscrollY * 1.5, overscrollY * 1.5)
        : clamp(y, minY, overscrollY),
  };
}

const GestureMapViewportV2 = forwardRef<
  GestureMapViewportHandle,
  GestureMapViewportProps
>(function GestureMapViewportV2(
  {
    width,
    height,
    children,
    minScale = 0.4,
    maxScale = 4,
    initialScale = 0.8,
    viewportHeight = "100dvh",
    onTap,
  }: GestureMapViewportProps,
  ref,
) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const onTapRef = useRef(onTap);

  useEffect(() => {
    onTapRef.current = onTap;
  }, [onTap]);

  // MapCanvas authoring layer + parity harness use these.
  const gestureLockedRef = useRef(false);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);

  const stateRef = useRef({
    x: 0,
    y: 0,
    scale: initialScale,
  });

  const rafRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);
  const isPinchingRef = useRef(false);
  // See useDrag's own callback for the full explanation: sticky for one
  // drag gesture, true once that gesture has ever been concurrent with a
  // second touch, so its own terminal event is skipped too even after
  // the touch count has already dropped back to 1.
  const dragSawMultiTouchRef = useRef(false);

  const momentumRef = useRef<{
    velocityX: number;
    velocityY: number;
    lastX: number;
    lastY: number;
    lastTime: number;
    active: boolean;
  }>({
    velocityX: 0,
    velocityY: 0,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
    active: false,
  });

  const centerOnPoint = (
    mapX: number,
    mapY: number,
    targetScale = stateRef.current.scale,
    animate = true,
  ) => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const next = clampPan(
      viewport.clientWidth / 2 - mapX * targetScale,
      viewport.clientHeight / 2 - mapY * targetScale,
      targetScale,
      viewport.clientWidth,
      viewport.clientHeight,
      width,
      height,
    );

    if (animate) {
      animateTo(next.x, next.y, targetScale);
      return;
    }

    stateRef.current.x = next.x;
    stateRef.current.y = next.y;
    stateRef.current.scale = targetScale;

    renderTransform();
  };

  const animateTo = (
    targetX: number,
    targetY: number,
    targetScale: number,
    duration = 140,
  ) => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    const start = performance.now();

    const fromX = stateRef.current.x;
    const fromY = stateRef.current.y;
    const fromScale = stateRef.current.scale;

    const easeOutCubic = (t: number) => {
      return 1 - Math.pow(1 - t, 3);
    };

    const step = (now: number) => {
      const elapsed = now - start;

      const progress = clamp(elapsed / duration, 0, 1);

      const eased = easeOutCubic(progress);

      stateRef.current.x = fromX + (targetX - fromX) * eased;

      stateRef.current.y = fromY + (targetY - fromY) * eased;

      stateRef.current.scale = fromScale + (targetScale - fromScale) * eased;

      renderTransform();

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(step);
      }
    };

    animationRef.current = requestAnimationFrame(step);
  };

  const startMomentum = () => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const friction = 0.94;
    const minimumVelocity = 0.18;

    const step = () => {
      momentumRef.current.velocityX *= friction;
      momentumRef.current.velocityY *= friction;

      if (
        Math.abs(momentumRef.current.velocityX) < minimumVelocity &&
        Math.abs(momentumRef.current.velocityY) < minimumVelocity
      ) {
        momentumRef.current.active = false;
        return;
      }

      const proposedX = stateRef.current.x + momentumRef.current.velocityX;

      const proposedY = stateRef.current.y + momentumRef.current.velocityY;

      const next = clampPan(
        proposedX,
        proposedY,
        stateRef.current.scale,
        viewport.clientWidth,
        viewport.clientHeight,
        width,
        height,
      );

      if (next.x !== proposedX) {
        momentumRef.current.velocityX *= 0.45;
      }

      if (next.y !== proposedY) {
        momentumRef.current.velocityY *= 0.45;
      }

      stateRef.current.x = next.x;
      stateRef.current.y = next.y;

      renderTransform();

      if (momentumRef.current.active === false) {
        return;
      }
      animationRef.current = requestAnimationFrame(step);
    };

    momentumRef.current.active = true;

    momentumRef.current.velocityX = clamp(
      momentumRef.current.velocityX,
      -18,
      18,
    );

    momentumRef.current.velocityY = clamp(
      momentumRef.current.velocityY,
      -18,
      18,
    );

    animationRef.current = requestAnimationFrame(step);
  };

  const renderTransform = () => {
    if (!contentRef.current) {
      return;
    }

    const { x, y, scale } = stateRef.current;
    contentRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale3d(${scale}, ${scale}, 1)`;
  };

  const requestRender = () => {
    if (rafRef.current != null) {
      return;
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      renderTransform();
    });
  };

  useImperativeHandle(ref, () => ({
    zoomIn() {
      const viewport = viewportRef.current;

      if (!viewport) {
        return;
      }

      const nextScale = clamp(stateRef.current.scale * 1.2, minScale, maxScale);

      const centerMapX =
        (viewport.clientWidth / 2 - stateRef.current.x) /
        stateRef.current.scale;

      const centerMapY =
        (viewport.clientHeight / 2 - stateRef.current.y) /
        stateRef.current.scale;

      centerOnPoint(centerMapX, centerMapY, nextScale);
    },

    zoomOut() {
      const viewport = viewportRef.current;

      if (!viewport) {
        return;
      }

      const nextScale = clamp(stateRef.current.scale / 1.2, minScale, maxScale);

      const centerMapX =
        (viewport.clientWidth / 2 - stateRef.current.x) /
        stateRef.current.scale;

      const centerMapY =
        (viewport.clientHeight / 2 - stateRef.current.y) /
        stateRef.current.scale;

      centerOnPoint(centerMapX, centerMapY, nextScale);
    },

    reset() {
      const viewport = viewportRef.current;

      if (!viewport) {
        return;
      }

      const fitScale = Math.min(
        viewport.clientWidth / width,
        viewport.clientHeight / height,
        1,
      );

      const clampedScale = clamp(fitScale, minScale, maxScale);

      centerOnPoint(width / 2, height / 2, clampedScale);
    },

    centerOn(mapX, mapY, scale) {
      centerOnPoint(mapX, mapY, scale || stateRef.current.scale);
    },

    getViewportTransform() {
      return {
        x: stateRef.current.x,
        y: stateRef.current.y,
        scale: stateRef.current.scale,
      };
    },

    setViewportTransform({ x, y, scale }) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      stateRef.current = { x, y, scale };
      renderTransform();
    },

    setGestureLocked(locked) {
      gestureLockedRef.current = locked;
    },
  }));

  useLayoutEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;

    if (!viewportWidth || !viewportHeight) {
      return;
    }

    const fitScale = Math.min(
      viewportWidth / width,
      viewportHeight / height,
      1,
    );

    const clampedScale = clamp(fitScale, minScale, maxScale);
    const scaledWidth = width * clampedScale;
    const scaledHeight = height * clampedScale;

    const centeredX = (viewportWidth - scaledWidth) / 2;

    const centeredY = (viewportHeight - scaledHeight) / 2;
    stateRef.current = {
      x: centeredX,
      y: centeredY,
      scale: clampedScale,
    };

    renderTransform();
  }, [width, height, maxScale]);

  // The centering effect above runs once for a given content size (its
  // deps are the natural content width/height and maxScale, never the
  // viewport's own rendered size), and every interactive gesture (drag,
  // pinch, wheel, zoomIn/Out, reset) already re-reads the viewport's
  // CURRENT clientWidth/clientHeight on every move -- but nothing
  // previously observed the viewport element's own size changing on its
  // own, e.g. a window resize or an orientation rotation with no
  // subsequent touch interaction. The applied pan/scale would then remain
  // exactly what it was for the OLD viewport size, silently inconsistent
  // with the new one, until some future gesture happened to touch it.
  // Confirmed by direct measurement (see task record): the transform is
  // provably unchanged across a simulated portrait/landscape rotation
  // with no reload, while a fresh mount in the new orientation computes a
  // different, correctly-centered one. This re-clamps (not re-fits) the
  // existing pan/scale into the new viewport's legal bounds using the
  // same clampPan every gesture already uses -- it deliberately does not
  // reset zoom or re-center, only pulls an now-out-of-bounds pan back to
  // where dragging already would.
  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport || typeof ResizeObserver === "undefined") {
      return;
    }

    let skippedInitial = false;

    const observer = new ResizeObserver(() => {
      if (!skippedInitial) {
        // ResizeObserver reports once immediately on observe(); the
        // useLayoutEffect above already established correct initial
        // geometry for this same size, so this first callback is not a
        // real subsequent resize and must not re-clamp over it.
        skippedInitial = true;
        return;
      }

      const vw = viewport.clientWidth;
      const vh = viewport.clientHeight;

      if (!vw || !vh) {
        return;
      }

      const next = clampPan(
        stateRef.current.x,
        stateRef.current.y,
        stateRef.current.scale,
        vw,
        vh,
        width,
        height,
      );

      if (next.x !== stateRef.current.x || next.y !== stateRef.current.y) {
        stateRef.current.x = next.x;
        stateRef.current.y = next.y;
        renderTransform();
      }
    });

    observer.observe(viewport);

    return () => observer.disconnect();
  }, [width, height]);

  // --- Gestures ---------------------------------------------------------
  // Bound via `target: viewportRef` (NOT spread onto the element) so that
  // @use-gesture attaches native non-passive listeners. This is what makes
  // `eventOptions: { passive: false }` real, so `event.preventDefault()`
  // actually cancels the browser's own pan/zoom instead of being ignored.
  useDrag(
    ({
      movement: [mx, my],
      offset: [ox, oy],
      delta: [dxp, dyp],
      velocity: [vx, vy],
      direction: [dx, dy],
      first,
      last,
      memo,
      event,
      touches,
    }) => {
      if (gestureLockedRef.current) {
        return memo;
      }

      // Ignore this entire drag gesture if it was EVER concurrent with a
      // second touch (a pinch), not merely whether exactly 2+ touches are
      // down on THIS specific event. `touches` is @use-gesture's own
      // globally-tracked finger count (backed by its controller's
      // pointerIds/touchIds sets) -- correct, unlike the previous check,
      // which read event.touches.length and was always 0 for this
      // Pointer-Event-driven gesture (pointer: { touch: false } below),
      // since a PointerEvent has no .touches property at all. But
      // `touches` alone is still not enough: this recognizer starts
      // tracking on the FIRST finger's own pointerdown (before a second
      // finger arrives), and at the moment that SAME finger later lifts
      // -- its own terminal `last` event -- the second finger is often
      // still down, so `touches` has already dropped back to 1. That
      // `last` event still carries this finger's full pinch-duration
      // movement, and unconditionally launches a momentum glide from it,
      // producing the reported post-pinch rightward transform jump.
      // dragSawMultiTouchRef makes the multi-touch verdict sticky for the
      // remainder of this one gesture (reset only when a fresh gesture's
      // own `first` event arrives), so that terminal event is skipped too.
      if (first) {
        dragSawMultiTouchRef.current = touches >= 2;
      } else if (touches >= 2) {
        dragSawMultiTouchRef.current = true;
      }

      if (dragSawMultiTouchRef.current) {
        if (last) {
          dragSawMultiTouchRef.current = false;
        }
        return memo;
      }

      isPinchingRef.current = false;
      document.body.classList.remove("coach-map-pinching");

      event.preventDefault();

      if (first) {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }

        momentumRef.current.velocityX = 0;
        momentumRef.current.velocityY = 0;
      }

      if (viewportRef.current?.dataset.dragReset === "true") {
        viewportRef.current.dataset.dragReset = "false";

        return {
          originX: stateRef.current.x,
          originY: stateRef.current.y,
        };
      }

      if (first || !memo) {
        memo = {
          originX: stateRef.current.x,
          originY: stateRef.current.y,
        };
      }

      const viewport = viewportRef.current;

      if (!viewport) {
        return memo;
      }

      const next = clampPan(
        memo.originX + mx,
        memo.originY + my,
        stateRef.current.scale,
        viewport.clientWidth,
        viewport.clientHeight,
        width,
        height,
      );

      stateRef.current.x = next.x;
      stateRef.current.y = next.y;

      momentumRef.current.velocityX = vx * dx * 18;
      momentumRef.current.velocityY = vy * dy * 18;

      requestRender();

      if (last) {
        startMomentum();
      }

      return memo;
    },
    {
      target: viewportRef,
      pointer: {
        touch: false,
      },
      preventDefault: true,
      pointerCapture: false,
      threshold: 0,
      eventOptions: {
        passive: false,
        capture: true,
      },
    },
  );

  usePinch(
    ({
      event,
      origin: [originX, originY],
      first,
      last,
      da: [gestureDistance],
      memo,
    }) => {
      if (gestureLockedRef.current) {
        return memo;
      }
      event.preventDefault();

      const viewport = viewportRef.current;
      if (!viewport) {
        return memo;
      }

      const rect = viewport.getBoundingClientRect();
      const touchEvent = event as TouchEvent;
      const firstTouch = touchEvent.touches?.[0];
      const secondTouch = touchEvent.touches?.[1];

      if (last && (!firstTouch || !secondTouch)) {
        isPinchingRef.current = false;
        document.body.classList.remove("coach-map-pinching");
        return memo;
      }

      let pointerX = originX - rect.left;
      let pointerY = originY - rect.top;
      let distance = Math.max(gestureDistance, 1);

      if (firstTouch && secondTouch) {
        const firstX = firstTouch.clientX - rect.left;
        const firstY = firstTouch.clientY - rect.top;
        const secondX = secondTouch.clientX - rect.left;
        const secondY = secondTouch.clientY - rect.top;

        pointerX = (firstX + secondX) / 2;
        pointerY = (firstY + secondY) / 2;

        const dx = secondX - firstX;
        const dy = secondY - firstY;
        distance = Math.max(Math.hypot(dx, dy), 1);
      }

      if (first || !memo) {
        isPinchingRef.current = true;
        document.body.classList.add("coach-map-pinching");

        if (animationRef.current != null) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = null;
        }

        momentumRef.current.active = false;

        const startScale = stateRef.current.scale;

        memo = {
          startDistance: distance,
          startScale,
          mapX: (pointerX - stateRef.current.x) / startScale,
          mapY: (pointerY - stateRef.current.y) / startScale,
        };
      }

      const distanceRatio = distance / memo.startDistance;
      const nextScale = clamp(
        memo.startScale * distanceRatio,
        minScale,
        maxScale,
      );

      const bounded = clampPan(
        pointerX - memo.mapX * nextScale,
        pointerY - memo.mapY * nextScale,
        nextScale,
        viewport.clientWidth,
        viewport.clientHeight,
        width,
        height,
      );

      stateRef.current.x = bounded.x;
      stateRef.current.y = bounded.y;
      stateRef.current.scale = nextScale;

      requestRender();

      if (last) {
        isPinchingRef.current = false;
        document.body.classList.remove("coach-map-pinching");
      }

      return memo;
    },
    {
      target: viewportRef,
      pointer: {
        touch: true,
      },
      preventDefault: true,
      pointerCapture: false,
      eventOptions: {
        passive: false,
        capture: true,
      },
    },
  );

  useWheel(
    ({ event, delta: [dx, dy], ctrlKey }) => {
      event.preventDefault();

      const viewport = viewportRef.current;

      if (!viewport) {
        return;
      }

      // Trackpad pinch on desktop browsers
      if (ctrlKey) {
        const rect = viewport.getBoundingClientRect();

        const pointerX = (event as WheelEvent).clientX - rect.left;

        const pointerY = (event as WheelEvent).clientY - rect.top;

        const zoomFactor = dy > 0 ? 0.96 : 1.04;

        const targetScale = clamp(
          stateRef.current.scale * zoomFactor,
          minScale,
          maxScale,
        );

        const mapX = (pointerX - stateRef.current.x) / stateRef.current.scale;

        const mapY = (pointerY - stateRef.current.y) / stateRef.current.scale;

        const next = clampPan(
          pointerX - mapX * targetScale,
          pointerY - mapY * targetScale,
          targetScale,
          rect.width,
          rect.height,
          width,
          height,
        );

        stateRef.current.x = next.x;
        stateRef.current.y = next.y;
        stateRef.current.scale = targetScale;

        requestRender();

        return;
      }

      // Two-finger desktop trackpad pan
      const next = clampPan(
        stateRef.current.x - dx,
        stateRef.current.y - dy,
        stateRef.current.scale,
        viewport.clientWidth,
        viewport.clientHeight,
        width,
        height,
      );

      stateRef.current.x = next.x;
      stateRef.current.y = next.y;

      requestRender();
    },
    {
      target: viewportRef,
      eventOptions: {
        passive: false,
      },
    },
  );

  useEffect(() => {
    const preventGesture = (e: Event) => {
      e.preventDefault();
    };

    // IMPORTANT:
    // Gestures are bound using `target: viewportRef` rather than spread
    // bindings (`...dragBind()` / `...pinchBind()` / `...wheelBind()`).
    //
    // This forces @use-gesture to attach native non-passive listeners,
    // allowing preventDefault() to work correctly.
    //
    // Reverting to spread bindings reintroduces desktop page-scroll and
    // trackpad zoom issues. See commit 91d2a76.
    // DO NOT re-enable Safari gesturestart/gesturechange/gestureend
    // prevention listeners.
    //
    // Testing during gesture stabilization (commit 91d2a76) showed
    // that these listeners interfere with iPad touch gesture handling.
    // Current touch behavior is stable with these disabled.
    //
    // If revisiting, perform controlled testing on:
    // - iPhone touchscreen
    // - iPad touchscreen
    // - iPad Magic Keyboard trackpad

    // document.addEventListener("gesturestart", preventGesture, {
    //   passive: false,
    // });

    // document.addEventListener("gesturechange", preventGesture, {
    //   passive: false,
    // });

    // document.addEventListener("gestureend", preventGesture, {
    //   passive: false,
    // });

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("gestureend", preventGesture);
    };
  }, []);

  return (
    <div
      ref={viewportRef}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();

        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect || !viewportRef.current) {
          return;
        }

        const pointerX = e.clientX - rect.left;
        const pointerY = e.clientY - rect.top;

        const currentScale = stateRef.current.scale;

        const nextScale = e.shiftKey
          ? clamp(currentScale / 1.55, minScale, maxScale)
          : clamp(currentScale * 1.55, minScale, maxScale);

        const mapX = (pointerX - stateRef.current.x) / currentScale;
        const mapY = (pointerY - stateRef.current.y) / currentScale;

        const next = clampPan(
          pointerX - mapX * nextScale,
          pointerY - mapY * nextScale,
          nextScale,
          viewportRef.current.clientWidth,
          viewportRef.current.clientHeight,
          width,
          height,
        );

        animateTo(next.x, next.y, nextScale, 120);
      }}
      onPointerDown={(e) => {
        pointerDownRef.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        if (e.pointerType === "mouse") {
          const down = pointerDownRef.current;
          pointerDownRef.current = null;
          if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) {
            return; // a drag, not a tap — do not fire placement
          }

          const rect = viewportRef.current?.getBoundingClientRect();
          if (!rect) {
            return;
          }

          const pointerX = e.clientX - rect.left;
          const pointerY = e.clientY - rect.top;

          const currentScale = stateRef.current.scale;

          const mapX = (pointerX - stateRef.current.x) / currentScale;
          const mapY = (pointerY - stateRef.current.y) / currentScale;

          onTapRef.current?.({
            screenX: pointerX,
            screenY: pointerY,
            mapX,
            mapY,
          });
        }
      }}
      onPointerCancel={() => {}}
      onTouchStart={(e) => {
        if (e.touches.length < 2) {
          isPinchingRef.current = false;
          document.body.classList.remove("coach-map-pinching");
        }

        const touch = e.touches[0];

        if (!touch || !viewportRef.current) {
          return;
        }

        viewportRef.current.dataset.tapStartX = String(touch.clientX);

        viewportRef.current.dataset.tapStartY = String(touch.clientY);

        viewportRef.current.dataset.tapCandidate = "true";
        viewportRef.current.dataset.touchCountStart = String(e.touches.length);
      }}
      onTouchMove={(e) => {
        const touch = e.touches[0];

        if (!touch || !viewportRef.current) {
          return;
        }

        const startX = Number(viewportRef.current.dataset.tapStartX || "0");

        const startY = Number(viewportRef.current.dataset.tapStartY || "0");

        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;

        if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
          viewportRef.current.dataset.tapCandidate = "false";
        }
      }}
      onTouchEnd={(e) => {
        if (e.touches.length < 2) {
          isPinchingRef.current = false;
          document.body.classList.remove("coach-map-pinching");
        }

        if (!viewportRef.current) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        const tapCandidate =
          viewportRef.current.dataset.tapCandidate === "true";

        const startedWithTwoTouches =
          viewportRef.current.dataset.touchCountStart === "2";

        // See shouldAllowNativeClickThrough's own doc comment: this is the
        // one case that must not cancel the browser's synthesized click,
        // which is what silently broke finger-tap marker/label activation.
        const endTouch = e.changedTouches[0];
        const targetElement = endTouch
          ? (document.elementFromPoint(
              endTouch.clientX,
              endTouch.clientY,
            ) as Element | null)
          : null;
        const tapLandedOnInteractiveTarget = shouldAllowNativeClickThrough({
          tapCandidate,
          startedWithTwoTouches,
          target: targetElement,
        });

        if (!tapLandedOnInteractiveTarget) {
          e.preventDefault();
        }
        e.stopPropagation();

        if (!tapCandidate && !startedWithTwoTouches) {
          return;
        }

        const rect = viewportRef.current.getBoundingClientRect();

        const touch = e.changedTouches[0];

        if (!touch) {
          return;
        }

        if (startedWithTwoTouches) {
          // Only a genuine, near-stationary two-finger TAP (tapCandidate
          // still true -- neither finger moved past the same 12px
          // threshold onTouchMove already applies to single-finger taps)
          // is this deliberate zoom-out shortcut. Without this guard, ANY
          // two-finger gesture that started with two touches -- including
          // an ordinary pinch-to-zoom, whose fingers necessarily move well
          // past that threshold -- fell into this branch on release too,
          // forcibly animating to currentScale/1.55 anchored at wherever
          // the last lifting finger happened to be. usePinch already
          // applies the correct, continuously-updated scale/pan for an
          // actual pinch; this handler must not additionally reinterpret
          // that gesture's release as a tap-to-zoom-out. This was the
          // reported post-pinch rightward transform jump, worse the
          // farther the preceding pinch had already zoomed.
          if (tapCandidate) {
            const pointerX = touch.clientX - rect.left;
            const pointerY = touch.clientY - rect.top;

            const currentScale = stateRef.current.scale;
            const nextScale = clamp(currentScale / 1.55, minScale, maxScale);

            const mapX = (pointerX - stateRef.current.x) / currentScale;
            const mapY = (pointerY - stateRef.current.y) / currentScale;

            const next = clampPan(
              pointerX - mapX * nextScale,
              pointerY - mapY * nextScale,
              nextScale,
              viewportRef.current.clientWidth,
              viewportRef.current.clientHeight,
              width,
              height,
            );

            animateTo(next.x, next.y, nextScale, 120);
          }
          viewportRef.current.dataset.tapCandidate = "false";
          viewportRef.current.dataset.touchCountStart = "0";
          return;
        }

        const now = Date.now();
        const lastTapTime = Number(
          viewportRef.current.dataset.lastTapTime || "0",
        );
        const isDoubleTap = now - lastTapTime < 320;

        viewportRef.current.dataset.lastTapTime = String(now);

        if (isDoubleTap) {
          const pointerX = touch.clientX - rect.left;
          const pointerY = touch.clientY - rect.top;

          const currentScale = stateRef.current.scale;
          const nextScale =
            currentScale < maxScale * 0.72
              ? clamp(currentScale * 1.55, minScale, maxScale)
              : clamp(currentScale / 1.55, minScale, maxScale);

          const mapX = (pointerX - stateRef.current.x) / currentScale;
          const mapY = (pointerY - stateRef.current.y) / currentScale;

          const next = clampPan(
            pointerX - mapX * nextScale,
            pointerY - mapY * nextScale,
            nextScale,
            viewportRef.current.clientWidth,
            viewportRef.current.clientHeight,
            width,
            height,
          );

          animateTo(next.x, next.y, nextScale, 120);
          viewportRef.current.dataset.tapCandidate = "false";
          return;
        }

        {
          const pointerX = touch.clientX - rect.left;
          const pointerY = touch.clientY - rect.top;

          const currentScale = stateRef.current.scale;

          const mapX = (pointerX - stateRef.current.x) / currentScale;

          const mapY = (pointerY - stateRef.current.y) / currentScale;

          console.log("MAP TAP", { mapX, mapY });

          onTapRef.current?.({
            screenX: pointerX,
            screenY: pointerY,
            mapX,
            mapY,
          });

          return;
        }
      }}
      style={{
        position: "relative",
        width: "100%",
        height: viewportHeight,
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        touchAction: "none",
        overscrollBehavior: "none",
        WebkitTouchCallout: "none",
        WebkitTapHighlightColor: "transparent",
        userSelect: "none",
        background: "#f2f2f2",
        contain: "layout paint size",
        isolation: "isolate",
        transform: "translateZ(0)",
        willChange: "transform",
      }}
    >
      <div
        ref={contentRef}
        // See the .map-engine-surface rule's own comment in
        // app/globals.css: an ambient, unrelated `.card div { max-width:
        // 100% !important }` reset (written for form-field alignment)
        // matches ANY div descendant of a `.card`-classed container,
        // including this one -- and since this div's own explicit pixel
        // width is what the percentage-positioned marker layer resolves
        // against, that reset silently clamps it to its flex ancestor's
        // width while leaving its own <img> child (not a div, unaffected)
        // rendering at the correct size. This class is the shared
        // engine's own defense against that and any similar ambient
        // reset, wherever it is mounted.
        className="map-engine-surface"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height,
          flexShrink: 0,
          transformOrigin: "0 0",
          willChange: "transform",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          transform: "translate3d(0, 0, 0) scale3d(1, 1, 1)",
          touchAction: "none",
          contain: "layout paint",
        }}
      >
        {children}
      </div>
    </div>
  );
});

export default GestureMapViewportV2;
