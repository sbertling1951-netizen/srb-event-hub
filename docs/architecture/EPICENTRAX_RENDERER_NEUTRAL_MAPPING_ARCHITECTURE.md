# EpicentraX Renderer-Neutral Mapping Framework

**Status:** Accepted — Stage 1 (contract + Leaflet adapter + Nearby migration); extended Stage 5A (forward-declared vocabulary, audit re-confirmation, governed venue evidence foundation, Tenant-authority governance correction, Administrative Authority Foundation wiring)
**Version:** 1.3
**Date:** August 11, 2026

**Revision note (1.0 -> 1.1):** Stage 5A re-audited every Stage 1 boundary
(§16 below is the audit re-confirmation) and extended the contract with
forward-declared, not-yet-implemented vocabulary (§17) requested by that
stage's brief — `MapFeature`/`MapPointFeature`/`MapPolygonFeature`/
`MapPolylineFeature`, `MapLayer`, `MapInteraction`, `MapRendererAdapter`.
No Stage 1 type, prop, or adapter behavior was renamed or changed; see §17
for why extension rather than renaming was chosen. Stage 5A also adds §19
(Governed Venue Evidence Foundation), a Master Maps concern that shares
this document only because Part C of that stage's brief places both under
one architectural picture — the venue-evidence governance model itself
does not depend on, and is not gated by, the renderer contract in §1-§18.

**Revision note (1.1 -> 1.2):** A governance correction, applied to the
still-unapplied Stage 5A Part B migration before it was ever deployed:
§19.4's original `public.is_active_admin(auth.uid())` check established
only that a caller was *some* active admin, not that they held authority
over the specific Tenant of the venue evidence in question — a real
cross-Tenant exposure in multi-Tenant data. §19.4 now documents the
Tenant-authority audit performed, why no existing or accepted primitive
could safely resolve it, and the fail-closed correction applied
(`privilege_group = 'super_admin'` only, plus a `tenant_id`-immutability
trigger). No renderer content (§1-§18) is touched by this revision.

**Revision note (1.2 -> 1.3):** The Administrative Authority Foundation
(Super Admin → Tenant Admin → Event Admin) is now implemented — see
`EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md`. §19.4 is
updated to reflect that `venue_evidence`'s authority checks now call the
real `public.has_tenant_admin_authority(auth_user_id, tenant_id)`
primitive in place of the 1.2 interim `privilege_group = 'super_admin'`
predicate. No renderer content (§1-§18) is touched by this revision
either.

## Relationship to Governing Architecture

This document assumes the following as already established and does not
restate, alter, weaken, or compete with any of them:

