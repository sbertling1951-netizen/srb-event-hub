import { supabase } from "@/lib/supabase";

type LogEngagementParams = {
  eventId: string;
  attendeeId: string;
  activityType: string;
  details?: Record<string, unknown>;
};

function logEngagementError(context: string, error: unknown) {
  const supabaseError = error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
    code?: unknown;
  };

  console.warn(context, {
    message:
      typeof supabaseError?.message === "string"
        ? supabaseError.message
        : "Unknown engagement logging error.",
    details:
      typeof supabaseError?.details === "string"
        ? supabaseError.details
        : undefined,
    hint:
      typeof supabaseError?.hint === "string" ? supabaseError.hint : undefined,
    code:
      typeof supabaseError?.code === "string" ? supabaseError.code : undefined,
  });
}

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
      logEngagementError("Engagement logging failed:", engagementError);
      return;
    }

    if (activityType === "login") {
      const { error: loginError } = await supabase.rpc(
        "increment_attendee_login",
        {
          p_attendee_id: attendeeId,
        },
      );

      if (loginError) {
        logEngagementError("Login engagement update failed:", loginError);
      }
    }
  } catch (err) {
    logEngagementError("Engagement logging failed:", err);
  }
}
