"use client";

import { ReactNode } from "react";

import GestureMapViewportV2 from "./GestureMapViewportV2";

interface MapCanvasProps {
  width: number;
  height: number;
  children: ReactNode;
  viewportHeight?: string | number;
}

export default function MapCanvas({
  width,
  height,
  children,
  viewportHeight = "100dvh",
}: MapCanvasProps) {
  return (
    <GestureMapViewportV2
      width={width}
      height={height}
      viewportHeight={viewportHeight}
    >
      {children}
    </GestureMapViewportV2>
  );
}
