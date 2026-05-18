import { execSync } from "child_process";
import { NextResponse } from "next/server";

export async function GET() {
  let commit: string | null = null;
  let dirty = false;

  try {
    commit = execSync("git rev-parse --short HEAD").toString().trim();

    const gitStatus = execSync("git status --porcelain").toString().trim();

    dirty = gitStatus.length > 0;
  } catch (err) {
    console.error("Could not read git status:", err);
  }

  const environment =
    process.env.NODE_ENV === "production" ? "Production" : "Development";

  return NextResponse.json({
    status: "online",
    commit,
    dirty,
    environment,
    lastDeployedAt: new Date().toISOString(),
  });
}
