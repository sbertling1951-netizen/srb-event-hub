// Stage 5B.1 Vendor Import normalization contract. This module is pure: it
// creates staged evidence and review classifications, never a database command
// or a canonical Vendor identity decision.

export type RawVendorImportRow = Record<string, unknown>;
export type VendorImportIssue = { code: string; message: string; severity: "error" | "warning" };
export type VendorActionType = "service_request" | "external_signup" | "info_only";

export type VendorImportCandidate = {
  source_row_number: number;
  identity_evidence: {
    // This is the deterministic match key, not permission to alter vendors.
    business_name: string;
    contact_name?: string;
    email?: string;
    phone?: string;
    website?: string;
    business_description?: string;
    preferred_contact_method?: "email" | "phone" | "text" | "in_app";
  };
  event_intent: {
    // false is intentionally distinct from omitted. A later commit treats
    // false as no admission instruction, never as a revoke request.
    admit?: boolean;
    is_featured?: boolean;
    is_visible_to_members?: boolean;
    action_type?: VendorActionType;
    signup_url?: string;
    booth_location?: string;
    event_note?: string;
    display_order?: number;
    show_on_member_dashboard?: boolean;
    allow_service_requests?: boolean;
  };
};

export type VendorImportInterpretation = {
  source_payload: RawVendorImportRow;
  candidate: VendorImportCandidate;
  fingerprint: Promise<string>;
  validation_state: "valid" | "validation_failed" | "needs_review";
  issues: VendorImportIssue[];
};

export const PREFERRED_VENDOR_HEADINGS = {
  business_name: "Business Name",
  contact_name: "Contact Person",
  email: "Email",
  phone: "Phone",
  website: "Website",
  business_description: "Business Description",
  preferred_contact_method: "Preferred Contact Method",
  admit: "Admit to This Event?",
  is_featured: "Featured?",
  is_visible_to_members: "Visible to Members?",
  action_type: "Action Type",
  signup_url: "Signup URL",
  booth_location: "Booth Location",
  event_note: "Event Note",
  display_order: "Display Order",
  show_on_member_dashboard: "Show on Member Dashboard",
  allow_service_requests: "Allow Service Requests",
} as const;

// There is no historical Vendor importer. The only non-preferred alias is the
// existing canonical UI/model term "Contact Name"; case and whitespace are
// accepted by heading normalization without adding aliases.
export const VENDOR_FIELD_ALIASES = {
  business_name: [PREFERRED_VENDOR_HEADINGS.business_name],
  contact_name: [PREFERRED_VENDOR_HEADINGS.contact_name, "Contact Name"],
  email: [PREFERRED_VENDOR_HEADINGS.email],
  phone: [PREFERRED_VENDOR_HEADINGS.phone],
  website: [PREFERRED_VENDOR_HEADINGS.website],
  business_description: [PREFERRED_VENDOR_HEADINGS.business_description],
  preferred_contact_method: [PREFERRED_VENDOR_HEADINGS.preferred_contact_method],
  admit: [PREFERRED_VENDOR_HEADINGS.admit],
  is_featured: [PREFERRED_VENDOR_HEADINGS.is_featured],
  is_visible_to_members: [PREFERRED_VENDOR_HEADINGS.is_visible_to_members],
  action_type: [PREFERRED_VENDOR_HEADINGS.action_type],
  signup_url: [PREFERRED_VENDOR_HEADINGS.signup_url],
  booth_location: [PREFERRED_VENDOR_HEADINGS.booth_location],
  event_note: [PREFERRED_VENDOR_HEADINGS.event_note],
  display_order: [PREFERRED_VENDOR_HEADINGS.display_order],
  show_on_member_dashboard: [PREFERRED_VENDOR_HEADINGS.show_on_member_dashboard],
  allow_service_requests: [PREFERRED_VENDOR_HEADINGS.allow_service_requests],
} as const;

const headingKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const text = (value: unknown) => value == null ? "" : String(value).trim().replace(/\s+/g, " ");
const optionalText = (value: string) => value || undefined;

/** The sole Stage 5B identity key: trim, collapse whitespace, then case-fold. */
export function normalizeVendorBusinessName(value: unknown): string {
  return text(value).toLocaleLowerCase();
}

