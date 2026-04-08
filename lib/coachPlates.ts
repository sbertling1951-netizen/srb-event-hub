import { chooseBadgeFirstName } from "@/lib/importNormalize";
import type { ParsedImportRow } from "@/lib/importMapping";

export type CoachPlateRow = {
  entryId: string;
  eventName: string;
  memberNumber: string;
  pilotDisplay: string;
  copilotDisplay: string;
  city: string;
  state: string;
  coachManufacturer: string;
  coachModel: string;
  coachLength: string;
  sortName: string;
};

export function buildCoachPlateRow(
  row: ParsedImportRow,
  eventName: string,
): CoachPlateRow {
  const pilotDisplay = `${chooseBadgeFirstName(
    row.pilotBadgeNickname,
    row.pilotFirst,
  )} ${row.pilotLast}`.trim();

  const copilotDisplay = row.copilotFirst
    ? `${chooseBadgeFirstName(
        row.copilotBadgeNickname,
        row.copilotFirst,
      )} ${row.copilotLast || row.pilotLast}`.trim()
    : "";

  return {
    entryId: row.entryId,
    eventName,
    memberNumber: row.membershipNumber,
    pilotDisplay,
    copilotDisplay,
    city: row.city,
    state: row.state,
    coachManufacturer: row.coachManufacturer,
    coachModel: row.coachModel,
    coachLength: row.coachLength,
    sortName: pilotDisplay,
  };
}

export function sortCoachPlates(
  rows: CoachPlateRow[],
  sortOrder: "az" | "za" = "az",
): CoachPlateRow[] {
  const copy = [...rows];

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
