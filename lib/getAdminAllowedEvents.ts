import { supabase } from "@/lib/supabase";
import { getCurrentAdminAccess } from "@/lib/getCurrentAdminAccess";

export type AdminAllowedEvent = {
  id: string;
  name: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

export async function getAdminAllowedEvents(): Promise<AdminAllowedEvent[]> {
  const admin = await getCurrentAdminAccess();
  if (!admin) return [];

  let query = supabase
    .from("events")
    .select("id, name, venue_name, location, start_date, end_date")
    .order("start_date", { ascending: false });

  if (admin.privilege_group !== "super_admin") {
    if (admin.event_ids.length === 0) return [];
    query = query.in("id", admin.event_ids);
  }

  const { data, error } = await query;
  if (error) return [];

  return (data || []) as AdminAllowedEvent[];
}
