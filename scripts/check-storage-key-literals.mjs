import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SOURCE_ROOTS = ["app", "lib", "components"];
const REGISTRY = "lib/storageKeys.ts";
// The centralized Stage A namespace-migration helper is the ONLY module
// outside the registry allowed to name both the canonical and legacy key
// strings (it derives its canonical->legacy map from the registry exports).
const MIGRATION_HELPER = "lib/storageMigration.ts";
// Raw platform literals that are NOT storage/event keys governed by the
// registry and are therefore exempt. `epicentrax-shared-device` is the
// pre-existing neutral shared-device flag owned by lib/supabase.ts and is
// deliberately NOT folded into the registry in this cohort.
const NON_PLATFORM_LITERALS = new Set(["epicentrax-shared-device"]);
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx)$/;
const TEST_FILE = /\.(?:test|spec)\.[^.]+$/;
// Governs both the fcoc-* compatibility literals kept during the migration
// window and the new epicentrax-* runtime identifiers.
const RAW_PLATFORM_LITERAL =
  /(["'`])((?:fcoc|epicentrax)-[A-Za-z0-9_-]+[^"'`\n]*)\1/g;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(fullPath);
    }
    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)
      ? [fullPath]
      : [];
  });
}

const violations = [];

for (const sourceRoot of SOURCE_ROOTS) {
  for (const file of sourceFiles(join(ROOT, sourceRoot))) {
    const filePath = relative(ROOT, file);
    if (filePath === REGISTRY || filePath === MIGRATION_HELPER) {
      continue;
    }

    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(RAW_PLATFORM_LITERAL)) {
      if (NON_PLATFORM_LITERALS.has(match[2])) {
        continue;
      }
      const line = source.slice(0, match.index).split("\n").length;
      violations.push(`${filePath}:${line}: ${match[2]}`);
    }
  }
}

if (violations.length > 0) {
  console.error(
    "Raw platform key literals must be defined in lib/storageKeys.ts:\n" +
      violations.join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log("Storage/event key registry guard passed.");
}
