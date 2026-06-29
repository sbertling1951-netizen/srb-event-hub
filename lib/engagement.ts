
import { supabase } from "@/lib/supabase";

type LogEngagementParams = {
  eventId: string;
  attendeeId: string;
  activityType: string;
  details?: Record<string, unknown>;
};

export async function logEngagement({
  eventId,
  attendeeId,
  activityType,
  details,
}: LogEngagementParams) {
  try {
    await supabase.from("engagement_activity").insert({
      event_id: eventId,
      attendee_id: attendeeId,
      activity_type: activityType,
      details: details ?? null,
    });

    if (activityType === "login") {
      await supabase.rpc("increment_attendee_login", {
        p_attendee_id: attendeeId,
      });
    }
  } catch (err) {
    console.error("Engagement logging failed:", err);
  }
}
