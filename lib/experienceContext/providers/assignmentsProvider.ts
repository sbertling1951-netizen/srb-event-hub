import type { ExperienceContextProvider } from "@/lib/experienceContext/providers/types";
import { supabase } from "@/lib/supabase";

type AssignmentSummary = {
  id: string;
  responsibilityLabel: string;
  attributedAt: string;
};

type AssignmentApiResponse =
  | {
      status: "resolved";
      assignments: AssignmentSummary[];
    }
  | {
      status: "identity_unavailable";
    }
  | {
      status: "invalid_session";
    }
  | {
      status: "transient_error";
    };

async function collectAssignmentsActiveCount(
  eventId: string,
  eventCode: string | null,
  registrationIdentifier: string | null,
): Promise<number | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  const params = new URLSearchParams({ eventId });
  if (eventCode) {
    params.set("eventCode", eventCode);
  }
  if (registrationIdentifier) {
    params.set("registrationIdentifier", registrationIdentifier);
  }

  const response = await fetch(
    `/api/member/assignments?${params.toString()}`,
    accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
  );

  const payload = (await response.json()) as AssignmentApiResponse;

  if (!response.ok) {
    throw new Error(
      `assignments read failed: ${response.status} (${payload.status})`,
    );
  }

  if (payload.status === "identity_unavailable") {
    return null;
  }

  if (payload.status !== "resolved") {
    throw new Error(`assignments read returned unexpected status: ${payload.status}`);
  }

  return payload.assignments.length;
}

export const assignmentsExperienceContextProvider: ExperienceContextProvider<"assignments"> =
  {
    name: "assignments",
    key: "assignments",
    async collect(input) {
      return {
        assignments: {
          activeCount: await collectAssignmentsActiveCount(
            input.event.id,
            input.eventCode,
            input.registrationIdentifier,
          ),
        },
      };
    },
  };
