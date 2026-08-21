import { notFound } from "next/navigation";

import { MapGeometryTestClient } from "./MapGeometryTestClient";

/**
 * Server-side production gate, matching app/dev/shell-preview/page.tsx's
 * own established pattern exactly: this check runs on the server before
 * any request reaches MapGeometryTestClient and, in a production build,
 * resolves to a genuine 404 -- not a client-side conditional that could
 * be bypassed or that still ships the harness UI to the client bundle.
 */
export default function MapGeometryTestPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <MapGeometryTestClient />;
}
