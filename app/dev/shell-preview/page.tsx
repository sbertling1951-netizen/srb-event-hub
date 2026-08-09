import { notFound } from "next/navigation";

import { ShellPreviewClient } from "./ShellPreviewClient";

/**
 * Server-side production gate (EPICENTRAX UI STAGE 2B, §E). Next.js sets
 * `NODE_ENV=production` automatically for `next build`/`next start`, so
 * this check runs on the server before any request reaches
 * `ShellPreviewClient` and, in a production build, resolves to a genuine
 * 404 -- not a client-side conditional that could be bypassed or that
 * still ships the preview UI to the client bundle. Do not replace this
 * with a client-side check; §E states that is explicitly insufficient.
 */
export default function ShellPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <ShellPreviewClient />;
}
