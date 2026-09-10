import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { isPresentationSlot } from "@/lib/server/presentationAssetResolver";

// P0 Event-Photo Read-Surface Repair: caption/attribution text for the
// anonymous audience slideshow's current/next slot.
//
// public.event_photos now has no anon SELECT grant at all (20261010000000).
// This route replaces app/slideshow/view/page.tsx's former direct anon table
// read with a call to the governed, session/slot-scoped
// read_live_presentation_slot_caption RPC, which independently re-derives
// the same live-session eligibility read_public_presentation_session and
// the presentation-image route already require, and returns only caption
// fields for the one photo currently vouched for -- never a storage path,
// never any other photo's data.

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

// A fresh, anon-key client -- read_live_presentation_slot_caption is
// anon-EXECUTE-granted precisely so this route needs no elevated credential
// at all; it performs its own complete authorization internally.
function createAnonClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return null;
  }

  return createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session");
  const slot = url.searchParams.get("slot");

  if (!isUuid(sessionId) || !isPresentationSlot(slot)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = createAnonClient();

  if (!supabase) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  const { data, error } = await supabase
    .rpc("read_live_presentation_slot_caption", {
      p_session_id: sessionId,
      p_slot: slot,
    })
    .maybeSingle();

  if (error) {
    console.error("presentation-caption: RPC failed:", {
      code: error.code,
      message: error.message,
    });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ caption: null });
  }

  const row = data as {
    member_caption: string | null;
    admin_caption: string | null;
    show_caption: boolean | null;
    photographer_name_snapshot: string | null;
  };

  return NextResponse.json({
    caption: {
      memberCaption: row.member_caption,
      adminCaption: row.admin_caption,
      showCaption: Boolean(row.show_caption),
      photographerName: row.photographer_name_snapshot,
    },
  });
}
