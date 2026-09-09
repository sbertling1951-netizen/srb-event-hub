"use client";

import { useRef, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import {
  type CatalogSearchResult,
  type OrganizerRegistryPlanRpcClient,
  RegistryCatalogIdentityResolutionRequiredError,
  type RegistryPlanCatalogSnapshot,
  searchMyPrivateDraftRegistryProviderCatalog,
} from "@/lib/organizerRegistryPlan";
import { supabase } from "@/lib/supabase";

/**
 * A tiny "latest request wins" token issuer for one in-flight search at a
 * time. Every call to `begin()` immediately invalidates every token issued
 * before it -- there is no timer, no abort signal sent to the server, and no
 * change to the search request itself: this only decides which of possibly
 * several already-in-flight responses is still allowed to reach the UI.
 * Exported so its exact behavior can be proven directly, without React or a
 * DOM, matching this repo's established "pure functions are executed for
 * real" testing convention (see lib/importLifecycleOrchestration.ts).
 */
export function createLatestRequestSequencer() {
  let current = 0;
  return {
    begin(): number {
      current += 1;
      return current;
    },
    isCurrent(token: number): boolean {
      return token === current;
    },
  };
}

/** What one search attempt asks its caller to do. Kept as plain callbacks
 *  (never direct setState calls) so this function stays React-free. */
export type CatalogSearchApply = {
  onClear: () => void;
  onLoading: (loading: boolean) => void;
  onResults: (results: CatalogSearchResult[]) => void;
  onError: (message: string) => void;
};

/**
 * Pure, React-free orchestration for ONE search attempt, gated by a
 * request-sequencing token so an out-of-order response can never overwrite
 * a newer one -- Lun's review finding. A query shorter than two characters
 * never reaches the network at all: it clears immediately, never sets a
 * loading state, and its `begin()` call still invalidates any earlier
 * in-flight attempt, so a slow prior response arriving afterward is
 * discarded rather than repopulating results.
 *
 * `client` is injectable (defaults to the real `supabase` client in the
 * component below) so a test can supply a deferred, out-of-order mock
 * without any DOM or React render.
 */
export async function runCatalogSearchAttempt(
  sequencer: ReturnType<typeof createLatestRequestSequencer>,
  client: OrganizerRegistryPlanRpcClient,
  eventId: string,
  query: string,
  apply: CatalogSearchApply,
): Promise<void> {
  const token = sequencer.begin();

  if (query.trim().length < 2) {
    apply.onClear();
    apply.onLoading(false);
    return;
  }

  apply.onLoading(true);
  try {
    const found = await searchMyPrivateDraftRegistryProviderCatalog(client, { eventId, query });
    if (!sequencer.isCurrent(token)) {
      return; // a newer query has started since this one began -- discard
    }
    apply.onResults(found);
  } catch (err) {
    if (!sequencer.isCurrent(token)) {
      return;
    }
    // Identity-resolution-required and any other server error both surface
    // as plain copy here -- see docs/architecture/
    // EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P2_IMPLEMENTATION_SPECIFICATION.md
    // for why this uses the existing identity-path copy pattern rather than
    // revealing any match detail.
    apply.onError(
      err instanceof RegistryCatalogIdentityResolutionRequiredError
        ? err.message
        : err instanceof Error
          ? err.message
          : "We could not search the registry provider catalog.",
    );
    apply.onClear();
  } finally {
    if (sequencer.isCurrent(token)) {
      apply.onLoading(false);
    }
  }
}

/**
 * Compact, owner-private provider-name search plus attach/replace/remove
 * control for ONE existing Registry Plan entry (Catalog P2). Renders only
 * inside `app/organize/[eventId]/registry/page.tsx` -- there is no public or
 * Platform Admin route for this control, and it never touches Platform Admin
 * catalog curation.
 *
 * Results appear ONLY once two ordinary characters are typed, mirroring the
 * server's own minimum -- this is never a browse surface. An empty result is
 * shown as a neutral "No matching providers available," never invented,
 * never a suggestion.
 *
 * THE PUBLIC WEBSITE IS PLAIN TEXT, on every result card and on an attached
 * snapshot alike: never an `<a href>`, never fetched, opened, previewed, or
 * navigated to.
 */
export function OrganizerRegistryCatalogSelector({
  eventId,
  attached,
  onAttach,
  onDetach,
  disabled = false,
}: {
  eventId: string;
  attached: RegistryPlanCatalogSnapshot | null;
  onAttach: (catalogAssetId: string) => Promise<void>;
  onDetach: () => Promise<void>;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // One sequencer per mounted control, held in a ref so the same instance
  // persists across renders without itself causing one.
  const sequencerRef = useRef(createLatestRequestSequencer());

  async function runSearch(nextQuery: string) {
    setQuery(nextQuery);
    setError(null);
    await runCatalogSearchAttempt(sequencerRef.current, supabase, eventId, nextQuery, {
      onClear: () => {
        setResults([]);
        setSearched(false);
      },
      onLoading: setSearching,
      onResults: (found) => {
        setResults(found);
        setSearched(true);
      },
      onError: setError,
    });
  }

  async function selectResult(result: CatalogSearchResult) {
    setBusyId(result.id);
    setError(null);
    try {
      await onAttach(result.id);
      setQuery("");
      setResults([]);
      setSearched(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not attach that provider.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    setBusyId("detach");
    setError(null);
    try {
      await onDetach();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not remove that selection.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {attached ? (
        <div className="card" style={{ display: "grid", gap: 4, padding: 10 }}>
          <span style={{ fontSize: "0.85em", color: "var(--color-text-muted, #475569)" }}>
            Attached from the registry provider catalog
          </span>
          <strong>{attached.providerName}</strong>
          <p style={{ margin: 0 }}>{attached.shortDescription}</p>
          <span style={{ wordBreak: "break-all", color: "var(--color-text-muted, #475569)" }}>
            {attached.publicWebsite}
          </span>
          <div>
            <AppButton variant="danger" loading={busyId === "detach"} disabled={disabled} onClick={() => void remove()}>
              Remove catalog provider
            </AppButton>
          </div>
        </div>
      ) : null}

      <label>
        {attached ? "Replace with a different catalog provider" : "Attach a catalog provider"}{" "}
        <span style={{ fontWeight: 400 }}>(optional)</span>
        <input
          className="app-form-input"
          value={query}
          disabled={disabled}
          onChange={(event) => void runSearch(event.target.value)}
          placeholder="Type at least two letters of a provider name"
        />
      </label>

      {searching ? <span style={{ fontSize: "0.85em" }}>Searching…</span> : null}

      {searched && !searching ? (
        results.length === 0 ? (
          <span style={{ fontSize: "0.85em", color: "var(--color-text-muted, #475569)" }}>
            No matching providers available.
          </span>
        ) : (
          <ul style={{ display: "grid", gap: 8, listStyle: "none", margin: 0, padding: 0 }}>
            {results.map((result) => (
              <li key={result.id} className="card" style={{ display: "grid", gap: 4, padding: 10 }}>
                <strong>{result.providerName}</strong>
                <p style={{ margin: 0 }}>{result.shortDescription}</p>
                <span style={{ wordBreak: "break-all", color: "var(--color-text-muted, #475569)" }}>
                  {result.publicWebsite}
                </span>
                <div>
                  <AppButton loading={busyId === result.id} disabled={disabled} onClick={() => void selectResult(result)}>
                    {attached ? "Replace with this provider" : "Attach this provider"}
                  </AppButton>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
