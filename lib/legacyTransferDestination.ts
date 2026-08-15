// Legacy Login Transfer: canonical destination-path validator.
//
// This is the single shared implementation for validating a transfer's
// intended destination -- both the legacy-domain initiation route and the
// canonical-domain final navigation step must import and use this same
// function rather than each re-implementing this logic. No route wiring
// happens in this file; it is a pure function with no side effects.
//
// Canonicalization model (deterministic, tested):
//   - The input is percent-decoded exactly once via decodeURIComponent().
//   - Every safety check runs against that decoded form, never the raw
//     form, so an encoded bypass (e.g. the second slash of "//evil.com"
//     sent as "%2F") is caught -- decoding happens strictly before
//     evaluation.
//   - On success, the function returns the decoded form itself (not the
//     original encoding). This is deliberate: whatever this function
//     validated is exactly what a caller (e.g. router.replace()) then
//     uses, with no further ambiguous decoding step left for anything
//     downstream to reinterpret differently than what was checked here.
//   - Ordinary already-safe paths (no percent-encoding present) are
//     returned unchanged, since decoding a string with nothing to decode
//     is a no-op -- legitimate deep links such as "/member/agenda" or
//     "/admin/dashboard?tab=today" pass through byte-for-byte.
//   - Any invalid, unsafe, or unparseable input degrades to "/" -- this
//     function never throws.

const MAX_RAW_LENGTH = 2048;

// Callback/bootstrap surfaces that consume or expect a live, externally
// issued one-time credential (a Supabase magic-link/recovery session, or
// a raw API endpoint) -- landing a transfer here would be nonsensical at
// best and could interact unsafely with an unrelated in-flight auth flow
// at worst. This is deliberately narrow: ordinary application pages
// (e.g. /member/agenda, /admin/dashboard, /vendor/workspace) are never
// listed here.
const SENSITIVE_PATH_PREFIXES = [
  "/auth/",
  "/api/",
  "/vendor/callback",
  "/vendor/reset-password",
  "/member/account/reset-password",
] as const;

const FALLBACK = "/";

// Deliberately matching C0 control characters + DEL.
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1f\x7f]/;

function isSensitivePath(pathname: string): boolean {
  return SENSITIVE_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  );
}

export function validateTransferDestination(
  raw: string | null | undefined,
): string {
  if (typeof raw !== "string" || raw.length === 0) {
    return FALLBACK;
  }

  if (raw.length > MAX_RAW_LENGTH) {
    return FALLBACK;
  }

  // Reject a raw null byte before attempting to decode -- decodeURIComponent
  // would otherwise happily pass one through inside the decoded string.
  if (raw.includes("\0")) {
    return FALLBACK;
  }

  let decoded: string;
  try {
    // Decode once, before any safety evaluation, so an encoded bypass
    // (e.g. "%2F%2Fevil.com" -> "//evil.com") is caught by the checks
    // below rather than slipping past them in encoded form. Malformed
    // percent-encoding (decodeURIComponent throws URIError) fails closed.
    decoded = decodeURIComponent(raw);
  } catch {
    return FALLBACK;
  }

  if (decoded.length === 0) {
    return FALLBACK;
  }

  if (CONTROL_CHARACTER_PATTERN.test(decoded)) {
    return FALLBACK;
  }

  if (!decoded.startsWith("/")) {
    return FALLBACK;
  }

  // Protocol-relative ("//evil.com") -- browsers navigate this as an
  // absolute URL to a different host.
  if (decoded.startsWith("//")) {
    return FALLBACK;
  }

  // Backslashes anywhere are rejected wholesale, not just at the start:
  // browsers normalize "\" to "/" while resolving a URL, so "/\evil.com"
  // (and mixed forms like "/\/evil.com") can become protocol-relative
  // ("//evil.com") after that normalization even though the raw/decoded
  // string here still starts with a single "/". No legitimate internal
  // relative path in this application ever needs a literal backslash.
  if (decoded.includes("\\")) {
    return FALLBACK;
  }

  // Defense in depth: an actual URI scheme can only appear at position 0
  // (RFC 3986's scheme-start-state requires the very first character to
  // be an ASCII letter), which the leading "/" check above already rules
  // out entirely for the decoded value. This check costs nothing and
  // guards against this function ever being reused in a context where
  // the leading-"/" requirement is relaxed.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) {
    return FALLBACK;
  }

  const pathname = decoded.split(/[?#]/, 1)[0] ?? decoded;
  if (isSensitivePath(pathname)) {
    return FALLBACK;
  }

  return decoded;
}
