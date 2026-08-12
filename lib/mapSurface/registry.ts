/**
 * EpicentraX map renderer registry (Stage 1, extended Stage 5A).
 *
 * This is the one governed point where a `MapRendererId` resolves to an
 * actual renderer adapter component and its capabilities. No consumer,
 * and no other file in this framework, should switch on renderer identity
 * -- if you find yourself writing `if (rendererId === "leaflet")` outside
 * this file, that logic belongs here instead.
 *
 * Only "leaflet" is registered today; only the `leaflet`/`react-leaflet`
 * packages are installed. MapLibre/OpenLayers/Google are named in
 * `MapRendererId` (lib/mapSurface/contract.ts) as declared future
 * members, not implemented ones -- see docs/architecture for the exact
 * steps to add one.
 */
import type { ComponentType } from "react";

import {
  LeafletMapRenderer,
  leafletRendererCapabilities,
} from "@/components/map/adapters/leaflet/LeafletMapRenderer";
import type {
  MapRendererAdapter,
  MapRendererCapabilities,
  MapRendererId,
  MapRendererProps,
} from "@/lib/mapSurface/contract";

export const DEFAULT_MAP_RENDERER_ID: MapRendererId = "leaflet";

type RegisteredRenderer = MapRendererAdapter<ComponentType<MapRendererProps>>;

const MAP_RENDERERS: Partial<Record<MapRendererId, RegisteredRenderer>> = {
  leaflet: {
    id: "leaflet",
    component: LeafletMapRenderer,
    capabilities: leafletRendererCapabilities,
  },
};

function getRegistration(rendererId: MapRendererId): RegisteredRenderer {
  const registration = MAP_RENDERERS[rendererId];

  if (!registration) {
    const registered = Object.keys(MAP_RENDERERS).join(", ") || "(none)";
    throw new Error(
      `EpicentraX mapSurface: renderer "${rendererId}" is not registered. Registered renderers: ${registered}.`,
    );
  }

  return registration;
}

export function resolveMapRenderer(
  rendererId: MapRendererId = DEFAULT_MAP_RENDERER_ID,
): ComponentType<MapRendererProps> {
  return getRegistration(rendererId).component;
}

export function getMapRendererCapabilities(
  rendererId: MapRendererId = DEFAULT_MAP_RENDERER_ID,
): MapRendererCapabilities {
  return getRegistration(rendererId).capabilities;
}
