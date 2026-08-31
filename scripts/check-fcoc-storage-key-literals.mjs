import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SOURCE_ROOTS = ["app", "lib", "components"];
const REGISTRY = "lib/storageKeys.ts";
// Raw "fcoc-*" string literals that are NOT platform storage/event keys and
// are therefore exempt from the registry rule. Currently empty: the former
// CSS animation literal ("fcoc-pulse 1.5s ease-out") was renamed to a
// neutral identifier.
const NON_PLATFORM_LITERALS = new Set([]);
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx)$/;
const TEST_FILE = /\.(?:test|spec)\.[^.]+$/;
const RAW_FCOC_LITERAL = /(["'`])(fcoc-[A-Za-z0-9_-]+[^"'`\n]*)\1/g;

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
    if (filePath === REGISTRY) {
      continue;
    }

    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(RAW_FCOC_LITERAL)) {
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
    "Raw fcoc-* platform literals must be defined in lib/storageKeys.ts:\n" +
      violations.join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log("Storage/event key registry guard passed.");
}