- The EpicentraX Constitution (ADR-000) — in particular Article VI
  ("Complexity belongs inside the platform. Simplicity belongs in the
  user experience.") and Article VII ("Every important concept shall have
  one authoritative identity, one owner, one authoritative context, one
  source of truth... Architecture shall favor long-term clarity over
  short-term convenience.").
- `DEVELOPMENT_STANDARDS.md` (Living architectural standard).

Where this document is silent, those remain authoritative.

## Purpose

Leaflet is currently the only geographic mapping library installed in this
repository, and until this document, EpicentraX's one geographic map
consumer (Nearby) was written directly against it. That coupling is what
made the real-device marker-tap investigation (see the Nearby engineering
history) as hard as it was: every fix had to reason about Leaflet's own
event/DOM internals because there was no boundary between "what Nearby
needs from a map" and "how Leaflet happens to provide it."

**EpicentraX does not have a canonical map renderer. Renderers are
replaceable infrastructure.** This document defines the contract that
makes that true: a small, stable, renderer-neutral vocabulary that any
top-tier geographic renderer (Leaflet today; MapLibre GL JS, OpenLayers,
or the Google Maps JavaScript API in the future) can satisfy, and the one
governed point where EpicentraX picks which renderer actually runs.

### Scope: geographic maps only

This framework governs **geographic** map renderers — libraries that
project latitude/longitude onto a viewport (Leaflet, MapLibre,
OpenLayers, Google Maps JS API). It does **not** govern, and is not
extended to cover, EpicentraX's separate in-house venue/floor-plan canvas
system (`components/map/canvas`, `components/map/MapCanvas.tsx`,
`components/map/CampgroundMap.tsx`, `GestureMapViewport*`), used by
Coach/Event Map, Parking, and Master Maps. That system positions pins by
percentage on a static uploaded image; it has no lat/lng, no projection,
and no renderer to swap — "renderer" has no meaning there. Conflating the
two would violate the same one-authoritative-model principle (Article
VII) this document exists to uphold. See §1 for the full classification
of every current mapping-flavored consumer in the repository.

## 1. Principles

1. No renderer dictates EpicentraX domain semantics. A `MapObject` means
   the same thing regardless of which renderer draws it.
2. EpicentraX owns object identity and meaning; a renderer's native
   marker/feature object is never the thing the application holds onto,
   persists, or reasons about (§4).
3. Interaction is semantic, not event-specific (§5). A domain consumer
   asks "was this object activated," never "did a Leaflet click fire" or
   "did a MapLibre feature get tapped."
4. Presentation is expressed as intent, not renderer configuration (§6).
5. Capabilities are queried, not assumed (§7). A consumer that needs
   clustering asks the registry whether the active renderer supports it;
   it does not hard-code "MapLibre supports clustering."
6. Renderer choice, basemap/style provider, geocoding, routing, and
   external navigation are five independent axes (§8). Choosing a
   renderer never silently chooses the others.
7. Small and stable beats exhaustive. This is not a GIS framework (§13).
   Only concepts a current or clearly foreseeable EpicentraX consumer
   needs are in the contract.

## 2. Ownership Boundaries

```
EpicentraX domain/application (e.g. app/member/nearby/page.tsx)
        |  MapObject[], MapSurfaceProps
        v
EpicentraX Map Surface  (components/map/surface/EpicentraxMapSurface.tsx)
        |  MapRendererProps
        v
Renderer Adapter        (components/map/adapters/<renderer>/)
        |
        +-- Leaflet    (implemented, Stage 1)
        +-- MapLibre   (declared in MapRendererId, not implemented)
        +-- OpenLayers (declared in MapRendererId, not implemented)
        +-- Google     (declared in MapRendererId, not implemented)
        +-- future renderer satisfying MapRendererProps
```

- **Domain/application layer** owns `Place`-style data and translates it
  into `MapObject[]` (Nearby does this in `app/member/nearby/page.tsx`).
  It never imports a renderer package.
- **Map Surface** (`EpicentraxMapSurface`) resolves a renderer through the
  registry and renders it. It also owns the renderer-agnostic
  selected-object card, because that card has no renderer dependency at
  all — duplicating it per adapter would violate one-source-of-truth.
  This is the only file boundary a domain consumer imports from.
- **Renderer Adapter** is the only place allowed to import the renderer
  package (`leaflet`/`react-leaflet` today). It translates `MapObject` in
  and object `id`s out; nothing renderer-native crosses this boundary.

## 3. The Renderer-Neutral Contract

Defined in `lib/mapSurface/contract.ts`. Full types and their rationale
are documented inline there (read that file alongside this section); this
is the summary:

| Type | Purpose |
|---|---|
| `MapCoordinate` | `{ latitude, longitude }` — the one point vocabulary. |
| `MapBounds` | A bounding box, for a future "fit all objects" intent. |
| `MapViewportIntent` | `{ center?, zoom?, bounds? }` — a request, not a command; the adapter decides how to honor it. |
| `MapObject` | `{ id, coordinate, title, subtitle?, category?, presentation? }` — the authoritative application object. |
| `MapObjectPresentation` | `{ iconSemantic?, priority?, accessibleLabel? }` — presentation intent, never renderer config. |
| `MapSelection` | `string \| null` — named so a richer future selection model doesn't require renaming the prop. |
| `MapUserLocation` | `{ coordinate, accuracyMeters? }` — defined, not yet wired into any consumer. |
| `MapRendererCapabilities` | The seven booleans in §7. |
| `MapRendererId` | `"leaflet" \| "maplibre" \| "openlayers" \| "google"`. |
| `MapSurfaceProps` | What a domain consumer passes to `EpicentraxMapSurface`. |
| `MapRendererProps` | What an adapter itself implements — narrower than `MapSurfaceProps` (see §4/§5). |

None of the following may appear in this contract or cross out of an
adapter: Leaflet `LatLng`/events, MapLibre `Feature`, GeoJSON `Feature` as
a mandatory model, Google Maps `LatLng`, OpenLayers `Feature`, any
renderer marker class, or any renderer-specific gesture event.

## 4. Domain Object vs. Rendered Feature

```
NearbyPlace (app/member/nearby/page.tsx: Place)
        |  Nearby's own mapping function
        v
EpicentraX MapObject                    <- authoritative; this is what
        |  adapter translation             EpicentraX holds onto
        v
Leaflet Marker / MapLibre feature / OpenLayers Feature / Google AdvancedMarker
```

A renderer object is disposable rendering state. The adapter creates it
from a `MapObject` and destroys it when Leaflet says the map re-renders;
it never becomes something the domain layer stores, compares, or acts on.
When a renderer reports an interaction, it reports the `MapObject.id`,
never itself.

## 5. Interaction Contract

`MapSurfaceProps` exposes exactly three semantic actions:

- `onObjectSelect(objectId)` — an object was identified.
- `onObjectActivate(objectId)` — the user committed to it (opens details).
- `onMapBackgroundActivate()` — the background was activated (clears
  selection).
- `onViewportChange(viewport)` — the visible viewport changed.

No contract defines `onMarkerClick`, `onLeafletClick`, `onPointerDown`, or
`onFeatureTap`. Each adapter is responsible for translating its own
mouse/touch/pointer/feature-selection model into these four actions —
this is the framework's direct answer to why the Nearby marker-tap
investigation took as many real-device iterations as it did: that
translation work now happens once per renderer, inside the adapter, not
anywhere a domain consumer or the surface component can see.

`onObjectSelect` and `onObjectActivate` are deliberately separate rather
than one "activate" callback. Nearby's real, working, real-device-tested
interaction is a genuine two-step flow — tap a marker to identify it, tap
the resulting identity card to open it — and collapsing that into a
single callback would silently reintroduce the direct
marker-tap-opens-panel handoff that repeatedly failed real-device
testing. `MapRendererProps` (what an adapter implements) only exposes
`onObjectSelect`; `onObjectActivate` is handled entirely by
`EpicentraxMapSurface`'s selected-object card, so no adapter needs to
know the "activate" concept exists at all.

## 6. Presentation Contract

`MapObject.category`/`subtitle` and `MapObject.presentation` (§3) express
intent: an icon *category*, a *priority* hint, an accessible label
override. Never `iconAnchor`, a Leaflet pane name, a MapLibre layer id, a
Google `AdvancedMarkerElement`, or an OpenLayers `Style` object — the
adapter decides how its renderer fulfills the intent.

"Selected" is deliberately *not* a per-object presentation field. It's
surfaced structurally, once, via `MapSurfaceProps.selectedObjectId` /
`MapRendererProps.selectedObjectId` — an adapter that wants to give the
selected marker its own visual treatment reads that and compares it to
each object's `id` while rendering, rather than EpicentraX stamping
`selected: true` onto one object in the list.

## 7. Capability Model

`MapRendererCapabilities` (`lib/mapSurface/contract.ts`):

```ts
supportsVectorLayers, supportsClustering, supportsCustomMarkers,
supportsUserLocation, supportsFeatureSelection, supportsRotation,
supportsPitch
```

Seven booleans — the distinctions that already matter to a real
EpicentraX decision (custom markers, feature selection) or would gate a
near-term one (clustering, user location, vector styling, rotation/pitch
for a future 3D venue view). Not an exhaustive survey of any renderer's
API. Look them up via `getMapRendererCapabilities()` in
`lib/mapSurface/registry.ts`; never hard-code "renderer X supports Y."

Today's Leaflet adapter (`components/map/adapters/leaflet/
LeafletMapRenderer.tsx`) reports:

```ts
supportsVectorLayers: false      // raster OSM tiles only, as configured
supportsClustering: false        // no clustering plugin wired up
supportsCustomMarkers: true      // L.icon() is in use
supportsUserLocation: false      // no device-location layer wired up
supportsFeatureSelection: true   // marker click -> onObjectSelect
supportsRotation: false          // Leaflet 2D, no bearing
supportsPitch: false             // Leaflet 2D, no pitch
```

These reflect the *current configuration*, not Leaflet's theoretical
ceiling (Leaflet has vector-tile and clustering plugins; none are
installed). If a consumer needs one of those, install and wire the plugin
and flip the corresponding capability — do not claim a capability the
adapter doesn't actually provide.

## 8. Provider Independence

Four independent axes, none of which determines another:

| Axis | Current implementation |
|---|---|
| **Renderer** | Leaflet (`leaflet` + `react-leaflet`) — the only one implemented; MapLibre/OpenLayers/Google are declared, not installed. |
| **Basemap/tile provider** | OpenStreetMap raster tiles (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`), used directly by the Leaflet adapter's `<TileLayer>`. Swapping to MapTiler/Stadia/etc. only touches that adapter. |
| **Geocoder** | Nominatim (OpenStreetMap), but only ever reached through `app/api/geocode/route.ts` — every client caller (`lib/geocodeLocation.ts`, the admin events pages) already goes through that server route, not Nominatim directly. This is a working existing example of provider independence: the geocoder could change server-side with zero client changes. A separate server route, `app/api/google/nearby-search/route.ts`, uses the Google Places API for admin place-search/import — a second, already-independent provider used for data entry, unrelated to which renderer draws the resulting places on a map. |
| **External navigation** | User-selected per person (`localStorage["nearby-navigation-preference"]`, `"apple" \| "google"`), building a `maps.apple.com`/`google.com/maps` deep link. Already fully decoupled from the renderer — Nearby's map could switch to MapLibre tomorrow and Directions would be unaffected. (`lib/maps.ts` contains equivalent URL builders used elsewhere; `app/member/nearby/page.tsx`'s own `handleDirections` does not currently call into it — a pre-existing minor duplication, unrelated to this framework, not touched here.) |
| **Device geolocation** | Not currently used anywhere in the mapping stack. Nearby's distances are computed from the *event's* stored lat/lng, not the device's live position (`lib/calculateDistanceMiles.ts`). `MapUserLocation` (§3) is defined for when a consumer needs this. |

