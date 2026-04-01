import { supabase } from "@/lib/supabase"

export type ActiveEvent = {
  id: string
  name: string
  location: string | null
  start_date: string | null
  end_date: string | null
  map_image_url: string | null
  master_map_id: string | null
}

export async function getActiveEvent(): Promise<ActiveEvent | null> {
  const { data, error } = await supabase
    .from("events")
    .select("id,name,location,start_date,end_date,map_image_url,master_map_id")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("Could not load active event:", error.message)
    return null
  }

  return data
}
