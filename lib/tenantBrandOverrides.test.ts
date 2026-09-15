import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildTenantBrandOverrides,
  TENANT_BRAND_ACCENT_VAR,
  TENANT_BRAND_PRIMARY_VAR,
  TENANT_BRAND_SECONDARY_VAR,
} from "@/lib/tenantBrandOverrides";

// Boundary hex values below were computed with the exact WCAG 2.x formula
// this module implements, against the exact fixed counterparts read from
// app/globals.css:
//   primary  vs --color-text-on-primary (#ffffff), 4.5:1 -- #767676 passes
//     (4.5422:1), #777777 fails (4.4781:1)
//   accent   vs --color-nav-active-bg   (#eff6ff), 4.5:1 -- #707070 passes
//     (4.5504:1), #717171 fails (4.4848:1)
//   secondary vs --color-selected-bg    (#dbeafe), 3.0:1 -- #858585 passes
//     (3.0245:1), #868686 fails (2.9841:1)

test("a clearly dark, opaque, valid color emits on all three targets", () => {
  const result = buildTenantBrandOverrides({
    primaryColor: "#112233",
    secondaryColor: "#112233",
    accentColor: "#112233",
  });

  assert.deepEqual(result, {
    [TENANT_BRAND_PRIMARY_VAR]: "#112233",
    [TENANT_BRAND_SECONDARY_VAR]: "#112233",
    [TENANT_BRAND_ACCENT_VAR]: "#112233",
  });
});

test("primary: gray right at the 4.5:1 boundary passes, one step lighter fails", () => {
  const passing = buildTenantBrandOverrides({
    primaryColor: "#767676",
    secondaryColor: null,
    accentColor: null,
  });
  assert.deepEqual(passing, { [TENANT_BRAND_PRIMARY_VAR]: "#767676" });

  const failing = buildTenantBrandOverrides({
    primaryColor: "#777777",
    secondaryColor: null,
    accentColor: null,
  });
  assert.deepEqual(failing, {});
});

test("accent: gray right at the 4.5:1 boundary (against nav-active-bg) passes, one step lighter fails", () => {
  const passing = buildTenantBrandOverrides({
    primaryColor: null,
    secondaryColor: null,
    accentColor: "#707070",
  });
  assert.deepEqual(passing, { [TENANT_BRAND_ACCENT_VAR]: "#707070" });

  const failing = buildTenantBrandOverrides({
    primaryColor: null,
    secondaryColor: null,
    accentColor: "#717171",
  });
  assert.deepEqual(failing, {});
});

test("secondary: gray right at the 3:1 boundary (against selected-bg) passes, one step lighter fails", () => {
  const passing = buildTenantBrandOverrides({
    primaryColor: null,
    secondaryColor: "#858585",
    accentColor: null,
  });
  assert.deepEqual(passing, { [TENANT_BRAND_SECONDARY_VAR]: "#858585" });

  const failing = buildTenantBrandOverrides({
    primaryColor: null,
    secondaryColor: "#868686",
    accentColor: null,
  });
  assert.deepEqual(failing, {});
});

test("white, yellow, and other pale named colors are omitted on every target despite passing generic validation", () => {
  for (const value of ["white", "yellow", "#ffffff", "#ffff00", "rgb(255, 255, 0)"]) {
    const result = buildTenantBrandOverrides({
      primaryColor: value,
      secondaryColor: value,
      accentColor: value,
    });
    // "white"/"yellow" are named colors this module does not resolve at all
    // (omitted as unresolvable, not guessed); the equivalent opaque forms
    // (#ffffff, #ffff00, rgb(255,255,0)) resolve fine but fail every
    // target's contrast requirement against its fixed pale counterpart.
    assert.deepEqual(result, {}, `expected no overrides for ${value}`);
  }
});

test("transparent and alpha-bearing forms are omitted on every target", () => {
  for (const value of [
    "transparent",
    "currentcolor",
    "rgba(17, 34, 51, 0.99)",
    "hsla(210, 50%, 20%, 1)",
    "#11223344",
    "#1234",
  ]) {
    const result = buildTenantBrandOverrides({
      primaryColor: value,
      secondaryColor: value,
      accentColor: value,
    });
    assert.deepEqual(result, {}, `expected no overrides for ${value}`);
  }
});

test("hsl()/hsla() and other named colors are not runtime-resolved even when dark", () => {
  // hsl(210, 50%, 10%) is a very dark, high-contrast color in principle, but
  // this module deliberately does not implement HSL->sRGB conversion; it
  // must be omitted as unresolvable, not converted.
  const result = buildTenantBrandOverrides({
    primaryColor: "hsl(210, 50%, 10%)",
    secondaryColor: "black",
    accentColor: "navy",
  });
  assert.deepEqual(result, {});
});

test("malformed, blank, and unresolvable values are omitted, not guessed", () => {
  for (const value of ["not-a-color", "#zzzzzz", "", "   ", "\t", "#12", "rgb(1,2)"]) {
    const result = buildTenantBrandOverrides({
      primaryColor: value,
      secondaryColor: value,
      accentColor: value,
    });
    assert.deepEqual(result, {}, `expected no overrides for ${JSON.stringify(value)}`);
  }
});

test("null values are omitted on every target", () => {
  const result = buildTenantBrandOverrides({
    primaryColor: null,
    secondaryColor: null,
    accentColor: null,
  });
  assert.deepEqual(result, {});
});

test("rgb() percentage form resolves and is subject to the same contrast gate", () => {
  const passing = buildTenantBrandOverrides({
    primaryColor: "rgb(6.66%, 13.33%, 20%)", // ~ #112233
    secondaryColor: null,
    accentColor: null,
  });
  assert.deepEqual(passing, { [TENANT_BRAND_PRIMARY_VAR]: "rgb(6.66%, 13.33%, 20%)" });

  const failing = buildTenantBrandOverrides({
    primaryColor: "rgb(100%, 100%, 100%)", // white
    secondaryColor: null,
    accentColor: null,
  });
  assert.deepEqual(failing, {});
});

test("each target is independent -- one field failing its contrast gate never affects the others", () => {
  const result = buildTenantBrandOverrides({
    primaryColor: "#ffffff", // fails primary's 4.5:1 vs white (contrast 1:1)
    secondaryColor: "#112233", // passes secondary's 3:1 vs #dbeafe
    accentColor: "not-a-color", // fails generic validation entirely
  });

  assert.deepEqual(result, {
    [TENANT_BRAND_SECONDARY_VAR]: "#112233",
  });
});

test("no status or focus CSS variable name can ever be emitted", () => {
  const result = buildTenantBrandOverrides({
    primaryColor: "#112233",
    secondaryColor: "#112233",
    accentColor: "#112233",
  });

  const allowedKeys = new Set([
    TENANT_BRAND_PRIMARY_VAR,
    TENANT_BRAND_SECONDARY_VAR,
    TENANT_BRAND_ACCENT_VAR,
  ]);

  for (const key of Object.keys(result)) {
    assert.equal(allowedKeys.has(key as never), true, `unexpected key: ${key}`);
  }
  // Structural guarantee, not just an instance check: the return type itself
  // (TenantBrandOverrides) only has these three keys, so no status/focus
  // variable name is even expressible as an output of this function.
});
