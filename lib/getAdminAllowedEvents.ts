import { getCurrentAdminAccess } from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

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
  if (!admin) {return [];}

  let query = supabase
    .from("events")
    .select("id, name, venue_name, location, start_date, end_date")
    .order("start_date", { ascending: false });

  if (admin.privilegeGroup !== "super_admin") {
    if (admin.eventIds.length === 0) {return [];}
    query = query.in("id", admin.eventIds);
  }

  const { data, error } = await query;
  if (error) {return [];}

  return (data || []) as AdminAllowedEvent[];
}
