export type SimpleHouseholdMember = {
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  display_name?: string | null;
  raw_text?: string | null;
  age_text?: string | null;
};

export function fullName(first?: string | null, last?: string | null) {
  return [first, last].filter(Boolean).join(" ").trim();
}

export function preferredDisplayName(member: SimpleHouseholdMember) {
  if (member.display_name?.trim()) return member.display_name.trim();

  const nicknameLead = [member.nickname, member.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (nicknameLead) return nicknameLead;

  const legalName = fullName(member.first_name, member.last_name);
  if (legalName) return legalName;

  if (member.raw_text?.trim()) return member.raw_text.trim();

  return "Unnamed";
}

export function preferredDisplayLine(member: SimpleHouseholdMember) {
  const lead = preferredDisplayName(member);
  return member.age_text ? `${lead} (${member.age_text})` : lead;
}
