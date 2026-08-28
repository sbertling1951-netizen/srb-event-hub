/**
 * EpicentraX renderer-neutral mapping contract (Stage 1, extended Stage 5A).
 *
 * These types are the ONLY vocabulary a domain consumer (e.g. Nearby) is
 * allowed to depend on when it needs a geographic map. No renderer-native
 * type (Leaflet LatLng/Marker/events, MapLibre Feature, Google LatLng,
 * OpenLayers Feature, GeoJSON Feature, DOM pointer/touch events, etc.) may
 * appear on this surface. See docs/architecture for the full rationale;
 * this file is the enforceable half of that document.
 *
 * Scope note: this contract governs GEOGRAPHIC map renderers only (the
 * Leaflet/MapLibre/OpenLayers/Google family). EpicentraX's separate
 * in-house venue/floor-plan canvas system (components/map/canvas,
 * components/map/MapCanvas.tsx, GestureMapViewport*, used by Coach/Event
 * Map, Parking, and Master Maps) solves a different problem -- percentage
 * positioned pins on a static image, not projected lat/lng -- and is
 * intentionally out of scope here. Do not extend this contract to cover
 * it; the two are separate domains with separate authoritative models.
 * Master Map governance data (Stage 5A Part B) may one day be *presented*
 * through this contract if Master Maps ever moves off the canvas system,
 * but that migration is explicitly not part of this stage.
 */

/** A geographic point. The one coordinate vocabulary every renderer
 * adapter translates to/from its own native point type. */
export type MapCoordinate = {
  latitude: number;
  longitude: number;
};

/** A geographic bounding box, e.g. for a future "fit all objects in view"
 * intent. Unused by Nearby today; defined now because Coach/parking-style
 * "show everything" viewport intents are a clearly foreseeable need for a
 * future geographic consumer. */
export type MapBounds = {
  northEast: MapCoordinate;
  southWest: MapCoordinate;
};

/**
 * A request, not a command. The renderer adapter decides how (or whether)
 * to honor it -- e.g. the Leaflet adapter today defaults `zoom` when it's
 * omitted. Naming it "intent" rather than "viewport state" is deliberate:
 * EpicentraX does not own live pan/zoom state, only the starting/target
 * suggestion.
 */
export type MapViewportIntent = {
  center?: MapCoordinate;
  zoom?: number;
  bounds?: MapBounds;
};

/** A hint for how an object should be rendered. Renderer-agnostic on
 * purpose: no icon URLs, no anchor points, no z-index/pane names. The
 * adapter is the only thing that knows how its renderer expresses these.
 * Kept intentionally small -- only `accessibleLabel` is populated by any
 * consumer today; `iconSemantic`/`priority` exist so a second consumer
 * (e.g. an emergency-services layer) doesn't require a contract change,
 * not because Nearby needs them yet. */
export type MapObjectPresentation = {
  /** Renderer-agnostic icon category (e.g. "fuel", "medical"). The
   * adapter maps this to its own icon/symbol system; a renderer that
   * doesn't support custom icons may ignore it. */
  iconSemantic?: string;
  priority?: "normal" | "high";
  /** Overrides the default accessible label (usually derived from
   * `title`) when a more specific one is needed. */
  accessibleLabel?: string;
};

/**
 * The EpicentraX-owned map object. This is the authoritative application
 * model -- a NearbyPlace, a future CoachStop, etc. -- projected down to
 * exactly what a map needs to know about it. Renderer adapters translate
 * this INTO their native marker/feature representation on the way in, and
 * only ever hand EpicentraX an `id` back on the way out (see
 * `MapSurfaceProps.onObjectSelect`/`onObjectActivate`). A renderer's own
 * marker/feature object must never become the thing the application holds
 * onto or reasons about.
 */
export type MapObject = {
  id: string;
  coordinate: MapCoordinate;
  title: string;
  /** Short supplementary line (e.g. "Fuel · 1.2 mi"). Free text; the
   * domain layer decides the format, not the renderer. */
  subtitle?: string | null;
  category?: string | null;
  presentation?: MapObjectPresentation;
};

