import { NextResponse } from "next/server";

export async function POST(req: Request) {
  void req;

  return NextResponse.json({
    ok: false,
    error:
      "Automatic activation by email match is retired. Use vendor registration or administrator-managed access.",
  }, { status: 410 });
}
