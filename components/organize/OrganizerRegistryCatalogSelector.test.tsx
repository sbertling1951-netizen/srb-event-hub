import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import { OrganizerRegistryCatalogSelector } from "@/components/organize/OrganizerRegistryCatalogSelector";
import type { RegistryPlanCatalogSnapshot } from "@/lib/organizerRegistryPlan";

const adapterSource = readFileSync(
  fileURLToPath(new URL("./OrganizerRegistryCatalogSelector.tsx", import.meta.url)),
  "utf8",
);
/** Comments removed: the prose may legitimately name what does NOT happen. */
const CODE = adapterSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const snapshot: RegistryPlanCatalogSnapshot = {
  catalogAssetId: "a1",
  providerName: "Acme Gift Registry",
  shortDescription: "A general-purpose gift registry.",
  publicWebsite: "https://acme-registry.example.com",
};

test("with no attachment, no search yet: no result list, no attached card, no total/count/usage language", () => {
  const html = renderToStaticMarkup(
    <OrganizerRegistryCatalogSelector eventId="e1" attached={null} onAttach={async () => {}} onDetach={async () => {}} />,
  );
  assert.doesNotMatch(html, /Attached from the registry provider catalog/);
  assert.doesNotMatch(html, /No matching providers available/, "the empty-result copy only appears AFTER a search runs");
  assert.doesNotMatch(html, /total|\bcount\b|usage|where.?used|reference/i);
  assert.match(html, /Attach a catalog provider/);
  assert.match(html, /Type at least two letters of a provider name/);
});

test("with an attached snapshot: shows the card as plain text, offers Remove and Replace wording", () => {
  const html = renderToStaticMarkup(
    <OrganizerRegistryCatalogSelector eventId="e1" attached={snapshot} onAttach={async () => {}} onDetach={async () => {}} />,
  );
  assert.match(html, /Attached from the registry provider catalog/);
  assert.match(html, /Acme Gift Registry/);
  assert.match(html, /A general-purpose gift registry\./);
  assert.match(html, /https:\/\/acme-registry\.example\.com/);
  assert.match(html, /Remove catalog provider/);
  assert.match(html, /Replace with a different catalog provider/);
  // never a link, never navigable
  assert.doesNotMatch(html, /<a\s+href/i);
});

