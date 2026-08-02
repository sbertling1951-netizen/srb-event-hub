import { execSync } from "child_process";
import { NextResponse } from "next/server";

import { resolveAdminActorFromBearer } from "@/lib/server/adminAuthz";

export async function GET(req: Request) {
  const adminResolved = await resolveAdminActorFromBearer(
    req.headers.get("authorization"),
  );

  if (!adminResolved.admin) {
    return NextResponse.json(
      { error: "Administrative authentication is required." },
      { status: adminResolved.status || 401 },
    );
  }

  if (!adminResolved.admin.isSuperAdmin) {
    return NextResponse.json(
      { error: "Super administrator capability is required." },
      { status: 403 },
    );
  }

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