export function normalizeVendorPhone(value: unknown): string {
  const raw = text(value);
  const digits = raw.replace(/\D+/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return raw;
}

function normalizeUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function booleanToken(value: unknown): boolean | undefined {
  const normalized = headingKey(text(value));
  if (!normalized) return undefined;
  if (["yes", "y", "true", "1"].includes(normalized)) return true;
  if (["no", "n", "false", "0"].includes(normalized)) return false;
  return undefined;
}

function rawValues(row: RawVendorImportRow, aliases: readonly string[]) {
  return Object.entries(row)
    .filter(([header]) => aliases.some((alias) => headingKey(alias) === headingKey(header)))
    .map(([, value]) => text(value))
    .filter(Boolean);
}

function comparable(field: keyof typeof VENDOR_FIELD_ALIASES, value: string): string {
  if (["admit", "is_featured", "is_visible_to_members", "show_on_member_dashboard", "allow_service_requests"].includes(field)) {
    const parsed = booleanToken(value);
    return parsed === undefined ? headingKey(value) : String(parsed);
  }
  if (field === "email" || field === "preferred_contact_method" || field === "action_type") return headingKey(value);
  if (field === "phone") return normalizeVendorPhone(value).replace(/\D/g, "");
  if (field === "website" || field === "signup_url") return normalizeUrl(value) ?? headingKey(value);
  if (field === "display_order" && /^-?\d+$/.test(value)) return String(Number(value));
  return text(value);
}

function field(row: RawVendorImportRow, name: keyof typeof VENDOR_FIELD_ALIASES, issues: VendorImportIssue[]) {
  const values = rawValues(row, VENDOR_FIELD_ALIASES[name]);
  if (new Set(values.map((value) => comparable(name, value))).size > 1) {
    issues.push({ code: "conflicting_aliases", message: `Conflicting values for ${name}`, severity: "error" });
  }
  return values[0] || "";
}

function readBoolean(value: string, label: string, issues: VendorImportIssue[]): boolean | undefined {
  if (!value) return undefined;
  const parsed = booleanToken(value);
  if (parsed === undefined) issues.push({ code: "malformed_boolean", message: `Malformed ${label}`, severity: "error" });
  return parsed;
}

function readUrl(value: string, label: string, issues: VendorImportIssue[]): string | undefined {
  if (!value) return undefined;
  const normalized = normalizeUrl(value);
  if (normalized === null) issues.push({ code: "malformed_url", message: `Malformed ${label}`, severity: "error" });
  return normalized || undefined;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export async function fingerprintVendorImportCandidate(candidate: VendorImportCandidate): Promise<string> {
  const bytes = new TextEncoder().encode(stable(candidate));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function interpretVendorImportRow(source_payload: RawVendorImportRow, source_row_number: number): VendorImportInterpretation {
  const issues: VendorImportIssue[] = [];
  const get = (name: keyof typeof VENDOR_FIELD_ALIASES) => field(source_payload, name, issues);
  const businessName = normalizeVendorBusinessName(get("business_name"));
  const email = optionalText(get("email").toLowerCase());
  const phoneRaw = get("phone");
  const phone = optionalText(normalizeVendorPhone(phoneRaw));
  const website = readUrl(get("website"), "Website", issues);
  const signupUrl = readUrl(get("signup_url"), "Signup URL", issues);
  const preferredRaw = get("preferred_contact_method").toLowerCase();
  const preferred = optionalText(preferredRaw) as VendorImportCandidate["identity_evidence"]["preferred_contact_method"];
  const actionRaw = get("action_type").toLowerCase();
  const actionType = optionalText(actionRaw) as VendorActionType | undefined;
  const displayOrderRaw = get("display_order");
  const displayOrder = displayOrderRaw && /^-?\d+$/.test(displayOrderRaw) ? Number(displayOrderRaw) : undefined;
  const candidate: VendorImportCandidate = {
    source_row_number,
    identity_evidence: withoutUndefined({
      business_name: businessName,
      contact_name: optionalText(get("contact_name")),
      email,
      phone,
      website,
      business_description: optionalText(get("business_description")),
      preferred_contact_method: preferred,
    }),
    event_intent: withoutUndefined({
      admit: readBoolean(get("admit"), "admission flag", issues),
      is_featured: readBoolean(get("is_featured"), "featured flag", issues),
      is_visible_to_members: readBoolean(get("is_visible_to_members"), "visibility flag", issues),
      action_type: actionType,
      signup_url: signupUrl,
      booth_location: optionalText(get("booth_location")),
      event_note: optionalText(get("event_note")),
      display_order: displayOrder,
      show_on_member_dashboard: readBoolean(get("show_on_member_dashboard"), "dashboard flag", issues),
      allow_service_requests: readBoolean(get("allow_service_requests"), "service-request flag", issues),
    }),
  };
  if (!businessName) issues.push({ code: "missing_business_name", message: "Missing Business Name", severity: "error" });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issues.push({ code: "malformed_email", message: "Malformed email", severity: "error" });
  if (phone && phone.replace(/\D/g, "").length !== 10) issues.push({ code: "malformed_phone", message: "Malformed phone", severity: "error" });
  if (preferred && !["email", "phone", "text", "in_app"].includes(preferred)) issues.push({ code: "invalid_preferred_contact_method", message: "Invalid Preferred Contact Method", severity: "error" });
  if (actionType && !["service_request", "external_signup", "info_only"].includes(actionType)) issues.push({ code: "invalid_action_type", message: "Invalid Action Type", severity: "error" });
  if (displayOrderRaw && displayOrder === undefined) issues.push({ code: "invalid_display_order", message: "Display Order must be an integer", severity: "error" });
  return { source_payload, candidate, fingerprint: fingerprintVendorImportCandidate(candidate), validation_state: issues.some((issue) => issue.severity === "error") ? "validation_failed" : "valid", issues };
}

export type VendorFileAmbiguity = { kind: "duplicate_business_name"; business_name: string; row_numbers: number[]; state: "needs_review"; reason: "vendor_duplicate_in_file" };

/** Every duplicate is surfaced; no first- or last-row winner is selected. */
export function classifyVendorFileAmbiguities(rows: VendorImportInterpretation[]): VendorFileAmbiguity[] {
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    const name = row.candidate.identity_evidence.business_name;
    if (name) grouped.set(name, [...(grouped.get(name) || []), row.candidate.source_row_number]);
  }
  return [...grouped.entries()]
    .filter(([, rowNumbers]) => rowNumbers.length > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([business_name, row_numbers]) => ({ kind: "duplicate_business_name", business_name, row_numbers, state: "needs_review", reason: "vendor_duplicate_in_file" }));
}

export type CanonicalVendorMatch = {
  id: string;
  is_active: boolean;
  business_name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  business_description?: string | null;
  preferred_contact_method?: string | null;
};
export type CanonicalVendorMatchClassification =
  | { state: "needs_review"; reason: "vendor_not_found" | "vendor_inactive" | "vendor_identity_ambiguous" | "vendor_identity_conflict"; conflicting_fields?: string[] }
  | { state: "eligible"; canonical_vendor_id: string };

function normalizedSupportingEvidence(field: keyof Omit<CanonicalVendorMatch, "id" | "is_active" | "business_name">, value: string): string {
  if (field === "email" || field === "preferred_contact_method") return headingKey(value);
  if (field === "phone") return normalizeVendorPhone(value).replace(/\D/g, "");
  if (field === "website") return normalizeUrl(value) || "";
  return headingKey(value);
}

/**
 * The later database adapter supplies only exact business-name candidates.
 * A supplied nonblank contact name, email, phone, website, description, or
 * preferred-contact method conflicts only when the canonical field is also
 * nonblank and its normalized value differs. Missing evidence never conflicts.
 */
export function classifyCanonicalVendorMatch(candidate: VendorImportCandidate, matches: CanonicalVendorMatch[]): CanonicalVendorMatchClassification {
  if (matches.length === 0) return { state: "needs_review", reason: "vendor_not_found" };
  if (matches.length > 1) return { state: "needs_review", reason: "vendor_identity_ambiguous" };
  const match = matches[0];
  if (!match.is_active) return { state: "needs_review", reason: "vendor_inactive" };
  const evidence = candidate.identity_evidence;
  const fields = ["contact_name", "email", "phone", "website", "business_description", "preferred_contact_method"] as const;
  const conflicting_fields = fields.filter((field) => {
    const supplied = evidence[field];
    const canonical = match[field];
    return !!supplied && !!canonical && normalizedSupportingEvidence(field, supplied) !== normalizedSupportingEvidence(field, canonical);
  });
  if (conflicting_fields.length) return { state: "needs_review", reason: "vendor_identity_conflict", conflicting_fields };
  return { state: "eligible", canonical_vendor_id: match.id };
}