A renderer choice must not automatically determine any of the other four
unless technically unavoidable (e.g. Google's renderer will realistically
pull in Google's own basemap tiles). Stage 1 introduces no new provider
and changes none of the above; it only extracts Nearby's existing choices
behind the contract.

## 9. Renderer Registry

`lib/mapSurface/registry.ts` is the one governed resolution point:

```ts
resolveMapRenderer(rendererId?: MapRendererId): ComponentType<MapRendererProps>
getMapRendererCapabilities(rendererId?: MapRendererId): MapRendererCapabilities
```

Both default to `DEFAULT_MAP_RENDERER_ID` (`"leaflet"`) when no id is
given. `EpicentraxMapSurface` calls `resolveMapRenderer()` with no
argument — there is currently no user-facing or per-consumer renderer
selection, exactly as scoped for Stage 1. If code outside this file ever
needs to branch on which renderer is active, that's a sign the branch
belongs in the registry or an adapter instead.

Only `"leaflet"` is registered. Calling `resolveMapRenderer("maplibre")`
today throws a clear "not registered" error rather than silently falling
back — a renderer that isn't really there should fail loudly, not
pretend to work.

## 10. Current Leaflet Adapter

`components/map/adapters/leaflet/LeafletMapRenderer.tsx` is the only file
in this framework permitted to import `"leaflet"` or `"react-leaflet"`.
It is a structural extraction of Nearby's last real-device-confirmed
baseline, not a behavior change: `MapContainer`/`TileLayer`/`Marker` with
the same OSM tile URL, the same `L.icon()` marker image, the same
Tooltip-based label-on-tap/hover/focus behavior, the same map-background
click dismissal, and the same pan/pinch/zoom configuration as before
Stage 1. It reports `leafletRendererCapabilities` (§7) alongside itself
to the registry.

It does not attempt the marker-to-ObjectPanel handoff — that remains the
two-step `onObjectSelect` (marker tap) → `onObjectActivate` (card tap)
flow described in §5, unchanged from the current baseline.

## 11. Nearby Migration (Stage 1 boundary)

```
app/member/nearby/page.tsx
        |  Place[] -> MapObject[] (local mapping, Nearby's own knowledge)
        v
EpicentraxMapSurface   (renderer-neutral props only)
        |
        v
LeafletMapRenderer  ->  React-Leaflet / Leaflet
```

`app/member/nearby/page.tsx` now imports only `@/lib/mapSurface/contract`
(for the `MapObject` type) and `@/components/map/surface/
EpicentraxMapSurface` (dynamically, `ssr: false`, same as before). It
contains no `leaflet`, `react-leaflet`, `MapContainer`, `Marker`,
`Tooltip`, `useMap`, or `useMapEvents` reference — confirmed by repository
search (see the Stage 1 report). The retired `components/map/
NearbyPlacesMap.tsx` (superseded by the adapter + surface split) was
deleted; nothing else referenced it.

## 12. Migration Path: Adding a Renderer

Adding MapLibre, OpenLayers, Google, or another future renderer should
require approximately:

1. `npm install` the renderer's package(s).
2. Create `components/map/adapters/<renderer>/<Renderer>MapRenderer.tsx`
   implementing `MapRendererProps` (`lib/mapSurface/contract.ts`) —
   translate `MapObject[]` into the renderer's native layer/marker calls,
   translate the renderer's own interaction model into
   `onObjectSelect`/`onBackgroundActivate`/`onViewportChange`, and export
   a `<renderer>RendererCapabilities: MapRendererCapabilities` reporting
   what's actually wired up (§7).
3. Register it in `lib/mapSurface/registry.ts`'s `MAP_RENDERERS` map.
4. Test its capabilities against whatever the consuming feature actually
   requires (§13, testing requirements).
5. Switch `DEFAULT_MAP_RENDERER_ID`, or pass an explicit `rendererId`
   through a future `resolveMapRenderer` call site, to change
   configuration.

It should not require touching Nearby's domain logic, `EpicentraxMapSurface`,
or any other consumer, because none of them know a renderer package
exists.

### MapLibre GL JS

Vector-tile-native; would legitimately flip `supportsVectorLayers` and
likely `supportsRotation`/`supportsPitch` to `true`. Its marker/popup
API and gesture model differ substantially from Leaflet's, but that
entirely disappears inside the adapter.

### OpenLayers

Feature/layer-based rather than marker-based; the adapter's job is
heavier (constructing a vector source/layer from `MapObject[]` rather
than one marker per object) but the contract does not change — OpenLayers
`Feature`s stay inside the adapter per §3/§4.

### Google Maps JavaScript API

Requires an API key and pulls in Google's own basemap by default (§8 — a
case where renderer and basemap are not fully independent for practical
reasons). `AdvancedMarkerElement` and Google's own click/gesture events
translate to the same three interaction callbacks; nothing about Google's
API surface should appear outside its adapter.