/** A single scalar today (one object selected, or none) -- named as its
 * own concept so a future richer selection model (multi-select, a
 * hover-vs-committed distinction, etc.) has somewhere to grow without
 * renaming `MapSurfaceProps.selectedObjectId`. */
export type MapSelection = string | null;

export type MapUserLocation = {
  coordinate: MapCoordinate;
  accuracyMeters?: number;
};

/**
 * What a given renderer adapter can actually do. The application may
 * require a capability without knowing which renderer will end up
 * providing it; see `lib/mapSurface/registry.ts`. Kept to the handful of
 * distinctions that already matter to a real EpicentraX decision (can we
 * show custom markers, can we select a feature) or would gate a
 * near-term one (clustering, user location, vector styling) -- not an
 * exhaustive survey of every renderer's API surface.
 */
export type MapRendererCapabilities = {
  supportsVectorLayers: boolean;
  supportsClustering: boolean;
  supportsCustomMarkers: boolean;
  supportsUserLocation: boolean;
  supportsFeatureSelection: boolean;
  supportsRotation: boolean;
  supportsPitch: boolean;
};

export type MapRendererId = "leaflet" | "maplibre" | "openlayers" | "google";

/**
 * Props for the EpicentraX-owned `<EpicentraxMapSurface>` component --
 * the only mapping import a domain consumer like Nearby should need.
 *
 * Interaction is semantic, not event-specific, by design (Stage 1 §5):
 * each renderer adapter is responsible for translating its own
 * mouse/touch/pointer/feature-selection model into these three actions.
 * This is the framework's direct answer to the Nearby marker-tap saga --
 * "which raw DOM/renderer event fires reliably on which device" becomes
 * the adapter's problem to solve once per renderer, never the domain's.
 *
 * Two activation-shaped callbacks are provided rather than one, because
 * Nearby's original real-device-verified UX was a genuine two-step flow:
 * tapping a map object identifies it (`onObjectSelect`); a second,
 * deliberate tap on the resulting identity surface opens it
 * (`onObjectActivate`). That two-step remains the DEFAULT. A consumer
 * whose own selected-object treatment is itself the deliberate action
 * (Nearby now opens its ObjectPanel straight from a pin tap) sets
 * `selectActivatesObject` -- the neutral surface then promotes a select
 * to the activation and fires `onObjectActivate` for it. Even then the
 * raw renderer gesture never reaches the domain unmediated: the surface,
 * not the adapter, decides which step counts as activation.
 */
export type MapSurfaceProps = {
  objects: MapObject[];
  selectedObjectId?: MapSelection;
  viewportIntent?: MapViewportIntent;
  userLocation?: MapUserLocation | null;
  /** A map object was identified (e.g. a marker was tapped). Does not by
   * itself mean the user wants full details -- see `onObjectActivate`. */
  onObjectSelect?: (objectId: string) => void;
  /** The user committed to this object and wants it opened (e.g. the
   * existing ObjectPanel). Never fired directly off a raw renderer
   * gesture; always the result of a deliberate, distinct activation step
   * the domain layer or the neutral surface itself owns -- either the
   * bridging identity card's own tap, or (when `selectActivatesObject`)
   * the surface promoting a select to an activation. */
  onObjectActivate?: (objectId: string) => void;
  /** The map background (not any object) was activated -- clears
   * selection. */
  onMapBackgroundActivate?: () => void;
  onViewportChange?: (viewport: MapViewportIntent) => void;
  /** When true, the surface treats a renderer object-select as the
   * deliberate activation: it fires `onObjectActivate` for that object
   * and renders no bridging identity card. For a consumer whose own
   * selected-object surface (e.g. Nearby's ObjectPanel) IS the intended
   * action of a pin tap. Defaults to the two-step flow. */
  selectActivatesObject?: boolean;
};

/** Props a renderer adapter itself implements. Deliberately narrower than
 * `MapSurfaceProps`: `onObjectActivate` is handled entirely by
 * `<EpicentraxMapSurface>` (via the renderer-agnostic selected-object
 * card), so no adapter needs to know that concept exists. */
