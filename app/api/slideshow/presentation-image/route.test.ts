import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import ts from "typescript";

// P0 Event-Photo Read-Surface Repair: structural proof for the anonymous
// slideshow image delivery route. Run with:
//   npx tsx --test app/api/slideshow/presentation-image/route.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);

test("the only inputs accepted are a session id and a fixed slot label -- never a storage path, photo id, or Event id", () => {
  assert.match(SOURCE, /searchParams\.get\(\s*["']session["']\s*\)/);
  assert.match(SOURCE, /searchParams\.get\(\s*["']slot["']\s*\)/);
  assert.equal(
    /searchParams\.get\(\s*["'](storagePath|storage_path|photoId|eventId)["']/.test(SOURCE),
    false,
  );
  assert.match(SOURCE, /isPresentationSlot\(slot\)/);
});

test("every request re-resolves the live session/slot itself -- no caching of the resolved path across requests", () => {
  assert.match(SOURCE, /resolveLivePresentationSlotPath/);
  // The resolver is called once per GET invocation with the raw request
  // parameters, not read from a module-level/closure cache.
  const getFnBody = SOURCE.slice(SOURCE.indexOf("export async function GET"));
  assert.match(getFnBody, /resolveLivePresentationSlotPath\(sessionId, slot\)/);
});

test("the response is always a size-capped rendition, never the original, and never a reusable storage signed URL", () => {
  assert.match(SOURCE, /fetchPhotoRendition/);
  assert.match(SOURCE, /PRESENTATION_RENDITION_MAX_DIMENSION\s*=\s*2048/);
  assert.equal(/signedUrl/i.test(SOURCE), false);
  assert.equal(/createSignedUrl/.test(SOURCE), false);
  assert.match(SOURCE, /new Response\(rendition\.bytes/);
});

test("the response is never cached, so a captured URL cannot outlive the live slide it was fetched for", () => {
  assert.match(SOURCE, /Cache-Control["']?:\s*["']no-store["']/);
});

test("this route requires no caller authentication -- it is the one deliberately anonymous surface, gated entirely by live session/slot re-validation", () => {
  assert.equal(/resolveAuthenticatedRequest/.test(SOURCE), false);
  assert.equal(/createAuthenticatedUserClient/.test(SOURCE), false);
});

// Execute the actual route with only its database/storage boundaries replaced.
function routeFixture(authorized: boolean) {
  const calls: unknown[] = [];
  const exports: Record<string, any> = {};
  vm.runInNewContext(ts.transpileModule(SOURCE, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, URL, Response,
    require(name: string) {
      if (name === "next/server") { return { NextResponse: Response }; }
      if (name.endsWith("presentationAssetResolver")) {
        return {
          isPresentationSlot: (slot: string) => slot === "current" || slot === "next",
          resolveLivePresentationSlotPath: async (session: string, slot: string) => {
            calls.push({ session, slot });
            return authorized ? { contentRefId: "server-photo", storagePath: "governed/path" } : null;
          },
        };
      }
      if (name.endsWith("eventPhotoRendition")) {
        return { fetchPhotoRendition: async (path: string, max: number) => {
          calls.push({ path, max });
          return { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" };
        } };
      }
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { get: exports.GET as (request: Request) => Promise<Response>, calls };
}

test("prefetch identity comes from the governed resolver, ignoring forged photo hints", async () => {
  const f = routeFixture(true);
  const response = await f.get(new Request(
    "https://fixture/api?session=11111111-1111-4111-8111-111111111111&slot=next&cr=forged&photoId=forged",
  ));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Presentation-Content-Ref"), "server-photo");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(f.calls, [
    { session: "11111111-1111-4111-8111-111111111111", slot: "next" },
    { path: "governed/path", max: 2048 },
  ]);
});

test("ineligible slots provide neither bytes nor a prefetch identity", async () => {
  const f = routeFixture(false);
  const response = await f.get(new Request(
    "https://fixture/api?session=11111111-1111-4111-8111-111111111111&slot=current",
  ));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("X-Presentation-Content-Ref"), null);
  assert.equal(f.calls.length, 1);
});
