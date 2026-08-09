"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { LegacyChromeCompat, type LegacyChromeCompatProps } from "@/components/shell/LegacyChromeCompat";
import { resolveShellMode } from "@/components/shell/routeRegistry";

export type ShellTransitionProps = Omit<LegacyChromeCompatProps, "children"> & {
  children: ReactNode;
};

/**
 * The single root transition selector (EPICENTRAX UI STAGE 2B, §C).
 * Consults `resolveShellMode` exactly once per navigation and renders
 * exactly one presentation -- no route ever receives both legacy chrome
 * and the canonical shell:
 *
 * - "legacy": children render inside the legacy Sidebar/header/app-main/
 *   app-inner frame (`LegacyChromeCompat`), unchanged from before Stage 2.
 * - "exception": children render with no application chrome at all.
 * - "canonical-member" | "canonical-admin" | "canonical-vendor": children
 *   render directly, with NO legacy wrapper. The page's own role adapter
 *   (MemberShellAdapter / AdminShellAdapter / VendorShellAdapter) renders
 *   the canonical AppShell itself, exactly once.
 *
 * This is what eliminates the Stage 2 Vendor double-shell defect: every
 * `/vendor/workspace/**` page already delegates to
 * `VendorShellAdapter -> AppShell`; this selector now ensures nothing
 * above it also renders legacy chrome around that same content.
 */
export function ShellTransition({ children, ...legacyBrandProps }: ShellTransitionProps) {
  const pathname = usePathname();
  const mode = resolveShellMode(pathname);

  if (mode === "legacy") {
    return <LegacyChromeCompat {...legacyBrandProps}>{children}</LegacyChromeCompat>;
  }

  return <>{children}</>;
}
