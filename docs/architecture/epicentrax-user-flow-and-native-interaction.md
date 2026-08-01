# EpicentraX User Flow and Native Interaction Architecture

**Status:** Active (first implementation slice: member Nearby)
**Version:** 1.0

---

# Governing Principles

> "User flow is the primary measure of interface quality. Any interruption to that flow is friction and should be eliminated whenever practical."

> "The interface should feel like a natural extension of the user's device, not a separate system they must learn."

Every decision in this document exists to serve these two statements. Where an implementation choice and these principles conflict, the implementation must change — consistent with the Constitution (ADR-000): "When implementation and principle conflict, implementation must change."

---

# Article I — The User Flow

EpicentraX models object interaction as one recurring flow:

**Browse → Select → Understand → Act → Close → Continue**

- **Browse** — the user scans a discovery surface (a list, a map, a grid) to find something relevant.
- **Select** — the user indicates a single object using a normal, native input action (tap, click, or keyboard activation).
- **Understand** — the interface presents what that object is: its identity, its detail, its current state.
- **Act** — the user performs a deliberate action on the object (get directions, call, visit a website, save it).
- **Close** — the user dismisses the detail view.
- **Continue** — the user resumes browsing from exactly where they left off.

Every step this flow supports is friction removed. Every step it interrupts unnecessarily is friction added. A feature is not "done" because it displays correct data; it is done when it lets the user move through this flow without being second-guessed, reset, or relocated.

---

# Article II — Discovery Surfaces vs. Object Panels

EpicentraX distinguishes two kinds of surface, and does not let their responsibilities blur:

- **Discovery surfaces** (lists, cards, maps) exist to help the user **find** an object. They optimize for scanning: density, filtering, sorting, search, and spatial layout.
- **Object panels** exist to help the user **understand and act on** a single object once found. They optimize for comprehension and action: full detail, clear primary/secondary actions, and a way back.

A discovery surface should never try to do an object panel's job (cramming full detail into a card destroys scannability). An object panel should never try to do a discovery surface's job (it has no independent navigation, filtering, or routing of its own — it only ever shows what the discovery surface handed it).

The reusable `ObjectPanel` component (`components/ObjectPanel.tsx`) is the platform's one authoritative implementation of the "Understand and Act" step. It is intentionally white-label: it accepts a title, subtitle, actions, body, and footer, and contains no domain-specific business logic. Every consuming page supplies its own data and its own actions; the panel only supplies the interaction shell.

---

# Article III — Context Preservation

Opening and closing an object panel is a detour, not a departure. The discovery surface's state must survive that detour exactly as the user left it:

- Scroll position on the discovery surface.
- The selected object itself (through rotation and resizing, not just through open/close).
- Map center and zoom, where a map is the discovery surface.
- Active filters, search terms, category, and sort/view mode.
- Keyboard focus — returned to the exact control that opened the panel.

None of this is refetched or recomputed when a panel opens or closes; the panel only reads data the discovery surface already has. A user who opens an object, reads it, and closes it should be unable to tell — from list position, map camera, or filter state — that anything happened at all, other than having answered their question.

Where practical, opening a panel should also be a reversible step in browser/platform history, so back gesture and Back button close the panel before they leave the page. This is UI-state history, not a route change: it must never introduce a stale entry, a double-back, or a loop, and it must never take priority over direct page navigation.

---

# Article IV — Native Interaction Expectations

EpicentraX borrows interaction vocabulary the user already owns, rather than inventing its own. Concretely, this platform supports and does not override, wherever an input method makes it applicable:

tap, double tap, pinch-to-zoom, drag, pan, swipe, long press, right click, keyboard navigation, trackpad interaction, touchscreens, device rotation, browser Back, Android Back, iOS/iPadOS safe areas, split-screen and Stage Manager, `prefers-reduced-motion`, screen readers, and visible keyboard focus.

Practically, this means:

