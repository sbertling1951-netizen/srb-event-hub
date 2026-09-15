import { isValidBrandColor } from "@/lib/tenantBrandingColor";

// Tier 1 -> Tier 2 projection (Runtime Tenant-Branding Token Contract,
// docs/architecture/EPICENTRAX_RUNTIME_TENANT_BRANDING_TOKEN_CONTRACT.md).
//
// Input is intentionally narrower than TenantContext: only the three
// presentation-safe color fields, never tenant id/slug/code/hostname or any
// authority-bearing field, so this module cannot leak non-presentation data
// even if a caller had a full TenantContext in scope.
export type TenantBrandColorInput = {
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
};

// Tier 2 variable names -- deliberately distinct from the Tier 3 semantic
// token names in app/globals.css so the two tiers stay visually
// distinguishable in source.
export const TENANT_BRAND_PRIMARY_VAR = "--tenant-brand-primary";
export const TENANT_BRAND_SECONDARY_VAR = "--tenant-brand-secondary";
export const TENANT_BRAND_ACCENT_VAR = "--tenant-brand-accent";

export type TenantBrandOverrides = Partial<
  Record<
    | typeof TENANT_BRAND_PRIMARY_VAR
    | typeof TENANT_BRAND_SECONDARY_VAR
    | typeof TENANT_BRAND_ACCENT_VAR,
    string
  >
>;

// ---------------------------------------------------------------------------
// Deterministic opaque-sRGB resolution and WCAG contrast gate.
//
// isValidBrandColor() (lib/tenantBrandingColor.ts) is, and remains, purely
// syntactic -- it is the generic contract for what a *stored* brand color
// string may look like, and this module does not alter it. A value can pass
// that gate (e.g. "white", "yellow", any rgba()/hsla()/4- or 8-digit hex,
// "transparent", "currentcolor") and still be unsafe or unresolvable for
// *this* runtime projection's specific job: overriding a Tier 3 token that
// has a fixed neighboring color that never itself changes.
//
// This second, narrower gate only ever runs after isValidBrandColor() has
// already passed. It supports exactly two syntactically opaque forms it can
// resolve to sRGB with no external library and no guessing:
//   - 3- or 6-digit hex (#rgb, #rrggbb) -- never 4/8-digit (alpha-bearing)
//   - rgb(r, g, b) with exactly three comma-separated integer or percentage
//     components -- never rgba()/hsl()/hsla() (alpha-bearing or requiring a
//     color-space conversion this module does not implement)
// Every other syntactically valid form (named colors including "white" and
// "transparent", any alpha-bearing form, hsl()/hsla(), "currentcolor", the
// modern space-separated syntax) is syntactically valid brand-color storage
// but not runtime-resolvable here, and is omitted -- never guessed at, never
// converted.
// ---------------------------------------------------------------------------

type OpaqueRgb = { r: number; g: number; b: number };

const HEX_OPAQUE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB_FUNC_OPAQUE =
  /^rgb\(\s*(-?[\d.]+%?)\s*,\s*(-?[\d.]+%?)\s*,\s*(-?[\d.]+%?)\s*\)$/i;

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function parseRgbComponent(token: string): number | null {
  const trimmed = token.trim();
  if (trimmed.endsWith("%")) {
    const percent = Number.parseFloat(trimmed.slice(0, -1));
    if (!Number.isFinite(percent)) {
      return null;
    }
    return clampChannel((percent / 100) * 255);
  }
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value)) {
    return null;
  }
  return clampChannel(value);
}

function parseHexOpaque(value: string): OpaqueRgb | null {
  const hex = value.slice(1);
  if (hex.length === 3) {
    const r = Number.parseInt(hex[0] + hex[0], 16);
    const g = Number.parseInt(hex[1] + hex[1], 16);
    const b = Number.parseInt(hex[2] + hex[2], 16);
    return { r, g, b };
  }
  // hex.length === 6
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return { r, g, b };
}

/**
 * Resolves a syntactically-valid-per-isValidBrandColor() string to an opaque
 * sRGB triple, only for the two deterministic forms this module supports.
 * Returns null for anything else -- including every alpha-bearing form,
 * named colors, hsl()/hsla(), and "currentcolor"/"transparent" -- rather
 * than guessing or converting.
 */
function parseOpaqueSrgb(value: string): OpaqueRgb | null {
  if (HEX_OPAQUE.test(value)) {
    return parseHexOpaque(value);
  }
  const match = RGB_FUNC_OPAQUE.exec(value);
  if (match) {
    const r = parseRgbComponent(match[1]);
    const g = parseRgbComponent(match[2]);
    const b = parseRgbComponent(match[3]);
    if (r === null || g === null || b === null) {
      return null;
    }
    return { r, g, b };
  }
  return null;
}

