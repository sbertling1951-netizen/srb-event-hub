"use client";

import { type ReactNode, useEffect, useRef } from "react";
import {
  type ReactZoomPanPinchRef,
  TransformComponent,
  TransformWrapper,
} from "react-zoom-pan-pinch";

type InteractiveMapViewportProps = {
  imageUrl: string;
  width: number;
  height: number;

  initialScale?: number;
  minScale?: number;
  maxScale?: number;

  children?: ReactNode;
};

export default function InteractiveMapViewport({
  imageUrl,
  width,
  height,
  initialScale = 0.6,
  minScale = 0.1,
  maxScale = 4,
  children,
}: InteractiveMapViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
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
        touchAction: "pan-x pan-y",
        overscrollBehavior: "none",
        background: "#f2f2f2",
      }}
    >
      <TransformWrapper
        initialScale={1}
        minScale={0.8}
        maxScale={6}
        limitToBounds={true}
        panning={{
          disabled: false,
        }}
      >
        {" "}
        <TransformComponent
          wrapperStyle={{
            width: "100%",
            height: "100%",
            overflow: "hidden",
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
            <div
              style={{
                width,
                height,
                background: "#3366cc",
              }}
            />

            {children}
          </div>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