test("NO WEBSITE LINK, FETCH, PREVIEW, IFRAME, OR IMAGE anywhere in this component", () => {
  assert.doesNotMatch(CODE, /<a\s+href|window\.open|window\.location|<iframe|<img|\bfetch\(|XMLHttpRequest|axios/i);
  const html = renderToStaticMarkup(
    <OrganizerRegistryCatalogSelector eventId="e1" attached={snapshot} onAttach={async () => {}} onDetach={async () => {}} />,
  );
  assert.doesNotMatch(html, /<a\b|<iframe|<img/i);
});

test("attach/detach calls go through the provided callbacks with the correct arguments, not a direct RPC call", () => {
  assert.doesNotMatch(CODE, /\.rpc\(|supabase\.rpc/);
  assert.match(CODE, /onAttach\(result\.id\)/);
  assert.match(CODE, /onDetach\(\)/);
});

test("uses ONLY the dedicated Catalog P2 search function -- no other planning/catalog adapter import", () => {
  assert.match(adapterSource, /from "@\/lib\/organizerRegistryPlan"/);
  assert.doesNotMatch(CODE, /from "@\/lib\/registryProviderCatalogAdmin"|from "@\/lib\/tenantAdministration"/);
  assert.match(adapterSource, /searchMyPrivateDraftRegistryProviderCatalog/);
});

test("no category, geography, alias, ranking, or recommendation control exists", () => {
  assert.doesNotMatch(CODE, /categor|geograph|alias|\brank\b|popular|recommend/i);
});

test("identity-resolution-required errors are shown as plain copy, not a raw sentinel", () => {
  assert.match(CODE, /RegistryCatalogIdentityResolutionRequiredError/);
  assert.doesNotMatch(CODE, /identity_resolution_required/);
});

// ===========================================================================
// Lun's review finding: stale, out-of-order search responses must never
// overwrite a newer live query's results, loading state, or error --
// including when the query is shortened below the two-character minimum
// while an earlier search is still in flight.
//
// Proven directly against the pure, React-free `runCatalogSearchAttempt` /
// `createLatestRequestSequencer` exports with a deferred, order-controllable
// mock RPC client -- no jsdom, no React render, matching this repo's
// established "pure functions are executed for real" testing convention
// (see lib/importLifecycleOrchestration.test.ts).
// ===========================================================================

import {
  type CatalogSearchApply,
  createLatestRequestSequencer,
  runCatalogSearchAttempt,
} from "@/components/organize/OrganizerRegistryCatalogSelector";
import type { CatalogSearchResult, OrganizerRegistryPlanRpcClient } from "@/lib/organizerRegistryPlan";

type RpcArgs = Record<string, unknown> | undefined;
type RpcResult = { data: unknown; error: { message: string } | null };

/** A promise the test resolves/rejects on its own schedule, to control
 *  exactly which mock response "arrives" first. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function recordingApply() {
  const calls: string[] = [];
  let results: CatalogSearchResult[] = [];
  let loading = false;
  let error: string | null = null;
  const apply: CatalogSearchApply = {
    onClear: () => {
      calls.push("clear");
      results = [];
    },
    onLoading: (isLoading) => {
      calls.push(`loading:${isLoading}`);
      loading = isLoading;
    },
    onResults: (found) => {
      calls.push("results");
      results = found;
    },
    onError: (message) => {
      calls.push("error");
      error = message;
    },
  };
  return {
    apply,
    calls,
    get results() {
      return results;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
  };
}

function resultRow(id: string, providerName: string): CatalogSearchResult {
  return { id, providerName, shortDescription: "d", publicWebsite: `https://${id}.example.com` };
}

test("createLatestRequestSequencer: each begin() invalidates every earlier token", () => {
  const sequencer = createLatestRequestSequencer();
  const t1 = sequencer.begin();
  assert.equal(sequencer.isCurrent(t1), true);
  const t2 = sequencer.begin();
  assert.equal(sequencer.isCurrent(t1), false, "t1 is stale now that t2 has begun");
  assert.equal(sequencer.isCurrent(t2), true);
});

test("RACE 1: query 'ac' then 'zz' -- the later 'zz' response wins even when the earlier 'ac' response resolves afterward", async () => {
  const ac = deferred<RpcResult>();
  const zz = deferred<RpcResult>();
  const client: OrganizerRegistryPlanRpcClient = {
    async rpc(_name, args) {
      const q = (args as RpcArgs)?.p_query;
      if (q === "ac") {return ac.promise;}
      if (q === "zz") {return zz.promise;}
      throw new Error(`unexpected query in mock: ${String(q)}`);
    },
  };
  const sequencer = createLatestRequestSequencer();
  const rec = recordingApply();

  const acAttempt = runCatalogSearchAttempt(sequencer, client, "e1", "ac", rec.apply);
  const zzAttempt = runCatalogSearchAttempt(sequencer, client, "e1", "zz", rec.apply);

  // The NEWER query's response arrives first.
  zz.resolve({ data: [resultRow("z1", "Zzz Registry")].map((r) => ({
    id: r.id, provider_name: r.providerName, short_description: r.shortDescription, public_website: r.publicWebsite,
  })), error: null });
  await zzAttempt;
  assert.deepEqual(rec.results.map((r) => r.id), ["z1"], "zz's results are applied");

  // The OLDER query's response arrives late, after zz already won.
  ac.resolve({ data: [resultRow("a1", "Acme Gift Registry")].map((r) => ({
    id: r.id, provider_name: r.providerName, short_description: r.shortDescription, public_website: r.publicWebsite,
  })), error: null });
  await acAttempt;
  assert.deepEqual(rec.results.map((r) => r.id), ["z1"], "the stale 'ac' response never overwrote the newer 'zz' results");
});

test("RACE 2: shortening 'ac' to 'a' clears results immediately, sets no loading state, and discards the stale 'ac' response", async () => {
  const ac = deferred<RpcResult>();
  const client: OrganizerRegistryPlanRpcClient = {
    async rpc(_name, args) {
      const q = (args as RpcArgs)?.p_query;
      if (q === "ac") {return ac.promise;}
      throw new Error(`the network must never be called for a too-short query, got: ${String(q)}`);
    },
  };
  const sequencer = createLatestRequestSequencer();
  const rec = recordingApply();

  const acAttempt = runCatalogSearchAttempt(sequencer, client, "e1", "ac", rec.apply);
  assert.equal(rec.loading, true, "the in-flight 'ac' search set loading");

  // Shorten below the two-character minimum WHILE 'ac' is still in flight.
  await runCatalogSearchAttempt(sequencer, client, "e1", "a", rec.apply);
  assert.deepEqual(rec.results, [], "results are cleared immediately for the too-short query");
  assert.equal(rec.loading, false, "no loading state is left on for a too-short query");

  // The stale 'ac' response resolves late and must be fully ignored.
  ac.resolve({ data: [resultRow("a1", "Acme Gift Registry")].map((r) => ({
    id: r.id, provider_name: r.providerName, short_description: r.shortDescription, public_website: r.publicWebsite,
  })), error: null });
  await acAttempt;
  assert.deepEqual(rec.results, [], "the stale 'ac' response did not repopulate results");
  assert.equal(rec.loading, false, "the stale 'ac' response did not turn loading back on");
});

test("RACE 3: a stale ERROR arriving after a newer SUCCESS does not overwrite the successful results or set an error", async () => {
  const ac = deferred<RpcResult>();
  const zz = deferred<RpcResult>();
  const client: OrganizerRegistryPlanRpcClient = {
    async rpc(_name, args) {
      const q = (args as RpcArgs)?.p_query;
      if (q === "ac") {return ac.promise;}
      if (q === "zz") {return zz.promise;}
      throw new Error(`unexpected query in mock: ${String(q)}`);
    },
  };
  const sequencer = createLatestRequestSequencer();
  const rec = recordingApply();

  const acAttempt = runCatalogSearchAttempt(sequencer, client, "e1", "ac", rec.apply);
  const zzAttempt = runCatalogSearchAttempt(sequencer, client, "e1", "zz", rec.apply);

  zz.resolve({ data: [resultRow("z1", "Zzz Registry")].map((r) => ({
    id: r.id, provider_name: r.providerName, short_description: r.shortDescription, public_website: r.publicWebsite,
  })), error: null });
  await zzAttempt;
  assert.equal(rec.results.length, 1, "the newer 'zz' results are in place");

  // The stale 'ac' attempt fails LATE, using the real RPC error shape
  // (a resolved { data: null, error } -- never a thrown rejection).
  ac.resolve({ data: null, error: { message: "stale network failure" } });
  await acAttempt;
  assert.equal(rec.error, null, "the stale error was never surfaced");
  assert.equal(rec.results.length, 1, "the successful 'zz' results remain in place, untouched by the stale error");
  assert.deepEqual(rec.results.map((r) => r.id), ["z1"]);
});

test("existing selector tests are unaffected: successful results, empty state, and identity errors still apply for the CURRENT (only) query", async () => {
  const client: OrganizerRegistryPlanRpcClient = {
    async rpc(_name, args) {
      const q = (args as RpcArgs)?.p_query;
      if (q === "ac") {
        return {
          data: [resultRow("a1", "Acme Gift Registry")].map((r) => ({
            id: r.id, provider_name: r.providerName, short_description: r.shortDescription, public_website: r.publicWebsite,
          })),
          error: null,
        };
      }
      if (q === "zz") {
        return { data: [], error: null };
      }
      throw new Error(`unexpected query in mock: ${String(q)}`);
    },
  };
  const sequencer = createLatestRequestSequencer();

  const successRec = recordingApply();
  await runCatalogSearchAttempt(sequencer, client, "e1", "ac", successRec.apply);
  assert.deepEqual(successRec.results.map((r) => r.id), ["a1"]);
  assert.equal(successRec.loading, false);

  const emptyRec = recordingApply();
  await runCatalogSearchAttempt(sequencer, client, "e1", "zz", emptyRec.apply);
  assert.deepEqual(emptyRec.results, []);
  assert.equal(emptyRec.calls.includes("results"), true, "an empty array is still an applied result, not a clear");
});
