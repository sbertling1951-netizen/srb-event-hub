import {
  cleanValue,
  normalizeBoolean,
  normalizeEmail,
  normalizeMemberNumber,
  normalizeState,
  toTitleCase,
} from "@/lib/importNormalize";

export type ParsedImportRow = {
  membershipNumber: string;
  pilotPrefix: string;
  pilotFirst: string;
  pilotMiddle: string;
  pilotLast: string;
  pilotSuffix: string;
  pilotBadgeNickname: string;

  copilotPrefix: string;
  copilotFirst: string;
  copilotMiddle: string;
  copilotLast: string;
  copilotSuffix: string;
  copilotBadgeNickname: string;

  additionalAttendees: string;

  streetAddress: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;

  primaryPhone: string;
  cellPhone: string;
  email: string;
  shareEmail: boolean;
  handicapParking: boolean;
  firstTimeEvent: boolean;
  volunteer: boolean;

  specialEvents: string;
  coachManufacturer: string;
  coachModel: string;
  coachLength: string;
  eventRegistration: string;

  productName: string;
  productPrice: string;
  productQuantity: string;

  rmEmail: string;
  createdByUserId: string;
  entryId: string;
  entryDate: string;
  dateUpdated: string;
  sourceUrl: string;
  transactionId: string;
  paymentAmount: string;
  paymentDate: string;
  paymentStatus: string;
  postId: string;
};

export function mapImportRow(row: unknown[]): ParsedImportRow {
  const cells = row.map((value) => cleanValue(value));

  return {
    membershipNumber: normalizeMemberNumber(cells[0]),

    pilotPrefix: toTitleCase(cells[1]),
    pilotFirst: toTitleCase(cells[2]),
    pilotMiddle: toTitleCase(cells[3]),
    pilotLast: toTitleCase(cells[4]),
    pilotSuffix: toTitleCase(cells[5]),
    pilotBadgeNickname: toTitleCase(cells[6]),

    copilotPrefix: toTitleCase(cells[8]),
    copilotFirst: toTitleCase(cells[9]),
    copilotMiddle: toTitleCase(cells[10]),
    copilotLast: toTitleCase(cells[11]),
    copilotSuffix: toTitleCase(cells[12]),
    copilotBadgeNickname: toTitleCase(cells[13]),

    additionalAttendees: cleanValue(cells[15]),

    streetAddress: cleanValue(cells[16]),
    addressLine2: cleanValue(cells[17]),
    city: toTitleCase(cells[18]),
    state: normalizeState(cells[19]),
    postalCode: cleanValue(cells[20]),
    country: toTitleCase(cells[21]),

    primaryPhone: cleanValue(cells[22]),
    cellPhone: cleanValue(cells[23]),
    email: normalizeEmail(cells[24]),
    shareEmail: normalizeBoolean(cells[25]),
    handicapParking: normalizeBoolean(cells[26]),
    firstTimeEvent: normalizeBoolean(cells[27]),
    volunteer: normalizeBoolean(cells[28]),

    specialEvents: cleanValue(cells[29]),
    coachManufacturer: toTitleCase(cells[30]),
    coachModel: cleanValue(cells[31]),
    coachLength: cleanValue(cells[32]),
    eventRegistration: cleanValue(cells[33]),

    productName: cleanValue(cells[34]),
    productPrice: cleanValue(cells[35]),
    productQuantity: cleanValue(cells[36]),

    rmEmail: normalizeEmail(cells[42]),
    createdByUserId: cleanValue(cells[43]),
    entryId: cleanValue(cells[44]),
    entryDate: cleanValue(cells[45]),
    dateUpdated: cleanValue(cells[46]),
    sourceUrl: cleanValue(cells[47]),
    transactionId: cleanValue(cells[48]),
    paymentAmount: cleanValue(cells[49]),
    paymentDate: cleanValue(cells[50]),
    paymentStatus: cleanValue(cells[51]),
    postId: cleanValue(cells[52]),
  };
}
