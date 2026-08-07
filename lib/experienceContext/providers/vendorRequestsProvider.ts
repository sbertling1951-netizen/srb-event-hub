import type { ExperienceContextProvider } from "@/lib/experienceContext/providers/types";
import { supabase } from "@/lib/supabase";

// Matches public.get_my_vendor_service_requests's return shape (see
// supabase/migrations/20260807120000_create_governed_member_vendor_request_read.sql).
// Only the field this slice needs is declared here.
type VendorRequestRow = {
  request_status: string | null;
};

const CLOSED_VENDOR_REQUEST_STATUSES = new Set(["completed", "cancelled"]);

async function collectVendorRequestsOpenCount(
  eventId: string,
  eventCode: string | null,
  registrationIdentifier: string | null,
): Promise<number> {
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
    `/api/member/vendor-requests?${params.toString()}`,
    accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
  );

  if (!response.ok) {
    throw new Error(`vendor requests read failed: ${response.status}`);
  }

  const payload = (await response.json()) as { data?: VendorRequestRow[] };
  const rows = payload.data ?? [];

  return rows.filter(
    (row) => !CLOSED_VENDOR_REQUEST_STATUSES.has(row.request_status || "new"),
  ).length;
}

export const vendorRequestsExperienceContextProvider: ExperienceContextProvider<"vendorRequests"> =
  {
    name: "vendorRequests",
    key: "vendorRequests",
    async collect(input) {
      return {
        vendorRequests: {
          openCount: await collectVendorRequestsOpenCount(
            input.event.id,
            input.eventCode,
            input.registrationIdentifier,
          ),
        },
      };
    },
  };