## 13. Scope Discipline

This is not a GIS framework. `lib/mapSurface/contract.ts` intentionally
omits things a real GIS abstraction would have — arbitrary vector styling,
projection selection, raster/vector layer stacking, drawing/editing tools
— because no current or clearly planned EpicentraX consumer needs them.
When a second geographic consumer appears with a genuinely new need, grow
the contract by exactly that much, in the same small/stable spirit; do
not pre-build capacity for renderers or features that aren't there yet.

## 14. Testing Requirements

- `npx tsc --noEmit` and targeted ESLint on every changed file, same as
  any other change in this repository.
- Any new adapter must be exercised against the real-device interaction
  path its renderer uses for touch (the Nearby history is the concrete
  reason this matters — a renderer's *synthesized* click is not
  sufficient real-device proof on its own).
- Before registering a new renderer as `DEFAULT_MAP_RENDERER_ID` for any
  existing consumer, its reported `MapRendererCapabilities` must be
  verified against what that consumer actually exercises, not assumed
  from the renderer's marketing feature list.
- A production `npm run build` and `git diff --check` before any
  renderer-framework change is considered complete.

## 15. Prohibition on Renderer-Specific Leakage

No file outside `components/map/adapters/<renderer>/` may import a
renderer package, reference a renderer-native type (`L.Marker`, MapLibre
`Feature`, Google `google.maps.*`, OpenLayers `Feature`/`Style`), or
branch on `MapRendererId` outside `lib/mapSurface/registry.ts`. A code
review that finds any of these outside those two boundaries has found a
violation of this document, independent of whether the resulting code
"works."

