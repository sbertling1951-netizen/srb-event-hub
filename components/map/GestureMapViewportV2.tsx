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
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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

  const minX = Math.min(0, viewportWidth - scaledWidth);
  const minY = Math.min(0, viewportHeight - scaledHeight);

  return {
    x:
      scaledWidth <= viewportWidth
        ? (viewportWidth - scaledWidth) / 2
        : clamp(x, minX, 0),

    y:
      scaledHeight <= viewportHeight
        ? (viewportHeight - scaledHeight) / 2
        : clamp(y, minY, 0),
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
    onTap,
  }: GestureMapViewportProps,
  ref,
) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const stateRef = useRef({
    x: 0,
    y: 0,
    scale: initialScale,
  });

  const rafRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);

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

    const friction = 0.985;
    const minimumVelocity = 0.08;

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
      -42,
      42,
    );

    momentumRef.current.velocityY = clamp(
      momentumRef.current.velocityY,
      -42,
      42,
    );

    animationRef.current = requestAnimationFrame(step);
  };

  const renderTransform = () => {
    if (!contentRef.current) {
      return;
    }

    const { x, y, scale } = stateRef.current;
    contentRef.current.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) scale(${scale})`;
    contentRef.current.style.transformOrigin = "0 0";
  };

  const requestRender = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
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

  const dragBind = useDrag(
    ({
      movement: [mx, my],
      velocity: [vx, vy],
      direction: [dx, dy],
      first,
      last,
      memo,
      event,
    }) => {
      const touchCount =
        "touches" in event ? (event as TouchEvent).touches.length : 0;

      if (touchCount > 1) {
        return memo;
      }

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

      if (viewportRef.current?.dataset.isPinching === "true") {
        return memo;
      }

      if (first) {
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

      momentumRef.current.velocityX = vx * dx * 38;
      momentumRef.current.velocityY = vy * dy * 38;

      requestRender();

      if (last) {
        startMomentum();
      }

      return memo;
    },
    {
      pointer: {
        touch: true,
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

  // const pinchBind = usePinch(
  const pinchBind = () => ({});
  const wheelBind = useWheel(
    ({ event, delta: [dx, dy], ctrlKey }) => {
      event.preventDefault();

      const viewport = viewportRef.current;

      if (!viewport) {
        return;
      }

      // Trackpad pinch on desktop browsers
      if (ctrlKey) {
        const rect = viewport.getBoundingClientRect();

        const pointerX =
          (event as WheelEvent).clientX - rect.left;

        const pointerY =
          (event as WheelEvent).clientY - rect.top;

        const zoomFactor = dy > 0 ? 0.96 : 1.04;

        const targetScale = clamp(
          stateRef.current.scale * zoomFactor,
          minScale,
          maxScale,
        );

        const mapX =
          (pointerX - stateRef.current.x) /
          stateRef.current.scale;

        const mapY =
          (pointerY - stateRef.current.y) /
          stateRef.current.scale;

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
      {...dragBind()}
      {...pinchBind()}
      {...wheelBind()}
      onTouchStart={(e) => {
        const touch = e.touches[0];

        if (!touch || !viewportRef.current) {
          return;
        }

        viewportRef.current.dataset.tapStartX = String(touch.clientX);

        viewportRef.current.dataset.tapStartY = String(touch.clientY);

        viewportRef.current.dataset.tapCandidate = "true";
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
        if (!viewportRef.current) {
          return;
        }

        const tapCandidate =
          viewportRef.current.dataset.tapCandidate === "true";

        if (!tapCandidate) {
          return;
        }

        const rect = viewportRef.current.getBoundingClientRect();

        const touch = e.changedTouches[0];

        if (!touch) {
          return;
        }


        {

          const pointerX = touch.clientX - rect.left;
          const pointerY = touch.clientY - rect.top;

          const currentScale = stateRef.current.scale;

          const mapX = (pointerX - stateRef.current.x) / currentScale;

          const mapY = (pointerY - stateRef.current.y) / currentScale;

          onTap?.({
            screenX: pointerX,
            screenY: pointerY,
            mapX,
            mapY,
          });

          return;
        }


        return;
      }}
      style={{
        position: "relative",
        width: "100%",
        height: "100dvh",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        touchAction: "none",
        overscrollBehavior: "none",
        WebkitTouchCallout: "none",
        WebkitTapHighlightColor: "transparent",
        userSelect: "none",
        background: "#f2f2f2",
      }}
    >
      <div
        ref={contentRef}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height,
          flexShrink: 0,
          transformOrigin: "0 0",
          willChange: "transform",
          touchAction: "none",
        }}
      >
        {children}
      </div>
    </div>
  );
});

export default GestureMapViewportV2;
