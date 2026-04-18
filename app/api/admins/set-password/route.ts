import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST() {
  const userId = "4180a4b6-334f-4daf-8111-ad2721b0c75e"; // fcoceventhost

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    password: "admin123",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
