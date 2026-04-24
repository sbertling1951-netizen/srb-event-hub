export function cleanValue(value: unknown): string {
  if (value === null || value === undefined) {return "";}
  return String(value).replace(/\s+/g, " ").trim();
}

export function normalizeWhitespace(value: string | null | undefined): string {
  return cleanValue(value);
}

export function toTitleCase(value: string | null | undefined): string {
  const cleaned = cleanValue(value);
  if (!cleaned) {return "";}

  return cleaned
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => {
      if (part.includes("-")) {
        return part
          .split("-")
          .map((piece) =>
            piece ? piece.charAt(0).toUpperCase() + piece.slice(1) : "",
          )
          .join("-");
      }

      if (part.includes("'")) {
        return part
          .split("'")
          .map((piece) =>
            piece ? piece.charAt(0).toUpperCase() + piece.slice(1) : "",
          )
          .join("'");
      }

      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

export function normalizeMemberNumber(
  value: string | null | undefined,
): string {
  return cleanValue(value).toUpperCase();
}

export function normalizeEmail(value: string | null | undefined): string {
  return cleanValue(value).toLowerCase();
}

export function normalizeBoolean(value: string | null | undefined): boolean {
  const v = cleanValue(value).toLowerCase();

  return ["y", "yes", "true", "1", "checked", "on"].includes(v);
}

const STATE_MAP: Record<string, string> = {
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
  alberta: "AB",
  "british columbia": "BC",
  manitoba: "MB",
  "new brunswick": "NB",
  "newfoundland and labrador": "NL",
  "nova scotia": "NS",
  ontario: "ON",
  "prince edward island": "PE",
  quebec: "QC",
  saskatchewan: "SK",
};

export function normalizeState(value: string | null | undefined): string {
  const cleaned = cleanValue(value);
  if (!cleaned) {return "";}

  if (cleaned.length === 2) {
    return cleaned.toUpperCase();
  }

  const mapped = STATE_MAP[cleaned.toLowerCase()];
  return mapped || toTitleCase(cleaned);
}

export function chooseBadgeFirstName(
  nickname: string | null | undefined,
  legalFirst: string | null | undefined,
): string {
  const nick = cleanValue(nickname);
  if (nick) {return toTitleCase(nick);}
  return toTitleCase(legalFirst);
}

export function stripAgeText(value: string): string {
  return value
    .replace(/\(\s*\d{1,3}\s*\)/g, "")
    .replace(/\bage\s*[:\-]?\s*\d{1,3}\b/gi, "")
    .replace(/\b\d{1,3}\s*(yo|yrs?|years?\s*old)?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseAdditionalAttendees(
  raw: string | null | undefined,
): string[] {
  const cleaned = cleanValue(raw);
  if (!cleaned) {return [];}

  return cleaned
    .replace(/\band\b/gi, ",")
    .replace(/&/g, ",")
    .replace(/\//g, ",")
    .replace(/;/g, ",")
    .split(",")
    .map((part) => stripAgeText(part))
    .map((part) => cleanValue(part))
    .filter(Boolean)
    .map((part) => toTitleCase(part));
}

export function splitFullName(fullName: string): {
  first: string;
  last: string;
} {
  const cleaned = toTitleCase(fullName);
  if (!cleaned) {return { first: "", last: "" };}

  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length === 1) {
    return { first: parts[0], last: "" };
  }

  return {
    first: parts[0],
    last: parts.slice(1).join(" "),
  };
}
