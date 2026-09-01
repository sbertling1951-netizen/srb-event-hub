// ---------------------------------------------------------------------------
// Namespace migration — Stage A compatibility helpers (Cohort N1).
//
// During the compatibility window, fresh Tier 1–4 identity / session /
// Event-context / cross-tab state is written under canonical `epicentrax-`
// names only. Legacy `fcoc-` values remain readable, migrate forward when
// canonical state is absent, and remain accepted by listeners.
//
// This module contains the ONLY fallback / dual-write logic; consumers never
// hand-roll it. It performs no React work and no network I/O.
// ---------------------------------------------------------------------------

import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "@/lib/storageKeys";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

// canonical value -> legacy value, for the N1-migrated subset.
const CANONICAL_TO_LEGACY: Record<string, string> = {};
for (const prop of Object.keys(LEGACY_STORAGE_KEYS) as Array<
  keyof typeof LEGACY_STORAGE_KEYS
>) {
  CANONICAL_TO_LEGACY[STORAGE_KEYS[prop]] = LEGACY_STORAGE_KEYS[prop];
}

/** The legacy `fcoc-` name paired with a canonical key, or null if unmigrated. */
export function legacyStorageKeyFor(canonicalKey: string): string | null {
  return CANONICAL_TO_LEGACY[canonicalKey] ?? null;
}

/**
 * Read `canonicalKey` first. If absent, read `legacyKey`; when only the
 * legacy value exists, copy it forward to the canonical key (migrate-on-read)
 * and return it. `null` if neither is present.
 */
export function readMigratingLocal(
  canonicalKey: string,
  legacyKey: string,
): string | null {
  if (!hasWindow()) {
    return null;
  }
  try {
    const canonical = localStorage.getItem(canonicalKey);
    if (canonical !== null) {
      return canonical;
    }
    const legacy = localStorage.getItem(legacyKey);
    if (legacy !== null) {
      try {
        localStorage.setItem(canonicalKey, legacy);
      } catch {
        // quota / private-mode -- returning the legacy value is still correct.
      }
    }
    return legacy;
  } catch {
    return null;
  }
}

/** Write the same value to both the canonical and the legacy key. */
export function dualWriteLocal(
  canonicalKey: string,
  legacyKey: string,
  value: string,
): void {
  if (!hasWindow()) {
    return;
  }
  try {
    localStorage.setItem(canonicalKey, value);
    localStorage.setItem(legacyKey, value);
  } catch {
    // ignore storage failures (private mode / quota)
  }
}

/** Write a newly established value under its canonical name only. */
export function writeCanonicalLocal(canonicalKey: string, value: string): void {
  if (!hasWindow()) {
    return;
  }
  try {
    localStorage.setItem(canonicalKey, value);
  } catch {
    // ignore storage failures (private mode / quota)
  }
}

/**
 * Emit a cross-tab `storage`-event signal under both key names. Identical to
 * dualWriteLocal; named for intent at the call sites that fire signal pings.
 */
export const dualSignalLocal = dualWriteLocal;

/** Emit a cross-tab storage signal under its canonical name only. */
export const signalCanonicalLocal = writeCanonicalLocal;

/** Remove both the canonical and the legacy key. */
export function dualRemoveLocal(canonicalKey: string, legacyKey: string): void {
  if (!hasWindow()) {
    return;
  }
  try {
    localStorage.removeItem(canonicalKey);
    localStorage.removeItem(legacyKey);
  } catch {
    // ignore
  }
}

/**
 * True if a `storage` event's `.key` is any of the given canonical keys OR
 * their legacy counterparts. Used by cross-tab listeners so a legacy tab's
 * write still notifies a Stage-A tab (and vice-versa).
 */
export function storageEventMatches(
  eventKey: string | null,
  ...canonicalKeys: string[]
): boolean {
  if (!eventKey) {
    return false;
  }
  for (const canonical of canonicalKeys) {
    if (eventKey === canonical) {
      return true;
    }
    const legacyName: string | undefined = CANONICAL_TO_LEGACY[canonical];
    if (legacyName && eventKey === legacyName) {
      return true;
    }
  }
  return false;
}

/** Dispatch a same-tab `window` CustomEvent under both names. */
export function dualDispatchWindowEvent(
  canonicalName: string,
  legacyName: string,
): void {
  if (!hasWindow()) {
    return;
  }
  window.dispatchEvent(new CustomEvent(canonicalName));
  window.dispatchEvent(new CustomEvent(legacyName));
}

/** Dispatch a same-tab CustomEvent under its canonical name only. */
export function dispatchCanonicalWindowEvent(canonicalName: string): void {
  if (!hasWindow()) {
    return;
  }
  window.dispatchEvent(new CustomEvent(canonicalName));
}

/**
 * Add a `window` listener for both the canonical and legacy CustomEvent
 * name; returns an unsubscribe that removes both.
 */
export function addDualWindowEventListener(
  canonicalName: string,
  legacyName: string,
  handler: EventListener,
): () => void {
  if (!hasWindow()) {
    return () => {};
  }
  window.addEventListener(canonicalName, handler);
  window.addEventListener(legacyName, handler);
  return () => {
    window.removeEventListener(canonicalName, handler);
    window.removeEventListener(legacyName, handler);
  };
}
