// components/map/canvas/index.ts
export { alignMarkers, distributeMarkers, nudgeMarkers } from "./alignment";
export * as coords from "./coords";
export { default as MapCanvas } from "./MapCanvas";
export { MarkerLayer } from "./MarkerLayer";
export type { MarkerSpacingStats } from "./markerSizing";
export {
  computeNearestNeighborSpacingPx,
  resolveDensityAwareMarkerSize,
  SELECTED_SIZE_MULTIPLIER,
} from "./markerSizing";
export type { MarkerTone } from "./markerVisuals";
export { MarkerDot, MarkerLabelChip, resolveMarkerTone } from "./markerVisuals";
export type {
  AlignAxis,
  DistributeAxis,
  MapCanvasHandle,
  MapCanvasProps,
  MapMarker,
  MapPercentPoint,
  MapViewportState,
  MarkerPositionUpdate,
  Selection,
  SelectionMode,
  ViewTransform,
} from "./types";
export { useMapInteraction } from "./useMapInteraction";
export { useSelection } from "./useSelection";
export { useUndoStack } from "./useUndoStack";