export type MapRendererProps = {
  objects: MapObject[];
  selectedObjectId?: MapSelection;
  viewportIntent?: MapViewportIntent;
  userLocation?: MapUserLocation | null;
  onObjectSelect?: (objectId: string) => void;
  onBackgroundActivate?: () => void;
  onViewportChange?: (viewport: MapViewportIntent) => void;
};

/**
 * ---------------------------------------------------------------------
 * Stage 5A forward-declared vocabulary
 * ---------------------------------------------------------------------
 * Everything below is declared to leave clean seams for consumers this
 * repository does not have yet (a future non-point Nearby-style layer, a
 * Master Map that one day renders through this contract instead of the
 * canvas system, a second renderer adapter). None of it is implemented
 * by `LeafletMapRenderer`, wired into `EpicentraxMapSurface`, or consumed
 * by Nearby today -- exactly like `MapRendererId`'s "maplibre" /
 * "openlayers" / "google" members were in Stage 1. Do not start using
 * these without also shipping a consumer and an adapter that actually
 * implements them; an unused abstraction is a maintenance cost with no
 * offsetting benefit.
 */

export type MapPointGeometry = { type: "point"; coordinate: MapCoordinate };
export type MapPolygonGeometry = { type: "polygon"; rings: MapCoordinate[][] };
export type MapPolylineGeometry = { type: "polyline"; path: MapCoordinate[] };
export type MapFeatureGeometry = MapPointGeometry | MapPolygonGeometry | MapPolylineGeometry;

/**
 * The general geometry-aware form of a map object. `MapObject` (above) is
 * today's single concrete, implemented, point-only realization of this
 * concept -- every current consumer, adapter, and test depends on
 * `MapObject`'s exact shape, so it is kept as its own type rather than
 * replaced by `MapFeature` everywhere. A future polygon/polyline consumer
 * (e.g. a venue boundary) would use `MapFeature` directly instead of
 * forcing `MapObject.coordinate` to represent something it can't.
 */
export type MapFeature = {
  id: string;
  geometry: MapFeatureGeometry;
  title?: string;
  subtitle?: string | null;
  category?: string | null;
  presentation?: MapObjectPresentation;
};

/** An ordered group of features with independent visibility -- e.g. a
 * future "venue boundary" layer shown alongside a "points of interest"
 * layer. Unused today: Nearby has exactly one implicit layer. */
export type MapLayer = {
  id: string;
  features: MapFeature[];
  visible?: boolean;
};

/**
 * The semantic interaction vocabulary `MapSurfaceProps`'/`MapRendererProps`'
 * individual callbacks (`onObjectSelect`, `onObjectActivate`,
 * `onMapBackgroundActivate`, `onViewportChange`) are drawn from. The
 * framework exposes these as separate named callbacks rather than a
 * single dispatched `MapInteraction` value -- simpler for the two
 * concrete consumers (a React surface component and a React renderer
 * adapter) that exist today. This type exists as the documented,
 * reusable vocabulary itself, for anything that needs to log, replay, or
 * reason about an interaction as data (e.g. a future non-React adapter,
 * or telemetry) without inventing a second naming scheme.
 */
export type MapInteraction =
  | { kind: "objectSelect"; objectId: string }
  | { kind: "objectActivate"; objectId: string }
  | { kind: "mapBackgroundActivate" }
  | { kind: "viewportChange"; viewport: MapViewportIntent };

/**
 * A renderer's registry entry: the React component that implements
 * `MapRendererProps` plus what it can actually do. This is the type
 * `lib/mapSurface/registry.ts` registers under each `MapRendererId` --
 * named and exported here so "what does it take to add a renderer" has
 * one canonical answer instead of an implicit shape inferred from the
 * registry's internals.
 */
export type MapRendererAdapter<TComponent = unknown> = {
  id: MapRendererId;
  component: TComponent;
  capabilities: MapRendererCapabilities;
};
