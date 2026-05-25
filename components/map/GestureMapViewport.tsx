"use client";

import { animated, useSpring } from "@react-spring/web";
import { useDrag, usePinch, useWheel } from "@use-gesture/react";
import { type ReactNode, useEffect, useRef } from "react";

type GestureMapViewportProps = {
  width: number;
  height: number;
  children?: ReactNode;
  minScale?: number;
  maxScale?: number;
  initialScale?: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default function GestureMapViewport({
  width,
  height,
  children,
  minScale = 0.4,
  maxScale = 4,
  initialScale = 0.8,
}: GestureMapViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const [{ x, y, scale }, api] = useSpring(() => ({
    x: 0,
    y: 0,
    scale: initialScale,
    config: {
      tension: 300,
      friction: 32,
    },
  }));

  const dragBind = useDrag(
    ({ offset: [dx, dy], event }) => {
      event.preventDefault();

      if (viewportRef.current?.dataset.isPinching === "true") {
        return;
      }

      if ("touches" in event && event.touches.length > 1) {
        return;
      }

      if (viewportRef.current && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) {
        viewportRef.current.dataset.isDragging = "true";
      }

      api.start({
        x: dx,
        y: dy,
        immediate: true,
      });
    },
    {
      from: () => [x.get(), y.get()],
      preventDefault: true,
      filterTaps: false,
      enabled: true,
      pointer: {
        touch: true,
      },
      pointerCapture: false,
      threshold: 0,
      tapsThreshold: 3,
      eventOptions: {
        passive: false,
        capture: true,
      },
    },
  );

  const pinchBind = usePinch(
    ({ origin: [ox, oy], offset: [nextScale], first, last, memo, event }) => {
      event.preventDefault();

      if (viewportRef.current) {
        viewportRef.current.dataset.isPinching = "true";
      }

      const rect = viewportRef.current?.getBoundingClientRect();

      if (!rect) {
        return memo;
      }

      const pointerX = ox - rect.left;
      const pointerY = oy - rect.top;

      const currentScale = scale.get();

      const scaleDiff = nextScale - currentScale;

      const smoothingFactor = first ? 1 : scaleDiff > 0 ? 0.1 : 0.7;

      const smoothedScale = currentScale + scaleDiff * smoothingFactor;
      const clampedScale = clamp(smoothedScale, minScale, maxScale);
      const scaleDelta = clampedScale - currentScale;

      if (first || !memo) {
        memo = {
          lastPointerX: pointerX,
          lastPointerY: pointerY,
        };
      }

      const pointerDeltaX = first ? 0 : pointerX - memo.lastPointerX;

      const pointerDeltaY = first ? 0 : pointerY - memo.lastPointerY;

      memo.lastPointerX = pointerX;
      memo.lastPointerY = pointerY;

      const currentX = x.get() + pointerDeltaX;
      const currentY = y.get() + pointerDeltaY;

      const mapX = (pointerX - currentX) / currentScale;
      const mapY = (pointerY - currentY) / currentScale;

      const nextX = pointerX - mapX * clampedScale;
      const nextY = pointerY - mapY * clampedScale;

      api.start({
        x: nextX + pointerDeltaX * scaleDelta * 0.12,
        y: nextY + pointerDeltaY * scaleDelta * 0.12,
        scale: clampedScale,
        immediate: true,
      });

      if (last && viewportRef.current) {
        memo.lastPointerX = pointerX;
        memo.lastPointerY = pointerY;
        requestAnimationFrame(() => {
          if (viewportRef.current) {
            viewportRef.current.dataset.isPinching = "false";
          }
        });
      }

      return memo;
    },
    {
      scaleBounds: {
        min: minScale,
        max: maxScale,
      },
      rubberband: false,
      pinchOnWheel: true,
      eventOptions: {
        passive: false,
        capture: true,
      },
    },
  );

  const wheelBind = useWheel(
    ({ event, delta: [, dy], ctrlKey }) => {
      event.preventDefault();

      if (!ctrlKey) {
        return;
      }

      const viewport = viewportRef.current;

      if (!viewport) {
        return;
      }

      const rect = viewport.getBoundingClientRect();

      const pointerX = (event as WheelEvent).clientX - rect.left;

      const pointerY = (event as WheelEvent).clientY - rect.top;

      const currentScale = scale.get();

      const zoomFactor = dy > 0 ? 0.96 : 1.04;

      const targetScale = clamp(currentScale * zoomFactor, minScale, maxScale);

      const mapX = (pointerX - x.get()) / currentScale;

      const mapY = (pointerY - y.get()) / currentScale;

      const nextX = pointerX - mapX * targetScale;

      const nextY = pointerY - mapY * targetScale;

      api.start({
        x: nextX,
        y: nextY,
        scale: targetScale,
        immediate: true,
      });
    },
    {
      eventOptions: {
        passive: false,
      },
    },
  );

  useEffect(() => {
    const preventGesture = (e: Event) => {
      e.preventDefault();
    };

    document.addEventListener("gesturestart", preventGesture, {
      passive: false,
    });

    document.addEventListener("gesturechange", preventGesture, {
      passive: false,
    });

    document.addEventListener("gestureend", preventGesture, {
      passive: false,
    });

    return () => {
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("gestureend", preventGesture);
    };
  }, []);

  return (
    <div
      ref={viewportRef}
      {...dragBind()}
      {...pinchBind()}
      {...wheelBind()}
      onPointerUp={(e) => {
        const viewport = viewportRef.current;

        if (!viewport) {
          return;
        }

        const now = Date.now();

        const lastTap = Number(viewport.dataset.lastTapTime || "0");

        const delta = now - lastTap;

        viewport.dataset.lastTapTime = String(now);

        if (delta > 300 || delta < 40) {
          return;
        }

        e.preventDefault();

        const rect = viewport.getBoundingClientRect();

        const pointerX = e.clientX - rect.left;
        const pointerY = e.clientY - rect.top;

        const currentScale = scale.get();

        const targetScale =
          currentScale < 2 ? Math.min(currentScale * 2, maxScale) : minScale;

        const mapX = (pointerX - x.get()) / currentScale;

        const mapY = (pointerY - y.get()) / currentScale;

        const nextX = pointerX - mapX * targetScale;

        const nextY = pointerY - mapY * targetScale;

        api.start({
          x: nextX,
          y: nextY,
          scale: targetScale,
          immediate: false,
        });
      }}
      style={{
        position: "relative",
        zIndex: 9999,
        pointerEvents: "auto",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        touchAction: "none",
        msTouchAction: "none",
        overscrollBehavior: "none",
        WebkitOverflowScrolling: "auto",
        WebkitTouchCallout: "none",
        WebkitTapHighlightColor: "transparent",
        userSelect: "none",
        WebkitUserSelect: "none",
        background: "#f2f2f2",
      }}
    >
      <animated.div
        style={{
          width,
          height,
          position: "relative",
          pointerEvents: "auto",
          transformOrigin: "0 0",
          touchAction: "none",
          willChange: "transform",
          transform: "translate3d(0,0,0)",
          x,
          y,
          scale,
        }}
      >
        {children}
      </animated.div>
    </div>
  );
}
