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
    const { error: engagementError } = await supabase.rpc(
      "log_engagement_activity",
      {
        p_event_id: eventId,
        p_attendee_id: attendeeId,
        p_activity_type: activityType,
        p_details: details ?? null,
      },
    );

    if (engagementError) {
      throw engagementError;
    }

    if (activityType === "login") {
      const { error: loginError } = await supabase.rpc(
        "increment_attendee_login",
        {
          p_attendee_id: attendeeId,
        },
      );

      if (loginError) {
        throw loginError;
      }
    }
  } catch (err) {
    console.error("Engagement logging failed:", err);
  }
}
