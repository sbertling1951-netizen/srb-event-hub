"use client";

import { VendorShellAdapter } from "@/components/shell/adapters/VendorShellAdapter";

type VendorWorkspaceShellProps = {
  title: string;
  children: React.ReactNode;
};

/**
 * Compatibility wrapper only (EPICENTRAX UI STAGE 2). VendorWorkspaceShell
 * no longer owns an independent shell implementation -- all presentation
 * (loading/error/selection states, nav, header, account controls) now
 * lives in the canonical AppShell via VendorShellAdapter
 * (components/shell/adapters/VendorShellAdapter.tsx). This wrapper exists
 * only so the seven existing `app/vendor/workspace/**` pages that already
 * import `VendorWorkspaceShell` do not need any change during this
 * foundation stage; it may be removed once those call sites are migrated
 * to import VendorShellAdapter directly in a later stage.
 */
export default function VendorWorkspaceShell({ title, children }: VendorWorkspaceShellProps) {
  return <VendorShellAdapter pageTitle={title}>{children}</VendorShellAdapter>;
}
