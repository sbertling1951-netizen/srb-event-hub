import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveShellInterfaceCapabilities,
  SHELL_BREAKPOINT_COMPACT,
  SHELL_BREAKPOINT_WIDE,
} from "@/components/shell/useShellViewport";

test("compact capability is below the persistent-navigation threshold", () => {
  const capabilities = resolveShellInterfaceCapabilities(
    SHELL_BREAKPOINT_COMPACT - 1,
  );

  assert.deepEqual(capabilities, {
    viewportClass: "compact",
    isCompact: true,
    supportsPersistentNavigation: false,
    prefersReducedMotion: false,
  });
});

test("the compact boundary remains standard at 900px", () => {
  const capabilities = resolveShellInterfaceCapabilities(
    SHELL_BREAKPOINT_COMPACT,
  );

  assert.equal(capabilities.viewportClass, "standard");
  assert.equal(capabilities.isCompact, false);
  assert.equal(capabilities.supportsPersistentNavigation, true);
});

test("wide capability begins at the existing 1200px threshold", () => {
  const capabilities = resolveShellInterfaceCapabilities(
    SHELL_BREAKPOINT_WIDE,
  );

  assert.equal(capabilities.viewportClass, "wide");
  assert.equal(capabilities.isCompact, false);
  assert.equal(capabilities.supportsPersistentNavigation, true);
});

test("reduced motion is a deterministic current-environment fact", () => {
  const capabilities = resolveShellInterfaceCapabilities(1024, true);

  assert.equal(capabilities.prefersReducedMotion, true);
  assert.equal(capabilities.viewportClass, "standard");
});
