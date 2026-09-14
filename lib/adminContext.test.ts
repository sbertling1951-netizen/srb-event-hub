import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./adminContext.tsx", import.meta.url)),
  "utf8",
);

test("AdminProvider adopts a refreshed authority result even when the Administrator identity is unchanged", () => {
  const loadAdmin = SOURCE.slice(
    SOURCE.indexOf("async function loadAdmin"),
    SOURCE.indexOf("useEffect(() =>", SOURCE.indexOf("async function loadAdmin")),
  );

  assert.match(loadAdmin, /setAdmin\(result\)/);
  assert.doesNotMatch(loadAdmin, /prev\?\.adminUser\?\.id === result\?\.adminUser\?\.id/);
});
