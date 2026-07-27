const US_STATE_BY_NAME: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

const US_STATE_CODES = new Set(Object.values(US_STATE_BY_NAME));
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

type RateLimitEntry = {
  hits: number[];
};

const identityClaimRateLimitStore = new Map<string, RateLimitEntry>();

export type IdentityClaimInternalResult =
  | "UNIQUE_CANDIDATE"
  | "ADDITIONAL_EVIDENCE_REQUIRED"
  | "ADMIN_REVIEW_REQUIRED"
  | "NO_EXISTING_MATCH"
  | "INELIGIBLE"
  | "EXPIRED"
  | "ERROR";

export type IdentityClaimPublicResult =
  | "CONTINUE_VERIFICATION"
  | "REVIEW_REQUIRED"
  | "CREATE_NEW_ACCOUNT_AVAILABLE"
  | "UNABLE_TO_VERIFY";

export type IdentityClaimInput = {
  firstName: string;
  lastName: string;
  homeState: string | null;
  email: string | null;
  mobilePhone: string | null;
  membershipNumber: string | null;
  eventIds: string[];
};

export type NormalizedIdentityClaimInput = {
  firstName: string;
  lastName: string;
  homeState: string | null;
  email: string | null;
  mobilePhone: string | null;
  membershipNumber: string | null;
  eventIds: string[];
  evidenceCategories: string[];
  additionalEvidenceCount: number;
  strongEvidenceCount: number;
  supportingEvidenceCount: number;
  weakOnlyEvidence: boolean;
};

export type ParsedIdentityClaim =
  | { ok: true; value: NormalizedIdentityClaimInput }
  | { ok: false; error: string; field?: string };

export function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeNamePart(value: string) {
  return normalizeWhitespace(value).toLowerCase();
}

export function normalizeEmail(value: string | null | undefined) {
  const normalized = normalizeWhitespace(String(value || "")).toLowerCase();
  return normalized || null;
}

export function normalizePhone(value: string | null | undefined) {
  let digits = String(value || "").replace(/\D+/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }

  if (!digits) {
    return null;
  }

  return digits;
}

export function normalizeMembershipNumber(value: string | null | undefined) {
  const normalized = normalizeWhitespace(String(value || "")).toUpperCase();
  return normalized || null;
}

export function normalizeUsState(value: string | null | undefined) {
  const raw = normalizeWhitespace(String(value || ""));
  if (!raw) {
    return null;
  }

  const upper = raw.toUpperCase();
  if (US_STATE_CODES.has(upper)) {
    return upper;
  }

  return US_STATE_BY_NAME[raw.toLowerCase()] || null;
}

export function normalizeEventIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueEventIds = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const normalized = item.trim();
    if (UUID_RE.test(normalized)) {
      uniqueEventIds.add(normalized);
    }
  }

  return Array.from(uniqueEventIds);
}

export function mapInternalClaimResultToPublicResult(
  result: IdentityClaimInternalResult,
): IdentityClaimPublicResult {
  switch (result) {
    case "UNIQUE_CANDIDATE":
    case "ADDITIONAL_EVIDENCE_REQUIRED":
      return "CONTINUE_VERIFICATION";
    case "ADMIN_REVIEW_REQUIRED":
      return "REVIEW_REQUIRED";
    case "NO_EXISTING_MATCH":
      return "CREATE_NEW_ACCOUNT_AVAILABLE";
    case "INELIGIBLE":
    case "EXPIRED":
    case "ERROR":
    default:
      return "UNABLE_TO_VERIFY";
  }
}

export function getIdentityClaimPublicMessage(
  result: IdentityClaimPublicResult,
) {
  switch (result) {
    case "CONTINUE_VERIFICATION":
      return "We found enough information to continue securely. No account changes have been made yet.";
    case "REVIEW_REQUIRED":
      return "We need an additional verification step before connecting prior records. No account changes have been made.";
    case "CREATE_NEW_ACCOUNT_AVAILABLE":
      return "We could not confirm an existing account from the information provided. You may continue with new-account registration in a later activation step.";
    case "UNABLE_TO_VERIFY":
    default:
      return "We could not verify the information safely. Check your entries or contact identity support.";
  }
}

export function parseIdentityClaimInput(raw: unknown): ParsedIdentityClaim {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Invalid request body." };
  }

  const body = raw as Record<string, unknown>;

  const firstName = normalizeNamePart(String(body.firstName || ""));
  const lastName = normalizeNamePart(String(body.lastName || ""));
  const homeState = normalizeUsState(
    body.homeState as string | null | undefined,
  );
  const email = normalizeEmail(body.email as string | null | undefined);
  const mobilePhone = normalizePhone(
    body.mobilePhone as string | null | undefined,
  );
  const membershipNumber = normalizeMembershipNumber(
    body.membershipNumber as string | null | undefined,
  );
  const eventIds = normalizeEventIds(body.eventIds);

  if (!firstName) {
    return {
      ok: false,
      error: "First name is required.",
      field: "firstName",
    };
  }

  if (!lastName) {
    return {
      ok: false,
      error: "Last name is required.",
      field: "lastName",
    };
  }

  const evidenceCategories = [
    email ? "email" : null,
    mobilePhone ? "phone" : null,
    membershipNumber ? "membership_number" : null,
    homeState ? "state" : null,
    eventIds.length > 0 ? "event_history" : null,
  ].filter((value): value is string => !!value);

  const strongEvidenceCount = [email, mobilePhone, membershipNumber].filter(
    Boolean,
  ).length;
  const supportingEvidenceCount = [
    homeState,
    eventIds.length > 0 ? "1" : null,
  ].filter(Boolean).length;
  const additionalEvidenceCount = evidenceCategories.length;
  const weakOnlyEvidence =
    strongEvidenceCount === 0 &&
    supportingEvidenceCount === additionalEvidenceCount;

  if (additionalEvidenceCount === 0) {
    return {
      ok: false,
      error: "Provide at least one additional fact besides your name.",
    };
  }

  return {
    ok: true,
    value: {
      firstName,
      lastName,
      homeState,
      email,
      mobilePhone,
      membershipNumber,
      eventIds,
      evidenceCategories,
      additionalEvidenceCount,
      strongEvidenceCount,
      supportingEvidenceCount,
      weakOnlyEvidence,
    },
  };
}

export function takeIdentityClaimRateLimitSlot(key: string, now = Date.now()) {
  const normalizedKey = key.trim() || "anonymous";
  const existing = identityClaimRateLimitStore.get(normalizedKey) || {
    hits: [],
  };

  existing.hits = existing.hits.filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );

  if (existing.hits.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    identityClaimRateLimitStore.set(normalizedKey, existing);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((RATE_LIMIT_WINDOW_MS - (now - existing.hits[0])) / 1000),
      ),
    };
  }

  existing.hits.push(now);
  identityClaimRateLimitStore.set(normalizedKey, existing);

  return {
    allowed: true,
    retryAfterSeconds: 0,
  };
}
