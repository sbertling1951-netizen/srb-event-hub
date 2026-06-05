# GestureMapViewportV2 — required additions (for Phase 2 parity + authoring layer)

Phase 2 must drive both renderers to *identical* viewport states deterministically,
which needs a programmatic transform setter. These additions are small, additive,
and otherwise inert. Apply inside `GestureMapViewportV2`.

## 1. Imperative handle additions

Add a lock ref near the other refs:

```ts
const gestureLockedRef = useRef(false);
```

Extend the handle (`useImperativeHandle(ref, () => ({ ... }))`):

```ts
getViewportTransform: () => ({
  x: stateRef.current.x,
  y: stateRef.current.y,
  scale: stateRef.current.scale,
}),

// deterministic state-set, used by the parity harness and saved-view features
setViewportTransform: ({ x, y, scale }: { x: number; y: number; scale: number }) => {
  stateRef.current = { x, y, scale };
  renderTransform();
},

setGestureLocked: (locked: boolean) => {
  gestureLockedRef.current = locked;
},
```

Extend the handle type:

```ts
export type GestureMapViewportHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  centerOn: (mapX: number, mapY: number, scale?: number) => void;
  getViewportTransform: () => { x: number; y: number; scale: number };
  setViewportTransform: (t: { x: number; y: number; scale: number }) => void;
  setGestureLocked: (locked: boolean) => void;
};
```

## 2. Honor the lock in the gesture handlers

At the top of the `useDrag` and `usePinch` callbacks:

```ts
if (gestureLockedRef.current) return memo; // authoring layer owns this gesture
```

## 3. Mouse drag-vs-tap guard (prevents pan-release from firing a placement)

In `onPointerDown`, record the start; in `onPointerUp` (mouse branch), only fire
`onTap` if movement was below a small threshold:

```ts
// onPointerDown:
pointerDownRef.current = { x: e.clientX, y: e.clientY };

// onPointerUp, before firing onTapRef.current?.(...):
const down = pointerDownRef.current;
pointerDownRef.current = null;
if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
```

with `const pointerDownRef = useRef<{ x: number; y: number } | null>(null);`.

## 4. MapCanvas handle: forward the setter

Add to `MapCanvasHandle` and `MapCanvas`'s `useImperativeHandle` so the harness can
drive the MapCanvas pane the same way:

```ts
setViewportTransform: (t) => viewportRef.current?.setViewportTransform?.(t),
```

All four are additive; nothing existing changes behavior until called.
