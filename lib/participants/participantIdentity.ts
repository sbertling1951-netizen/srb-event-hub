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
  const { data, error } = await supabase
    .from("attendee_household_members")
    .select("*")
    .eq("id", participantId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    firstName: data.first_name ?? "",
    lastName: data.last_name ?? "",
    nickname: data.nickname ?? "",
    email: data.email ?? "",
    cellPhone: data.cell_phone ?? "",
  } as ParticipantIdentityRecord;
}

export async function saveParticipantIdentity(
  participant: ParticipantIdentityRecord,
) {
  const { data, error } = await supabase.rpc("save_participant_identity", {
    p_participant_id: participant.id,
    p_first_name: participant.firstName,
    p_last_name: participant.lastName,
    p_nickname: participant.nickname,
    p_email: participant.email,
    p_cell_phone: participant.cellPhone,
  });
  if (error) {
    throw error;
  }
  return data;
}

export async function createParticipantIdentity({
  attendeeId,
  eventId,
  personRole,
  sortOrder,
  firstName,
  lastName,
  nickname,
  email,
  cellPhone,
}: {
  attendeeId: string;
  eventId: string;
  personRole: string;
  sortOrder: number;
  firstName: string;
  lastName: string;
  nickname: string;
  email: string;
  cellPhone: string;
}) {
  const { data, error } = await supabase.rpc("save_participant_identity", {
    p_participant_id: null,
    p_attendee_id: attendeeId,
    p_event_id: eventId,
    p_person_role: personRole,
    p_sort_order: sortOrder,
    p_first_name: firstName,
    p_last_name: lastName,
    p_nickname: nickname,
    p_email: email,
    p_cell_phone: cellPhone,
  });
  if (error) {
    throw error;
  }
  return data;
}
