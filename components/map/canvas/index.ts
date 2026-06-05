// components/map/canvas/index.ts
export { default as MapCanvas } from "./MapCanvas";
export { MarkerLayer } from "./MarkerLayer";
export { alignMarkers, distributeMarkers, nudgeMarkers } from "./alignment";
export * as coords from "./coords";
export { useSelection } from "./useSelection";
export { useUndoStack } from "./useUndoStack";
export { useMapInteraction } from "./useMapInteraction";
export type {
  MapCanvasHandle,
  MapCanvasProps,
  MapMarker,
  MapPercentPoint,
  MapViewportState,
  MarkerPositionUpdate,
  Selection,
  SelectionMode,
  AlignAxis,
  DistributeAxis,
  ViewTransform,
} from "./types";
