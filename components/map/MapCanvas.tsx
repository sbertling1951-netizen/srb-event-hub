/**
 * ⚠️ LEGACY MAPCANVAS WRAPPER ⚠️
 *
 * DO NOT USE FOR NEW DEVELOPMENT.
 *
 * Active MapCanvas engine lives in:
 *
 *   components/map/canvas/
 *
 * This file exists only for:
 *   - components/map/CampgroundMap.tsx
 *   - app/dev/map-test/page.tsx
 *
 * Master Maps, Parking Admin, Locations, and all new map work
 * should use:
 *
 *   import { MapCanvas } from "@/components/map/canvas";
 *
 */

"use client";

import { forwardRef, ReactNode, useImperativeHandle, useRef } from "react";

import GestureMapViewportV2, {
  type GestureMapViewportHandle,
} from "./GestureMapViewportV2";

export type MapCanvasHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  centerOn: (x: number, y: number) => void;
};

interface MapCanvasProps {
  width: number;
  height: number;
  children: ReactNode;
  viewportHeight?: string | number;

  initialScale?: number;
  minScale?: number;
  maxScale?: number;

  onTap?: (args: {
    screenX: number;
    screenY: number;
    mapX: number;
    mapY: number;
  }) => void;
}

/**
 * MapCanvas
 *
 * Shared map rendering entry point.
 *
 * Future responsibilities:
 * - Shared coordinate system
 * - Shared marker rendering
 * - Shared zoom/pan state
 * - Shared gesture handling
 * - Shared bounds logic
 *
 * Pages should render maps through MapCanvas rather than
 * directly consuming GestureMapViewportV2.
 */

const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(
  function MapCanvas(
    {
      width,
      height,
      children,
      viewportHeight = "100dvh",
      initialScale,
      minScale,
      maxScale,
      onTap,
    },
    ref,
  ) {
    const viewportRef = useRef<GestureMapViewportHandle | null>(null);

    const lastOnTapRef = useRef(onTap);

    lastOnTapRef.current = onTap;

    useImperativeHandle(ref, () => ({
      zoomIn: () => viewportRef.current?.zoomIn(),
      zoomOut: () => viewportRef.current?.zoomOut(),
      reset: () => viewportRef.current?.reset(),
      centerOn: (x, y) => viewportRef.current?.centerOn(x, y),
    }));

    return (
      <GestureMapViewportV2
        ref={viewportRef}
        width={width}
        height={height}
        viewportHeight={viewportHeight}
        initialScale={initialScale}
        minScale={minScale}
        maxScale={maxScale}
        onTap={onTap}
      >
        {children}
      </GestureMapViewportV2>
    );
  },
);

export default MapCanvas;
