import { execSync } from "child_process";
import { NextResponse } from "next/server";

export async function GET() {
  let commit = "unknown";

  try {
    commit = execSync("git rev-parse --short HEAD").toString().trim();
  } catch (err) {
    console.error("Could not read git commit:", err);
  }

  return NextResponse.json({
    status: "online",
    commit,
    lastDeployedAt: new Date().toISOString(),
  });
}
