

import { supabase } from "@/lib/supabase";

export type ParticipantIdentityRecord = {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string;
  email: string;
  cellPhone: string;
};

export async function loadParticipantIdentity(participantId: string) {
  // TODO: Load from attendee_household_members.
  throw new Error("loadParticipantIdentity not implemented yet.");
}

export async function saveParticipantIdentity(
  participant: ParticipantIdentityRecord,
) {
  // TODO: Save to attendee_household_members.
  throw new Error("saveParticipantIdentity not implemented yet.");
}
