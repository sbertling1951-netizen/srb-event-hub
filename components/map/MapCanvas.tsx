"use client";

import { ReactNode } from "react";

import GestureMapViewportV2 from "./GestureMapViewportV2";

interface MapCanvasProps {
  width: number;
  height: number;
  children: ReactNode;
}

export default function MapCanvas({ width, height, children }: MapCanvasProps) {
  return (
    <GestureMapViewportV2 width={width} height={height}>
      {children}
    </GestureMapViewportV2>
  );
}
