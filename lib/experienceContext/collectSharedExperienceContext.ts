import { buildCanonicalBaseSharedExperienceContext } from "@/lib/experienceContext/defaults";
import { EXPERIENCE_CONTEXT_PROVIDER_REGISTRY } from "@/lib/experienceContext/providers/registry";
import type {
  AnySharedExperienceContextContribution,
} from "@/lib/experienceContext/providers/types";
import type {
  CollectSharedExperienceContextInput,
  SharedExperienceContext,
} from "@/lib/experienceContext/types";

// Collect once. Normalize once. Distribute many times. Never own
// authoritative state. See
// docs/architecture/EPICENTRAX_SHARED_EXPERIENCE_CONTEXT_ARCHITECTURE.md.
//
// This collector performs no Person, Workspace, or event resolution --
// `input.event` must already be resolved by the caller. Providers handle
// source-specific reads; the collector orchestrates provider execution,
// merges slices, and isolates failures.

function buildBaseContext(
  input: CollectSharedExperienceContextInput,
): SharedExperienceContext {
  return buildCanonicalBaseSharedExperienceContext(input);
}

function mergeProviderResult(
  context: SharedExperienceContext,
  providerResult: AnySharedExperienceContextContribution,
): SharedExperienceContext {
  return {
    ...context,
    ...providerResult,
  };
}

export async function collectSharedExperienceContext(
  input: CollectSharedExperienceContextInput,
): Promise<SharedExperienceContext> {
  let context = buildBaseContext(input);

  const providerResults = await Promise.all(
    EXPERIENCE_CONTEXT_PROVIDER_REGISTRY.map(async (provider) => {
      try {
        const result = await provider.collect(input);
        return { providerName: provider.name, result };
      } catch (err) {
        console.error(
          `collectSharedExperienceContext: provider ${provider.name} failed:`,
          err,
        );
        return { providerName: provider.name, result: null };
      }
    }),
  );

  for (const { result } of providerResults) {
    if (!result) {
      continue;
    }
    context = mergeProviderResult(context, result);
  }

  return context;
}
