"use client";

import { useState } from "react";

import { buildShellBrand } from "@/components/shell/brand";
import type { ShellBrand } from "@/components/shell/types";
import type { TenantMetadataForm } from "@/lib/tenantAdministration";

// Representative live preview of the Tenant Branding & Appearance values the
// Platform Administrator is currently editing (Tenant Branding P-1).
//
// It reuses buildShellBrand() verbatim for the title / tagline / logo
// fallback logic -- the same projection every role shell adapter uses -- so
// this preview cannot drift from real shell brand behavior. It deliberately
// does NOT import AppShell or ShellHeader: it is a small standalone strip,
// not the real chrome.
//
// The three brand colors are shown only as stored swatches. P-1 does not
// apply primary/secondary/accent colors to any runtime shell rendering, and
// the note text says so.

export type TenantBrandingPreviewForm = Pick<
  TenantMetadataForm,
  | "organization_name"
  | "display_name"
  | "app_title"
  | "app_tagline"
  | "logo_url"
  | "primary_color"
  | "secondary_color"
  | "accent_color"
>;

function nullableTrim(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Projects the branding form into the shell brand slot using the shared
 * buildShellBrand() fallback logic. Exported for focused tests so the
 * fallback behavior can be asserted without a DOM.
 */
export function previewBrandFromForm(form: TenantBrandingPreviewForm): ShellBrand {
  return buildShellBrand({
    organizationName: form.organization_name.trim(),
    displayName: nullableTrim(form.display_name) ?? "",
    appTitle: form.app_title.trim(),
    appTagline: nullableTrim(form.app_tagline),
    logoUrl: nullableTrim(form.logo_url),
    faviconUrl: null,
    primaryColor: nullableTrim(form.primary_color),
    secondaryColor: nullableTrim(form.secondary_color),
    accentColor: nullableTrim(form.accent_color),
  });
}

const SWATCH_FIELDS: ReadonlyArray<{
  key: "primary_color" | "secondary_color" | "accent_color";
  label: string;
}> = [
  { key: "primary_color", label: "Primary" },
  { key: "secondary_color", label: "Secondary" },
  { key: "accent_color", label: "Accent" },
];

export function TenantBrandingPreview({
  form,
}: {
  form: TenantBrandingPreviewForm;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const brand = previewBrandFromForm(form);
  const logoUrl = logoFailed ? null : brand.logoUrl || null;
  const fallbackInitial =
    (brand.logoAlt || brand.title || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="tenant-branding-preview" aria-label="Tenant branding preview">
      <div className="tenant-branding-preview-bar">
        {logoUrl ? (
          <img
            key={logoUrl}
            src={logoUrl}
            alt={brand.logoAlt || brand.title}
            className="tenant-branding-preview-logo"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <span
            className="tenant-branding-preview-logo tenant-branding-preview-logo-fallback"
            aria-hidden="true"
          >
            {fallbackInitial}
          </span>
        )}
        <div className="tenant-branding-preview-titles">
          <div className="tenant-branding-preview-title">{brand.title}</div>
          {brand.tagline ? (
            <div className="tenant-branding-preview-tagline">{brand.tagline}</div>
          ) : null}
        </div>
      </div>

      <div className="tenant-branding-preview-swatches">
        {SWATCH_FIELDS.map(({ key, label }) => {
          const value = form[key].trim();
          return (
            <div key={key} className="tenant-branding-preview-swatch">
              <span
                className="tenant-branding-preview-swatch-chip"
                style={value ? { background: value } : undefined}
                data-empty={value ? undefined : "true"}
                aria-hidden="true"
              />
              <span className="tenant-branding-preview-swatch-label">
                {label}: {value || "Not set"}
              </span>
            </div>
          );
        })}
      </div>

      <p className="app-field-help tenant-branding-preview-note">
        Preview of tenant identity. Brand colors are stored for future
        theme-aware presentation and are not yet applied globally.
      </p>
    </div>
  );
}