- Maps keep their library's native pan/zoom/marker interaction untouched; selecting an object never hijacks or replaces panning, pinching, or scroll-wheel zoom.
- Lists respond to a single tap or click to select — never a double tap, and never an overloaded long press.
- Links and buttons inside a card do their own job (call, open a URL) without also triggering selection; they are siblings of the selection control, not children of it, so there is no event-bubbling ambiguity to work around.
- Browser and system-level zoom is never suppressed (`user-scalable=no` and `maximum-scale` locks are treated as bugs, not features).
- `touch-action: none` and other gesture-suppressing CSS are avoided outside a narrowly scoped control that has a genuine, specific need for it — none exists in this slice.

---

# Article V — Custom Gestures Require Justification

A custom gesture is a small piece of vocabulary the user has to learn and remember specifically for this application. Every one of them is a withdrawal against the "natural extension of the user's device" principle.

Before introducing any custom gesture, the burden of proof is on the feature: it must be demonstrated that no established device or browser convention already solves the interaction, and that the gesture can be implemented without competing with scrolling, map interaction, browser/OS navigation gestures, or assistive technology.

Swipe-to-dismiss is the concrete example in this slice: it is a legitimate, well-understood mobile convention, but it is easy to implement in a way that fights vertical scrolling inside the panel or the OS's own edge-swipe-back gesture. This first slice does not implement it — the panel's close control, Escape, and backdrop dismissal are the guaranteed ways to close it — and swipe-to-dismiss is left as bounded future work, to be added only once it can be shown not to interfere with anything above.

---

# Article VI — Adapting to Evolving Device UI

Presentation adapts to the device and viewport, not to assumptions baked in at build time:

- Object panels present as a bottom-style inspector on narrow and wide viewports. On wide viewports, the inspector is centered and content-sized rather than docked to a far-right edge; it remains close to the discovery surface and preserves the user’s visual and interaction context. Presentation switches purely by available space (CSS media query), never by user-agent sniffing.
- Rotating a device or resizing a window changes presentation, not state — the same selected object, the same discovery-surface state, survives the transition.
- Layout accounts for `env(safe-area-inset-*)` so panel content and controls are never obscured by device chrome (notches, home indicators) or by split-screen/Stage Manager boundaries.

As device conventions change — new gestures become standard, new safe-area or windowing behaviors appear — this article expects presentation *details* to be revisited. It does not expect Articles I–III (the flow, the surface/panel split, context preservation) to change; those are the stable interaction principles the presentation serves.

---

# Article VII — Accessibility Is Native Interaction Quality

Accessibility is not a separate checklist bolted onto native interaction — it is part of what "native" means. A sighted mouse user and a screen-reader user are both using the device the way it was designed to be used, and EpicentraX treats both as first-class:

- Dialog semantics (`role="dialog"`, `aria-modal`, an accessible name) so assistive technology announces the panel correctly.
- Focus moves into the panel on open and is trapped there while it is open, and returns to the exact control that opened it on close.
- Escape closes the panel on any keyboard-capable device.
- Tab order is logical and every icon-only control (including map markers, which are icon-only by nature) carries an accessible label.
- Visible focus indicators are never suppressed.
- Motion respects `prefers-reduced-motion`; when set, panel transitions are removed rather than merely shortened.

---

# Article VIII — Presentation May Change; Principles Do Not

Future platform work is expected to change how these principles are expressed: new devices, new browser capabilities, new windowing models, new gesture conventions. Implementation details in this document — the specific breakpoint and dimensions used for the bottom-style inspector, the exact history-integration mechanism, the specific set of primary/secondary actions offered — are expected to evolve.

The flow this document exists to protect — Browse → Select → Understand → Act → Close → Continue, discovery surfaces staying discovery surfaces, object panels staying free of business logic, and context surviving every detour — is not expected to change. When a future implementation must choose between matching a new device convention and preserving this flow, the flow wins; the presentation adapts to serve it.

---

# Relationship to Other Architecture Documents

This document interprets the Constitution's Article VI (Operational Excellence: "Complexity belongs inside the platform. Simplicity belongs in the user experience.") and Article VII (Engineering Principles: "Architecture shall favor long-term clarity over short-term convenience.") for the specific case of object-level user interaction.

It governs `components/ObjectPanel.tsx` and any future consumer of it. It does not govern routing, authentication, permissions, or data architecture, which remain the responsibility of their own ADRs.
