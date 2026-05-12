import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    const normalizedEmail = email.toString().trim().toLowerCase();

    // Check if user already exists
    const { data: users } = await supabaseAdmin.auth.admin.listUsers();

    const existing = users?.users?.find(
      (u) => u.email?.toLowerCase() === normalizedEmail,
    );

    if (existing) {
      return NextResponse.json({
        ok: true,
        userId: existing.id,
      });
    }

    // Create user if missing
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password: "TempPassword123!",
      email_confirm: true,
    });

    if (error || !data?.user) {
      return NextResponse.json(
        { error: error?.message || "Failed to create user" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      userId: data.user.id,
    });
  } catch (err) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
