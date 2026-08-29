import { createHash, randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function createAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export async function POST(request: Request) {
  let body: { eventId?: unknown; eventCode?: unknown; identifier?: unknown } = {};

  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as typeof body;
    }
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (
    typeof body.eventId !== "string" ||
    typeof body.eventCode !== "string" ||
    typeof body.identifier !== "string" ||
    !body.eventCode.trim() ||
    !body.identifier.trim()
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = createAnonClient();
  if (!supabase) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

    const capabilityToken = randomBytes(32).toString("base64url");
    const capabilityHash = createHash("sha256")
      .update(capabilityToken)
      .digest("hex");

  const { data, error } = await supabase.rpc(
    "issue_temporary_member_capability",
    {
      p_event_id: body.eventId,
      p_event_code: body.eventCode.trim(),
      p_registration_identifier: body.identifier.trim(),
      p_capability_hash: capabilityHash,
    },
  );

  if (error || !Array.isArray(data) || !data[0]?.id) {
    return NextResponse.json({ error: "verification_failed" }, { status: 400 });
  }

    return NextResponse.json({ data, capabilityHash: capabilityToken });
}