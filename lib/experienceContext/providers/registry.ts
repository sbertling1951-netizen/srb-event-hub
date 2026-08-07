import { agendaExperienceContextProvider } from "@/lib/experienceContext/providers/agendaProvider";
import { announcementsExperienceContextProvider } from "@/lib/experienceContext/providers/announcementsProvider";
import type { AnyExperienceContextProvider } from "@/lib/experienceContext/providers/types";
import { vendorRequestsExperienceContextProvider } from "@/lib/experienceContext/providers/vendorRequestsProvider";

function assertUniqueProviderSliceOwnership(
  providers: readonly AnyExperienceContextProvider[],
): readonly AnyExperienceContextProvider[] {
  const providerBySlice = new Map<string, string>();

  for (const provider of providers) {
    const existingProviderName = providerBySlice.get(provider.key);
    if (existingProviderName) {
      throw new Error(
        `Duplicate SharedExperienceContext slice ownership for key "${provider.key}": providers "${existingProviderName}" and "${provider.name}"`,
      );
    }

    providerBySlice.set(provider.key, provider.name);
  }

  return providers;
}

const REGISTERED_EXPERIENCE_CONTEXT_PROVIDERS: readonly AnyExperienceContextProvider[] =
  [
    agendaExperienceContextProvider,
    announcementsExperienceContextProvider,
    vendorRequestsExperienceContextProvider,
  ];

// The registry owns provider ordering and enforces one provider per slice.
export const EXPERIENCE_CONTEXT_PROVIDER_REGISTRY =
  assertUniqueProviderSliceOwnership(REGISTERED_EXPERIENCE_CONTEXT_PROVIDERS);