## 16. Stage 5A Audit Re-Confirmation

Stage 5A's brief required a fresh, non-assuming audit before touching
anything further. Repository-wide search (repeated, not reused from
Stage 1's report) confirmed:

- **Direct Leaflet/react-leaflet imports:** exactly one file —
  `components/map/adapters/leaflet/LeafletMapRenderer.tsx`.
- **`L.icon`/`L.marker`/`L.map`/`L.divIcon`/`L.control` usage:** exactly
  one call site, `markerIcon = L.icon(...)` in that same adapter file.
- **`fitBounds`/`setView`/`flyTo`/`panTo`:** exactly one call,
  `map.setView(...)` inside `ViewportResizer` in that same adapter file.
  (Every other `setView*`/`fitBounds`-shaped match in the repository —
  `setViewMode`, `setViewerMessage`, `setViewportTransform` — belongs to
  unrelated component state or the separate canvas venue-map system; see
  the Purpose section's scope note.)
- **Layer handling:** no `layerGroup`, `addLayer`, `L.geoJSON`,
  `L.polygon`, `L.polyline`, or `L.circle` usage anywhere. The adapter
  renders exactly one `<TileLayer>` and one `<Marker>` per object — no
  layer-switching or multi-layer logic exists to migrate.
- **CSS targeting Leaflet:** zero `.leaflet-*` selectors in
  `app/globals.css` or any other stylesheet in the repository. (Stage 4C
  had introduced some; they were removed as part of the Nearby
  marker-interaction work before Stage 1 began.)
- **User-location handling:** none. `navigator.geolocation` /
  `getCurrentPosition` / `watchPosition` do not appear anywhere in the
  repository. `MapUserLocation` (§3) remains defined but unconsumed.
- **Event-propagation-dependent application behavior:** the marker's
  focus/blur → `openTooltip()`/`closeTooltip()` wiring (keyboard
  accessibility) is the only place application behavior depends on a
  Leaflet-specific mechanism beyond the semantic callbacks, and it is
  entirely contained inside the adapter — nothing outside it depends on
  Leaflet's tooltip lifecycle.

Conclusion: Stage 1's boundary already holds. Stage 5A found no
additional Leaflet leakage to extract.

## 17. Stage 5A Forward-Declared Vocabulary

`lib/mapSurface/contract.ts` gained, without changing any existing type:

- `MapPointGeometry` / `MapPolygonGeometry` / `MapPolylineGeometry` /
  `MapFeatureGeometry` — a geometry union, and
- `MapFeature` — the general geometry-aware object shape Stage 5A's brief
  calls for (`MapFeature`/`MapPointFeature`/`MapPolygonFeature`/
  `MapPolylineFeature`).
- `MapLayer` — a named, visibility-toggleable group of `MapFeature`s.
- `MapInteraction` — the semantic interaction vocabulary
  (`objectSelect`/`objectActivate`/`mapBackgroundActivate`/
  `viewportChange`) expressed as data, for anything that needs to log,
  replay, or reason about an interaction as a value rather than a
  callback invocation.
- `MapRendererAdapter<TComponent>` — the registry-entry shape (renderer
  id + component + capabilities), promoted from an unexported local type
  in `lib/mapSurface/registry.ts` to a named, exported contract concept.

**Deliberately not done:** renaming `MapObject` to `MapPointFeature`, or
migrating Nearby/the Leaflet adapter/the registry onto `MapFeature`
everywhere. `MapObject` is Stage 1's already-implemented, already
real-device-relevant, point-only shape; every current consumer, adapter,
and test depends on its exact fields. Stage 5A's own Part A instructs
"exact naming may follow existing project conventions" and "preserve
current production behavior as much as possible" — renaming a working,
migrated type to satisfy an illustrative name list would trade a real,
working boundary for cosmetic vocabulary alignment, for no consumer that
exists today. `MapFeature` and its geometry family are declared,
unimplemented groundwork, in the same spirit as `MapRendererId`'s
`"maplibre"`/`"openlayers"`/`"google"` members: present so a future
consumer or adapter has somewhere to grow without a contract change, not
wired into anything today. `MapObject` itself remains a valid,
intentionally-simpler specialization for point-only, presentation-rich
consumers like Nearby — it is not deprecated by `MapFeature` existing.

## 18. Stage 5A Event-Ownership Trace (Mobile Pin Interaction)

Traced fresh against the current adapter (`components/map/adapters/
leaflet/LeafletMapRenderer.tsx`), not assumed from prior-stage narrative:

```
physical tap on marker
        |
Leaflet's native DOM click handling on the marker's icon element
        |
Marker eventHandlers.click  ->  onObjectSelect(object.id)
        |
LeafletMapRenderer's caller (EpicentraxMapSurface, then Nearby)
        |
Nearby: setSelectedMapObjectId(objectId)   <- EpicentraX-owned state
        |
EpicentraxMapSurface derives `selectedObject` from that id and renders
the renderer-agnostic SelectedObjectCard
        |
tap on SelectedObjectCard  ->  onObjectActivate(objectId)  (plain React
onClick, zero Leaflet/renderer dependency)
        |
Nearby: openPlacePanel(place)  ->  existing ObjectPanel
```

Separately, Leaflet's own Tooltip (bound per-marker, hover/focus/click
trigger, `interactive={false}`) opens and closes entirely inside Leaflet
— `marker.openTooltip()`/`closeTooltip()` are called only from the
adapter's own focus/blur wiring, and Leaflet's internal tooltip
open-on-click binding (a Leaflet-internal mechanism, not application
code) is independent of `onObjectSelect`. **This satisfies the hard
requirement in Stage 5A Part A.3: the Tooltip is presentational only:
EpicentraX's selection state (`selectedMapObjectId` in
`app/member/nearby/page.tsx`) is never read from, or inferred from,
Leaflet's tooltip/popup state.** Nothing in this trace changed between
Stage 1 and Stage 5A — Stage 1 already enforced this by construction when
it extracted the adapter; Stage 5A's audit (§16) re-confirms it rather
than re-implementing it.

