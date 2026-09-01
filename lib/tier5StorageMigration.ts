// Narrow migrate-on-read for non-authoritative Tier 5 browser-local state.
// Identity/session storage uses lib/storageMigration.ts instead.
export function readAndMigrateTier5LocalStorage(
  canonicalKey: string,
  previousKey: string,
): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const canonical = window.localStorage.getItem(canonicalKey);
    if (canonical !== null) {
      return canonical;
    }

    const previous = window.localStorage.getItem(previousKey);
    if (previous !== null) {
      window.localStorage.setItem(canonicalKey, previous);
    }

    return previous;
  } catch {
    return null;
  }
}
