"use client";

import {
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  type ReactZoomPanPinchRef,
  TransformComponent,
  TransformWrapper,
} from "react-zoom-pan-pinch";

export type InteractiveMapViewportHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
};

type InteractiveMapViewportProps = {
  imageUrl: string;
  width: number;
  height: number;

  initialScale?: number;
  minScale?: number;
  maxScale?: number;

  children?: ReactNode;
};

const InteractiveMapViewport = forwardRef<
  InteractiveMapViewportHandle,
  InteractiveMapViewportProps
>(function InteractiveMapViewport(
  {
    imageUrl,
    width,
    height,
    initialScale = 0.6,
    minScale = 0.1,
    maxScale = 4,
    children,
  },
  ref,
) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  useImperativeHandle(ref, () => ({
    zoomIn() {
      transformRef.current?.zoomIn();
    },

    zoomOut() {
      transformRef.current?.zoomOut();
    },

    reset() {
      transformRef.current?.resetTransform();
    },
  }));
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
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        touchAction: "none",
        overscrollBehavior: "none",
        background: "#f2f2f2",
      }}
    >
      <TransformWrapper
        ref={transformRef}
        initialScale={initialScale}
        minScale={minScale}
        maxScale={maxScale}
        limitToBounds={true}
        centerZoomedOut={true}
        panning={{
          disabled: false,
          velocityDisabled: true,
          lockAxisX: false,
          lockAxisY: false,
          excluded: ["button"],
          allowLeftClickPan: true,
        }}
        wheel={{
          wheelDisabled: false,
          touchPadDisabled: false,
        }}
        pinch={{
          disabled: false,
        }}
        doubleClick={{
          disabled: false,
          step: 1.2,
        }}
        zoomAnimation={{
          disabled: true,
        }}
      >
        <TransformComponent
          wrapperStyle={{
            width: "100%",
            height: "100%",
            overflow: "visible",
            touchAction: "none",
          }}
          contentStyle={{
            position: "relative",
            touchAction: "none",
            userSelect: "none",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
          }}
        >
          <div
            style={{
              position: "relative",
              width,
              height,
            }}
          >
            {children}
          </div>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
});

export default InteractiveMapViewport;
