import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { classifyPublicEventCandidates, type PublicEventCandidate } from "@/lib/publicEventBootstrap";
import { resolveTenantFromHeaders } from "@/lib/server/tenantResolver";

export const dynamic = "force-dynamic";

function createAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
}

export async function GET(request: Request) {
  const tenantResolution = await resolveTenantFromHeaders(request.headers);
  if (tenantResolution.state === "unresolved") return NextResponse.json({ kind: "none", events: [] });
  const supabase = createAnonClient();
  if (!supabase) return NextResponse.json({ error: "internal_error" }, { status: 500 });
  const { data, error } = await supabase.rpc("get_public_discoverable_events_for_tenant", { p_tenant_id: tenantResolution.tenant.id });
  if (error) return NextResponse.json({ error: "public_discovery_failed" }, { status: 500 });
  return NextResponse.json(classifyPublicEventCandidates((data || []) as PublicEventCandidate[]));
}
