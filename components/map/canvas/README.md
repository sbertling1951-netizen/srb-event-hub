# MapCanvas engine — build v0.1 (core scaffold)

Single source of truth for map rendering, coordinates, gestures, selection, and
authoring. Composes `GestureMapViewportV2` (the proven pan/zoom/pinch engine);
does **not** replace it. Pages provide percentages + callbacks only.

## Files

| File | Concern | Status |
|---|---|---|
| `coords.ts` | Coordinate engine (screen↔viewport↔content↔percent), fit/center, pan clamp, rect hit-test | **Pure, complete** |
| `alignment.ts` | Mean-based align + even distribute + nudge (canonical MME semantics) | **Pure, complete** |
| `useUndoStack.ts` | Position-snapshot undo (last / all) | **Complete** |
| `useSelection.ts` | Selection (single/multi/rectangle), primary+set, controlled or internal | **Complete** |
| `useMapInteraction.ts` | Touch-first authoring layer: long-press / Shift marquee, reserved marker-drag | **Logic complete; needs the V2 seam below** |
| `MarkerLayer.tsx` | Percentage-positioned marker rendering, selection visuals, labels, layers, `data-marker-id` | **Complete** |
| `MapCanvas.tsx` | Composition + imperative handle (v0.3 API) | **Integration-ready** |
| `types.ts`, `index.ts` | Public API | — |

## Subsystem coverage (the 8 requested)

1. **Coordinate engine** — `coords.ts`, the single conversion authority. Pages do zero coordinate math.
2. **Marker rendering** — `MarkerLayer.tsx`, percentage positioning everywhere (fixes the Coach-Map px divergence).
3. **Gesture ownership** — pan/zoom/pinch via V2; authoring gestures via `useMapInteraction`; one pipeline, no competing systems.
4. **Selection** — `useSelection.ts`, primary+set with single/multi/rectangle.
5. **Alignment/distribution** — `alignment.ts`, mean-based align, even distribute; results flow out via `onMarkersChange` (page persists).
6. **Undo** — `useUndoStack.ts`, captured before every position edit.
7. **Touch-capable interaction** — `useMapInteraction.ts`, built touch-first: tap-place, tap/tap-toggle select, long-press marquee (touch lasso equivalent), keyboard nudge via `handle.nudgeSelected` (desktop accelerator).
8. **Parity harness** — `parity-harness.html` + synthetic dataset; markers carry `data-marker-id` so the harness measures this engine directly.

## Required GestureMapViewportV2 additions (two small ones)

The authoring layer needs to read the live transform and suspend pan while a
marquee/marker-drag is in progress. Add to V2's imperative handle:

```ts
// inside useImperativeHandle(...) in GestureMapViewportV2
getViewportTransform: () => ({ ...stateRef.current }), // { x, y, scale }
setGestureLocked: (locked: boolean) => { gestureLockedRef.current = locked; },
```

and have the drag/pinch handlers early-return when `gestureLockedRef.current` is
true. `MapCanvas` already calls both through optional chaining, so it compiles
and runs (marquee inert) until these land — then marquee/lasso activates with no
other change. While here, also add the **mouse drag-vs-tap guard** on V2's
`onPointerUp` (only fire `onTap` if movement < ~6px) so panning on desktop
doesn't fire a placement.

## Page scroll lock CSS

`lockPageScroll` toggles `.mapcanvas-lock` on `html`/`body`. Generalize the
proven `coach-map-lock` rules under this class (the body is a momentum scroller
by default — `overflow-y:auto; -webkit-overflow-scrolling:touch` — which is what
let the page move and the iOS back-swipe fire on the un-locked pages):

```css
html.mapcanvas-lock, body.mapcanvas-lock {
  height: 100%; overflow: hidden !important;
  overscroll-behavior: none !important; -webkit-overflow-scrolling: auto !important;
}
body.mapcanvas-lock .app-main,
body.mapcanvas-lock .app-inner { height: 100dvh !important; overflow: hidden !important; overscroll-behavior: none !important; }
```

## Parity wiring

Drop the harness's measurement core (`measurePane`/`diffPanes`) into a dev route,
mount the old page renderer in pane A and `<MapCanvas>` in pane B over
`parity-test-map.png` + `parity-seed-markers.json`, drive both to the same
`{scale, pan}`, and run the matrix. Gate: ≤ 0.5px. Model-level parity already
passed (0px) for the %↔px convention change.

## Honest status

- The pure modules (`coords`, `alignment`, `useUndoStack`, `useSelection`) are complete and unit-testable today.
- The React composition compiles against the v0.3 API and is integration-ready, but **was not runtime-tested here** (no React/Next stack in the build sandbox). Verify in the repo.
- **Marquee/lasso** activates once the two V2 additions land; until then it's inert (no errors).
- **Marker drag** is reserved (callbacks + pipeline shape present), not yet implemented.
- Next: land the V2 additions, wire `MapCanvas` into the parity dev route, then convert Master Map Editor first (hardest parity gate) per the migration sequence.
