import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "online",
    commit: "local",
    lastDeployedAt: new Date().toISOString(),
  });
}
