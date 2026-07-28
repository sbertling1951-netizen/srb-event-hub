import os from "node:os";

import type { NextConfig } from "next";

/**
 * `allowedDevOrigins` is Next.js's dev-server CSRF/cross-origin allowlist
 * (see https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins).
 * It only accepts literal hostnames or DNS-style `*.label` wildcards -- it
 * has no concept of CIDR ranges, and a bare `*` is explicitly rejected by
 * Next.js's own matcher. There is also no way to derive it from the
 * `next dev --hostname` flag: that flag only allowlists the exact value
 * passed to it (e.g. "0.0.0.0", which no browser ever sends as an Origin),
 * not whatever LAN IP the machine actually ends up with.
 *
 * This dev machine moves between many networks (home, campgrounds, rallies,
 * hotels, mobile hotspots), each assigning a different private IPv4
 * address, so a static list goes stale constantly. Instead, read the
 * machine's own currently active, non-internal IPv4 addresses at config-load
 * time -- the same technique Next.js's own CLI uses internally (see
 * `next/dist/lib/get-network-host.js`) to print its "Network:" URL. This
 * only ever allows addresses actually assigned to this machine right now,
 * which is narrower than any wildcard/CIDR pattern that would match a whole
 * subnet. IPv6 addresses are intentionally excluded: Next.js does not
 * require them for this check, and this project has never needed one here.
 */
function getLocalIPv4Addresses(): string[] {
  const addresses = Object.values(os.networkInterfaces())
    .flatMap((networkInterface) => networkInterface ?? [])
    .filter((address) => address.family === "IPv4" && !address.internal)
    .map((address) => address.address);

  return Array.from(new Set(addresses)).sort();
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", ...getLocalIPv4Addresses()],
};

export default nextConfig;
