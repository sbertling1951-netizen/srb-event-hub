// Client-side CSS color validation for the Tenant Branding & Appearance
// editor (Tenant Branding P-1).
//
// Deterministic and browser-independent so tests do not depend on a full
// CSSOM: a value is accepted when it matches one of the practical hex /
// rgb() / rgba() / hsl() / hsla() forms, or is a CSS named color. In a real
// browser an additional CSS.supports("color", value) check widens acceptance
// to modern syntaxes (e.g. space-separated `rgb(0 0 0 / 50%)`); it is never
// the sole gate, and its absence never rejects a value the deterministic
// rules already accept.
//
// Blank is valid -- a blank brand color falls back to the neutral platform
// default (ADR-009 §9).
//
// P-1 scope: this is advisory client validation only. It does NOT normalize
// or rewrite the value, and the governed
// update_tenant_metadata_for_administration RPC still stores the trimmed
// string verbatim. Server-side format validation is explicitly out of P-1.

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// rgb()/rgba()/hsl()/hsla() with comma-separated arguments (the classic form
// named in the P-1 contract). The first argument may carry an angle unit for
// hsl(); every argument may be an integer, decimal, or percentage; an
// optional fourth alpha argument is allowed. Whitespace is permitted around
// each argument.
const FUNCTIONAL_COLOR =
  /^(?:rgb|rgba|hsl|hsla)\(\s*-?\d*\.?\d+(?:deg|grad|rad|turn|%)?\s*(?:,\s*-?\d*\.?\d+%?\s*){2}(?:,\s*-?\d*\.?\d+%?\s*)?\)$/i;

// CSS Color Module Level 4 named colors, plus the two keywords the color
// property also accepts. Compared case-insensitively.
const CSS_NAMED_COLORS: ReadonlySet<string> = new Set([
  "transparent", "currentcolor",
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige",
  "bisque", "black", "blanchedalmond", "blue", "blueviolet", "brown",
  "burlywood", "cadetblue", "chartreuse", "chocolate", "coral",
  "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue", "darkcyan",
  "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki",
  "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred",
  "darksalmon", "darkseagreen", "darkslateblue", "darkslategray",
  "darkslategrey", "darkturquoise", "darkviolet", "deeppink", "deepskyblue",
  "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite",
  "forestgreen", "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod",
  "gray", "green", "greenyellow", "grey", "honeydew", "hotpink", "indianred",
  "indigo", "ivory", "khaki", "lavender", "lavenderblush", "lawngreen",
  "lemonchiffon", "lightblue", "lightcoral", "lightcyan",
  "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey",
  "lightpink", "lightsalmon", "lightseagreen", "lightskyblue",
  "lightslategray", "lightslategrey", "lightsteelblue", "lightyellow",
  "lime", "limegreen", "linen", "magenta", "maroon", "mediumaquamarine",
  "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen",
  "mediumslateblue", "mediumspringgreen", "mediumturquoise",
  "mediumvioletred", "midnightblue", "mintcream", "mistyrose", "moccasin",
  "navajowhite", "navy", "oldlace", "olive", "olivedrab", "orange",
  "orangered", "orchid", "palegoldenrod", "palegreen", "paleturquoise",
  "palevioletred", "papayawhip", "peachpuff", "peru", "pink", "plum",
  "powderblue", "purple", "rebeccapurple", "red", "rosybrown", "royalblue",
  "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell", "sienna",
  "silver", "skyblue", "slateblue", "slategray", "slategrey", "snow",
  "springgreen", "steelblue", "tan", "teal", "thistle", "tomato",
  "turquoise", "violet", "wheat", "white", "whitesmoke", "yellow",
  "yellowgreen",
]);

/**
 * True when `raw` is blank or one of the CSS color forms the Tenant Branding
 * editor accepts. Never throws; never mutates.
 */
export function isValidBrandColor(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined) {
    return true;
  }
  const value = raw.trim();
  if (value === "") {
    return true;
  }
  if (HEX_COLOR.test(value) || FUNCTIONAL_COLOR.test(value)) {
    return true;
  }
  if (CSS_NAMED_COLORS.has(value.toLowerCase())) {
    return true;
  }
  if (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("color", value)
  ) {
    return true;
  }
  return false;
}

/** Field-level error copy for an invalid brand color. */
export function brandColorErrorMessage(label: string): string {
  return `${label} must be a hex value (#rgb, #rgba, #rrggbb, #rrggbbaa), an rgb()/rgba()/hsl()/hsla() value, or a CSS color name. Leave it blank to use the neutral default.`;
}
