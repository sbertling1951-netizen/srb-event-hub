import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { readAndMigrateTier5LocalStorage } from "@/lib/tier5StorageMigration";

class MemoryStorage {
  private values = new Map<string, string>();
  failCanonicalWrite = false;
  setCalls: string[] = [];

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.setCalls.push(key);
    if (this.failCanonicalWrite && key.startsWith("epicentrax-")) {
      throw new Error("storage quota exceeded");
    }
    this.values.set(key, value);
  }
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

function installStorage(storage: MemoryStorage) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
}

test("canonical Tier 5 state wins over a previous FCOC preference value", () => {
  const storage = new MemoryStorage();
  installStorage(storage);
  storage.setItem("epicentrax-nearby-favorites", '["canonical"]');
  storage.setItem("fcoc-nearby-favorites", '["previous"]');

  assert.equal(
    readAndMigrateTier5LocalStorage(
      "epicentrax-nearby-favorites",
      "fcoc-nearby-favorites",
    ),
    '["canonical"]',
  );
});

test("a previous Tier 5 value migrates to its canonical key on read", () => {
  const storage = new MemoryStorage();
  installStorage(storage);
  storage.setItem("fcoc-attendee-import-run::event-a", "run-a");
  const legacyWritesBeforeRead = storage.setCalls.filter(
    (key) => key === "fcoc-attendee-import-run::event-a",
  ).length;

  assert.equal(
    readAndMigrateTier5LocalStorage(
      "epicentrax-attendee-import-run::event-a",
      "fcoc-attendee-import-run::event-a",
    ),
    "run-a",
  );
  assert.equal(
    storage.getItem("epicentrax-attendee-import-run::event-a"), "run-a");
  assert.equal(
    storage.setCalls.filter(
      (key) => key === "fcoc-attendee-import-run::event-a",
    ).length,
    legacyWritesBeforeRead,
  );
});

test("a failed canonical forward-copy still returns the valid previous value", () => {
  const storage = new MemoryStorage();
  installStorage(storage);
  storage.setItem("fcoc-vendor-import-run::event-a", "run-a");
  const legacyWritesBeforeRead = storage.setCalls.filter(
    (key) => key === "fcoc-vendor-import-run::event-a",
  ).length;
  storage.failCanonicalWrite = true;

  assert.equal(
    readAndMigrateTier5LocalStorage(
      "epicentrax-vendor-import-run::event-a",
      "fcoc-vendor-import-run::event-a",
    ),
    "run-a",
  );
  assert.equal(storage.getItem("epicentrax-vendor-import-run::event-a"), null);
  assert.equal(
    storage.setCalls.filter(
      (key) => key === "fcoc-vendor-import-run::event-a",
    ).length,
    legacyWritesBeforeRead,
  );
});

test("absent canonical and previous values return null", () => {
  const storage = new MemoryStorage();
  installStorage(storage);

  assert.equal(
    readAndMigrateTier5LocalStorage(
      "epicentrax-pre-rally-checklist-event-a",
      "fcoc-pre-rally-checklist-event-a",
    ),
    null,
  );
});
