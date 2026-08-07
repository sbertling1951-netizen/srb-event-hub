import type { ExperienceContextProvider } from "@/lib/experienceContext/providers/types";
import { supabase } from "@/lib/supabase";

async function collectAnnouncementsActiveCount(
  eventId: string,
  now: Date,
): Promise<number> {
  const { count, error } = await supabase
    .from("announcements")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("is_published", true)
    .or(`expire_at.is.null,expire_at.gt.${now.toISOString()}`);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

export const announcementsExperienceContextProvider: ExperienceContextProvider<"announcements"> =
  {
    name: "announcements",
    key: "announcements",
    async collect(input) {
      return {
        announcements: {
          activeCount: await collectAnnouncementsActiveCount(
            input.event.id,
            input.now,
          ),
        },
      };
    },
  };
