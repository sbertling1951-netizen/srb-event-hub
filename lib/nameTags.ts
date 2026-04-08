import {
  chooseBadgeFirstName,
  parseAdditionalAttendees,
  splitFullName,
  toTitleCase,
} from "@/lib/importNormalize";
import type { ParsedImportRow } from "@/lib/importMapping";

export type NameTagPerson = {
  entryId: string;
  memberNumber: string;
  eventName: string;
  displayFirst: string;
  lastName: string;
  city: string;
  state: string;
  firstTimer: boolean;
  personType: "pilot" | "copilot" | "additional";
  sortName: string;
};

export function buildNameTagPeople(
  row: ParsedImportRow,
  eventName: string,
): NameTagPerson[] {
  const people: NameTagPerson[] = [];

  if (row.pilotFirst || row.pilotLast) {
    const displayFirst = chooseBadgeFirstName(
      row.pilotBadgeNickname,
      row.pilotFirst,
    );
    const lastName = toTitleCase(row.pilotLast);

    people.push({
      entryId: row.entryId,
      memberNumber: row.membershipNumber,
      eventName,
      displayFirst,
      lastName,
      city: row.city,
      state: row.state,
      firstTimer: row.firstTimeEvent,
      personType: "pilot",
      sortName: `${lastName}, ${displayFirst}`.trim(),
    });
  }

  if (row.copilotFirst || row.copilotLast) {
    const displayFirst = chooseBadgeFirstName(
      row.copilotBadgeNickname,
      row.copilotFirst,
    );
    const lastName = toTitleCase(row.copilotLast || row.pilotLast);

    people.push({
      entryId: row.entryId,
      memberNumber: row.membershipNumber,
      eventName,
      displayFirst,
      lastName,
      city: row.city,
      state: row.state,
      firstTimer: row.firstTimeEvent,
      personType: "copilot",
      sortName: `${lastName}, ${displayFirst}`.trim(),
    });
  }

  const extras = parseAdditionalAttendees(row.additionalAttendees);

  for (const extra of extras) {
    const split = splitFullName(extra);
    const displayFirst = split.first;
    const lastName = split.last || row.pilotLast;

    people.push({
      entryId: row.entryId,
      memberNumber: row.membershipNumber,
      eventName,
      displayFirst,
      lastName: toTitleCase(lastName),
      city: row.city,
      state: row.state,
      firstTimer: row.firstTimeEvent,
      personType: "additional",
      sortName: `${toTitleCase(lastName)}, ${displayFirst}`.trim(),
    });
  }

  return people;
}

export function sortNameTags(
  people: NameTagPerson[],
  sortOrder: "az" | "za" = "az",
): NameTagPerson[] {
  const copy = [...people];

  copy.sort((a, b) =>
    a.sortName.localeCompare(b.sortName, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );

  if (sortOrder === "za") {
    copy.reverse();
  }

  return copy;
}
