import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  previewBrandFromForm,
  type TenantBrandingPreviewForm,
} from "@/components/admin/tenant/TenantBrandingPreview";
import { DEFAULT_TENANT_LABELS } from "@/lib/tenantLabels";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./TenantBrandingPreview.tsx", import.meta.url)),
  "utf8",
);

function form(
  overrides: Partial<TenantBrandingPreviewForm> = {},
): TenantBrandingPreviewForm {
  return {
    organization_name: "",
    display_name: "",
    app_title: "",
    app_tagline: "",
    logo_url: "",
    primary_color: "",
    secondary_color: "",
    accent_color: "",
    ...overrides,
  };
}

// ---- Reuse of the shared brand projection ----

test("preview reuses buildShellBrand rather than re-implementing brand fallback logic", () => {
  assert.match(SOURCE, /import \{ buildShellBrand \} from "@\/components\/shell\/brand"/);
  assert.doesNotMatch(SOURCE, /DEFAULT_TENANT_LABELS/);
  assert.doesNotMatch(SOURCE, /"Event Hub"/);
});

test("preview does not import or render the full AppShell / ShellHeader", () => {
  const importLines = SOURCE.split("\n").filter((line) => line.startsWith("import "));
  for (const line of importLines) {
    assert.doesNotMatch(line, /AppShell|ShellHeader/, line);
  }
  assert.doesNotMatch(SOURCE, /<AppShell|<ShellHeader/);
});

// ---- Title / tagline fallback behavior (delegated to buildShellBrand) ----

test("blank app title falls back to the generic platform default", () => {
  assert.equal(previewBrandFromForm(form()).title, DEFAULT_TENANT_LABELS.app_title);
});

test("a provided app title / tagline / logo are surfaced verbatim", () => {
  const brand = previewBrandFromForm(
    form({
      app_title: "Rally Hub",
      app_tagline: "See you there",
      logo_url: "https://cdn.example/logo.svg",
      display_name: "Some Org",
    }),
  );
  assert.equal(brand.title, "Rally Hub");
  assert.equal(brand.tagline, "See you there");
  assert.equal(brand.logoUrl, "https://cdn.example/logo.svg");
  assert.equal(brand.logoAlt, "Some Org");
});

test("blank tagline follows buildShellBrand's own projection (generic default, never an FCOC string)", () => {
  const brand = previewBrandFromForm(form());
  assert.equal(brand.tagline, DEFAULT_TENANT_LABELS.app_tagline);
});

test("blank logo yields a null logo URL so the component can render its neutral fallback", () => {
  assert.equal(previewBrandFromForm(form()).logoUrl, null);
});

// ---- Component render shape ----

test("logo renders with an onError fallback to a neutral placeholder", () => {
  assert.match(SOURCE, /onError=\{\(\) => setLogoFailed\(true\)\}/);
  assert.match(SOURCE, /tenant-branding-preview-logo-fallback/);
});

test("primary, secondary, and accent values are each shown as a labelled swatch", () => {
  assert.match(SOURCE, /primary_color/);
  assert.match(SOURCE, /secondary_color/);
  assert.match(SOURCE, /accent_color/);
  assert.match(SOURCE, /tenant-branding-preview-swatch-chip/);
  assert.match(SOURCE, /\{value \|\| "Not set"\}/);
});

test("preview carries the explicit note that colors are not yet applied globally", () => {
  assert.match(
    SOURCE,
    /Brand colors are stored for future\s*\n?\s*theme-aware presentation and are not yet applied globally\./,
  );
});

test("no hardcoded FCOC / EventSync asset or brand fallback is introduced", () => {
  assert.doesNotMatch(SOURCE, /fcoc-logo/i);
  assert.doesNotMatch(SOURCE, /\bFCOC\b/);
  assert.doesNotMatch(SOURCE, /EventSync/i);
});