function srgbChannelToLinear(channel255: number): number {
  const c = channel255 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance (0 = black, 1 = white). */
function relativeLuminance({ r, g, b }: OpaqueRgb): number {
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

/** WCAG 2.x contrast ratio between two opaque sRGB colors, in [1, 21]. */
function contrastRatio(a: OpaqueRgb, b: OpaqueRgb): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

// Floating-point contrast arithmetic can land a hair below an exact integer
// or half-integer threshold for a color that is mathematically exactly at
// it; this epsilon absorbs only that representational noise, not the
// requirement itself.
const CONTRAST_EPSILON = 1e-9;

function meetsContrast(
  candidate: OpaqueRgb,
  fixedCounterpart: OpaqueRgb,
  minRatio: number,
): boolean {
  return contrastRatio(candidate, fixedCounterpart) >= minRatio - CONTRAST_EPSILON;
}

// Exact fixed counterparts, taken verbatim from app/globals.css -- the
// literals these Tier 3 tokens' neighbors already render today and that
// this bridge does not (and per the contract, must not) alter.
//   --color-text-on-primary: #ffffff;   (.app-button-primary's fixed text)
//   --color-nav-active-bg:   #eff6ff;   (.shell-nav-item-active's fixed background)
//   --color-selected-bg:     #dbeafe;   (.responsive-list-item-selected's fixed adjacent surface)
const TEXT_ON_PRIMARY: OpaqueRgb = { r: 0xff, g: 0xff, b: 0xff };
const NAV_ACTIVE_BG: OpaqueRgb = { r: 0xef, g: 0xf6, b: 0xff };
const SELECTED_BG: OpaqueRgb = { r: 0xdb, g: 0xea, b: 0xfe };

// WCAG 2.x thresholds for each target's actual role against its fixed
// counterpart: 4.5:1 (normal-text minimum, SC 1.4.3) for the two text/
// background text pairings; 3:1 (non-text/UI-component minimum, SC 1.4.11)
// for the selected-state border against its adjacent fixed surface.
const PRIMARY_MIN_CONTRAST = 4.5;
const ACCENT_MIN_CONTRAST = 4.5;
const SECONDARY_MIN_CONTRAST = 3.0;

/**
 * Projects one candidate value for one specific Tier 2 target: it must pass
 * the generic isValidBrandColor() storage contract, be resolvable to an
 * opaque sRGB triple by this module's deterministic parser, and meet that
 * target's WCAG contrast requirement against its exact fixed counterpart.
 * Any failure at any step omits the value -- it never falls through to a
 * guessed or transformed color.
 */
function projectTarget(
  raw: string | null,
  fixedCounterpart: OpaqueRgb,
  minContrast: number,
): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  if (!isValidBrandColor(trimmed)) {
    return null;
  }
  const rgb = parseOpaqueSrgb(trimmed);
  if (!rgb) {
    return null;
  }
  if (!meetsContrast(rgb, fixedCounterpart, minContrast)) {
    return null;
  }
  return trimmed;
}

/**
 * Projects already-resolved, presentation-safe Tenant colors into the Tier 2
 * runtime CSS custom-property layer. Each field is independent: a missing,
 * invalid, unresolvable, or contrast-unsafe value is simply omitted (never
 * an empty, unvalidated, or unsafe string), and one bad field never affects
 * the others. Returns an empty object when no field yields a usable value --
 * callers should treat that as "no override," not as an error.
 */
export function buildTenantBrandOverrides(
  colors: TenantBrandColorInput,
): TenantBrandOverrides {
  const overrides: TenantBrandOverrides = {};

  const primary = projectTarget(
    colors.primaryColor,
    TEXT_ON_PRIMARY,
    PRIMARY_MIN_CONTRAST,
  );
  if (primary) {
    overrides[TENANT_BRAND_PRIMARY_VAR] = primary;
  }

  const secondary = projectTarget(
    colors.secondaryColor,
    SELECTED_BG,
    SECONDARY_MIN_CONTRAST,
  );
  if (secondary) {
    overrides[TENANT_BRAND_SECONDARY_VAR] = secondary;
  }

  const accent = projectTarget(
    colors.accentColor,
    NAV_ACTIVE_BG,
    ACCENT_MIN_CONTRAST,
  );
  if (accent) {
    overrides[TENANT_BRAND_ACCENT_VAR] = accent;
  }

  return overrides;
}