**Single-gesture select-vs-dismiss exclusivity:** Leaflet's own hit-testing
(`_findEventTargets` in `leaflet-src.js`) walks up from the DOM element a
native click actually targets and attributes the event to the first
interactive layer found; if none is found, and only then, it falls back
to the map's own click listener (`BackgroundActivation`'s
`useMapEvents`). A marker click and a map-background click are therefore
structurally mutually exclusive outcomes of the same native event in
Leaflet's own design — one physical tap cannot fire both `onObjectSelect`
and `onMapBackgroundActivate`. This was verified by reading Leaflet's
source during the real-device investigation that preceded Stage 1 (see
that investigation's history); Stage 5A's contribution is confirming this
guarantee now lives entirely inside the adapter, where it belongs, rather
than being reasoned about anywhere a domain consumer could see.

**What remains unresolved, stated without guessing:** a real-device
diagnostic pass captured during that investigation proved that on one
specific iPhone, in a configuration where Leaflet's Tooltip had been
*removed*, a marker's `touchstart`/`pointerdown` reliably reached the
marker's DOM element but Leaflet's synthesized `click` did not get
attributed to the marker at all (it was attributed to the map background
instead). That evidence was captured in the Tooltip-*absent* configuration
and does not directly describe the current, Tooltip-*present* code this
document and Stage 5A's adapter now ship. The best available real-device
evidence for the current configuration is the person's own prior report,
made before that diagnostic investigation began, that marker tap and
marker replacement were "confirmed working" — but that observation
cannot distinguish "the Leaflet Tooltip visually switched" from "the
application's own `selectedMapObjectId` state changed," since both would
look identical to someone watching the screen. This session has no
device to retest with. The concrete, narrow question a real-device retest
should answer is not "does a label appear" (already answered) but
specifically: **after tapping a marker, does the `SelectedObjectCard`
below the map appear/change** — that is the observable proof
`onObjectSelect` actually fired, independent of the Tooltip.

## 19. Governed Venue Evidence Foundation (Master Maps)

Stage 5A Part B. This section is a Master Maps concern, not a renderer
concern — it shares this document only because Stage 5A's own brief places
both under one architectural picture (§20). It does not depend on, and is
not gated by, §1-§18.

### 19.1 Purpose

Master Maps today has exactly one way to get venue geometry: an
administrator manually uploads an image and places sites on it
(`app/admin/master-maps/[id]`, backed by `public.master_maps` /
`public.master_map_sites`). This section introduces a place for evidence
*about* a venue — from an admin upload, a venue's own website, a published
PDF or image, an open geospatial/public GIS source, a structured external
source, manual entry, or field verification — to be recorded with
provenance, *without* that evidence ever becoming authoritative Master Map
content on its own. It is deliberately just a foundation: no discovery
crawler, no automated digitization, no proposed-map generation, and no
admin review UI ship in this stage (see §21, Non-Goals and Future
Compatibility).

### 19.2 Hard Rule: Evidence Is Not Authority

```
Venue Evidence
      |
Candidate / proposed representation
      |
Admin review
      |
Approved Master Map
```

`public.venue_evidence` rows never write to `public.master_maps` or
`public.master_map_sites`, in either direction, under any circumstance —
not on insert, not on review approval. Both governed functions
(`public.record_venue_evidence`, `public.review_venue_evidence`) touch
`public.venue_evidence` exclusively; each carries an explicit in-file
comment stating this and warning against adding such a write later without
a new, separately governed pathway. `public.master_maps` remains the
governed operational venue representation, authoritative until explicitly
changed through the existing manual admin workflow — evidence sitting in
`public.venue_evidence`, however many rows accumulate, changes nothing
about it.

### 19.3 Schema

`supabase/migrations/20260810120000_create_governed_venue_evidence_foundation.sql`
(additive; created, not applied — see §19.5).

**`public.venue_evidence`**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid PK` | |
| `tenant_id` | `uuid NOT NULL REFERENCES tenants(id)` | Matches `public.responsibilities`' tenant-scoping convention. |
| `master_map_id` | `uuid REFERENCES master_maps(id)` | Nullable — evidence may precede an approved Master Map. |
| `venue_label` | `text` | Nullable — free-text venue identifier when no Master Map exists yet. `CHECK` requires `master_map_id` or `venue_label` (never neither). |
| `source_type` | `text NOT NULL CHECK (...)` | `admin_upload \| venue_website \| published_pdf \| published_image \| open_geospatial \| public_gis \| structured_external_source \| manual_entry \| field_verification`. |
| `source_url` | `text` | Nullable — applicable to web/PDF/image/GIS sources. |
| `source_reference` | `text` | Nullable — free-text identifier (storage path, dataset id, layer name). |
| `evidence_quality` | `text NOT NULL DEFAULT 'external' CHECK (...)` | `governed \| external \| partial \| stale \| unavailable` — **the exact `SliceEvidenceQuality` vocabulary** from `lib/experienceContext/types.ts`, reused rather than a second competing classification. Deterministic, not a probability score. |
| `observed_at` | `timestamptz` | Nullable, independent of `collected_at`/`created_at` — mirrors `SliceEvidenceQuality`'s paired `observedAt` convention: null means no observation timestamp was actually available, never a fabricated one. |
| `collected_at` | `timestamptz NOT NULL DEFAULT now()` | When the evidence itself was gathered (may be backfilled earlier than row insertion). |
| `status` | `text NOT NULL DEFAULT 'pending_review' CHECK (...)` | `pending_review \| approved \| rejected`. |
| `reviewed_by` | `text` | Nullable until reviewed; **not** a foreign key — matches `parking_repair_manifest.approved_by` / `event_photos.photo_approved_by`, an external/organizational reference rather than a live identity link. |
| `reviewed_at` | `timestamptz` | Nullable until reviewed. A named `CHECK` constraint (`venue_evidence_review_shape_check`) enforces `reviewed_by`/`reviewed_at` are null iff `status = 'pending_review'`, mirroring `parking_repair_manifest`'s and `master_site_identity_correction`'s approval-consistency checks. |
| `notes` | `text` | Nullable, admin free text. |
| `metadata` | `jsonb NOT NULL DEFAULT '{}'` | Flexible per-source-type structured data (e.g. a GIS layer name, PDF page count). |
| `created_at` / `updated_at` | `timestamptz` | Standard convention; `updated_at` maintained by a dedicated `set_venue_evidence_updated_at()` trigger, matching `public.responsibilities`/`public.assignments`. |

### 19.4 Governance and RLS

**History, condensed** (full detail in
`EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md`, which
this section defers to rather than duplicates): v1 of this migration gated
every check on `public.is_active_admin(auth.uid())` alone — a real
cross-Tenant exposure on Tenant-scoped data. v2 tightened every check to
`privilege_group = 'super_admin'` as a reported, fail-closed interim
measure, after a repository-wide audit found no Tenant-scoped
admin-authority primitive existed anywhere in this codebase yet (that
audit is preserved in full in the Administrative Authority Foundation
doc, since it applies well beyond this one table).

**Current state (v3): the primitive now exists.**
`public.has_tenant_admin_authority(auth_user_id, tenant_id)` — Super
Admin for any Tenant, or an explicit `public.admin_tenant_access`
assignment for that Tenant — is defined in
`20260810110000_create_administrative_authority_foundation.sql`, applied
before this migration, and every check below now calls it:

- RLS enabled. Deny-by-default (`REVOKE ALL` from `PUBLIC`/`anon`/
  `authenticated`/`service_role`), matching `public.responsibilities` /
  `public.assignments`.
- Exactly one policy: `venue_evidence_tenant_admin_select_policy` —
  `SELECT`, to `authenticated`, `USING (public.has_tenant_admin_authority(auth.uid(), tenant_id))`.
  No anonymous read.
- **No INSERT/UPDATE/DELETE grant or policy exists.** Every write goes
  through one of two `SECURITY DEFINER` functions, both `SET search_path
  TO 'pg_catalog'` and fully-qualifying every table reference, both
  `GRANT EXECUTE`d only to `authenticated` (never `anon`):
  - `public.record_venue_evidence(...)` — the only legal insert path, for
    every `source_type` including `admin_upload`. Always inserts `status =
    'pending_review'`; the caller cannot set `status`/`reviewed_by`/
    `reviewed_at` directly. Authority is checked against the
    caller-supplied `p_tenant_id` (there is no stored row yet to resolve
    one from) — a Tenant A admin cannot write into Tenant B by passing a
    different `p_tenant_id`, because the primitive re-derives their
    actual assignment(s) from `admin_tenant_access`, not from anything
    the caller asserts.
  - `public.review_venue_evidence(evidence_id, decision, reviewer,
    notes?)` — the only legal `status` transition, `pending_review ->
    approved | rejected`. **Takes no `tenant_id` parameter at all**;
    authority is checked against `v_row_tenant_id`, looked up from the
    stored row by `evidence_id` *before* the authority check runs, so
    there is nothing a caller can substitute and no path to check
    authority against a value they supplied. Sets `reviewed_by`/
    `reviewed_at` atomically with the decision, and touches
    `public.venue_evidence` only (§19.2).
- A dedicated `BEFORE UPDATE` trigger, `prevent_venue_evidence_tenant_change`,
  rejects any attempted change to `tenant_id` at the database level —
  defense in depth on top of there being no write grant and no RPC that
  touches the column post-insert. Unchanged by this revision.
- This directly satisfies "do not create browser-direct writes that
  bypass governance": there is no Postgres grant that would let a browser
  client (even an authenticated Tenant Admin session) `INSERT`/`UPDATE`
  the table directly through PostgREST — only through the two governed
  entry points, application-code-callable via `supabase.rpc(...)`.
- `master_maps`/`master_map_sites` themselves have **no RLS today** — a
  pre-existing gap, confirmed by inspection, not introduced or widened by
  this migration and out of scope to fix here.

### 19.5 Migration Status

Created, additive, **not applied**. No `supabase db push` (or equivalent)
was run — this session has no authorization to modify a linked database,
and no local Docker/Supabase instance was available to test-apply it in a
throwaway environment. The migration was inspected by hand against the
exact conventions of five existing precedent migrations (naming, header
style, RLS posture, review-state shape, `SECURITY DEFINER` pattern) rather
than executed. It should be applied to a local/staging environment and
reviewed before any production push, per standard practice and per this
stage's own instruction not to push without inspection.

### 19.6 Preserved: Existing Master Map Administration

Nothing in this migration alters `public.master_maps`,
`public.master_map_sites`, their (nonexistent) RLS, or any admin route
(`app/admin/master-maps/**`, `app/admin/parking/**`, `app/admin/map-admin/
**`). Admins can continue to upload a map, create a Master Map, place/edit
sites, and manage everything exactly as before — `venue_evidence` is
additive, parallel infrastructure with no foreign key *from* `master_maps`
*to* it and no trigger, view, or application code (yet) connecting the
two beyond `venue_evidence.master_map_id`'s optional, one-directional
reference.

## 20. Architectural Separation (Stage 5A Part C)

```
Future Venue Discovery
        |
Intelligence Collector
        |
Venue Evidence            <- §19 ships this layer only
        |
Venue Resolver / Governance   <- not built; §19's two RPCs are its
        |                         minimal, current stand-in
Master Map
        |
Map Interface              <- §2's EpicentraxMapSurface, today serving
        |                      only Nearby; Master Maps does not route
        |                      through it (see Purpose, "Scope: geographic
        |                      maps only")
Renderer Adapter
        |
Leaflet / MapLibre / Future
```

Ownership, restated precisely because Stage 5A's brief requires it stated,
not merely implied by the rest of this document:

- **Renderer** (§2, §10) owns drawing, renderer-specific interaction
  detection, and renderer-specific viewport operations. It does not own
  venue truth, domain identity, authorization, object meaning,
  authoritative selection state, or Master Map governance — enforced by
  §1-§18 and the containment boundary in §15.
- **Venue Evidence** (§19) owns source provenance and candidate/reference
  information. It does not, and structurally cannot (§19.2, §19.4),
  automatically become authoritative.
- **Master Map** (`public.master_maps`) remains the governed operational
  venue representation, unchanged by this stage (§19.6).
- **EpicentraX UI / Experience Layer** (Nearby today) owns application
  interaction and selected-object state (§18) — never a renderer's
  tooltip/popup state, never venue evidence directly.

The "Map Interface" row above is aspirational for Master Maps, not a
Stage 5A deliverable: Master Maps continues to render through the
separate canvas system (see Purpose) in this stage. Nothing in §19
requires or assumes that changes.
