import type {
  CollectSharedExperienceContextInput,
  SharedExperienceContext,
} from "@/lib/experienceContext/types";

export type SharedExperienceContextSliceKey = Exclude<
  keyof SharedExperienceContext,
  "generatedAt"
>;

export type SharedExperienceContextContribution<
  K extends SharedExperienceContextSliceKey = SharedExperienceContextSliceKey,
> = Pick<SharedExperienceContext, K>;

export type AnySharedExperienceContextContribution = {
  [K in SharedExperienceContextSliceKey]: SharedExperienceContextContribution<K>;
}[SharedExperienceContextSliceKey];

export interface ExperienceContextProvider<
  K extends SharedExperienceContextSliceKey = SharedExperienceContextSliceKey,
> {
  name: string;
  key: K;
  collect(
    input: CollectSharedExperienceContextInput,
  ): Promise<SharedExperienceContextContribution<K>>;
}

export type AnyExperienceContextProvider = {
  [K in SharedExperienceContextSliceKey]: ExperienceContextProvider<K>;
}[SharedExperienceContextSliceKey];
