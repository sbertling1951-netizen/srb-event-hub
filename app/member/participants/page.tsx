"use client";

import { useCallback, useEffect, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import ParticipantIdentityEditor from "@/components/participants/ParticipantIdentityEditor";
import { logEngagement } from "@/lib/engagement";
import { useMemberWorkspace } from "@/lib/memberWorkspace/useMemberWorkspace";
import { supabase } from "@/lib/supabase";

type AttendeeRecordRpcRow = {
  id: string;
  entry_id: string | null;
  email: string | null;
  auth_user_id: string | null;
  event_id: string;
  participant_capacity: number | null;
};

interface Participant {
  id: string;
  attendee_id: string;
  person_role: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  email: string | null;
  participant_status: string | null;
  sort_order?: number | null;
}

interface AttendeeRow {
  id: string;
  entry_id?: string | null;
  email?: string | null;
  auth_user_id?: string | null;
  event_id: string;
  participant_capacity?: number | null;
}

function ParticipantsPageInner() {
  const { event, attendeeId, isReady, session } = useMemberWorkspace();
  const [loading, setLoading] = useState(true);
  const [participantCount, setParticipantCount] = useState(0);
  const [capacity, setCapacity] = useState(0);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentAttendee, setCurrentAttendee] = useState<AttendeeRow | null>(
    null,
  );
  const [canMutateParticipantIdentity, setCanMutateParticipantIdentity] =
    useState(false);
  const [showEditor, setShowEditor] = useState(false);

  const loadParticipants = useCallback(async () => {
    try {
      if (!isReady || !event?.id || !attendeeId) {
        setParticipantCount(0);
        setCapacity(0);
        setParticipants([]);
        return;
      }

      const rpcArgs = {
        p_event_id: event.id,
        p_event_code: session?.event_code || null,
        p_registration_identifier:
          session?.attendee_email || session?.attendee_phone || null,
      };

      const { data: recordData, error: recordError } = await supabase.rpc(
        "get_my_attendee_record",
        rpcArgs,
      );

      const record = (
        Array.isArray(recordData) ? recordData[0] : null
      ) as AttendeeRecordRpcRow | null;

      if (recordError || !record) {
        setParticipantCount(0);
        setCapacity(0);
        setParticipants([]);
        return;
      }

      const attendee: AttendeeRow = {
        id: record.id,
        entry_id: record.entry_id,
        email: record.email,
        auth_user_id: record.auth_user_id,
        event_id: record.event_id,
        participant_capacity: record.participant_capacity,
      };

      setCurrentAttendee(attendee);

      setCapacity(attendee.participant_capacity ?? 0);

      const { data: memberRows } = await supabase.rpc(
        "get_my_household_members",
        rpcArgs,
      );

      const loadedParticipants = (memberRows || []) as Participant[];

      setParticipants(loadedParticipants);
      setParticipantCount(loadedParticipants.length);
    } finally {
      setLoading(false);
    }
  }, [
    attendeeId,
    event?.id,
    isReady,
    session?.attendee_email,
    session?.attendee_phone,
    session?.event_code,
  ]);

  useEffect(() => {
    void loadParticipants();
  }, [loadParticipants]);

  useEffect(() => {
    let mounted = true;

    async function resolveAuthenticatedAccess() {
      const { data } = await supabase.auth.getSession();
      if (mounted) {
        setCanMutateParticipantIdentity(Boolean(data.session));
      }
    }

    void resolveAuthenticatedAccess();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!currentAttendee?.event_id) {
      return;
    }

    const storedAttendeeId = localStorage.getItem("fcoc-member-attendee-id");
    if (!storedAttendeeId) {
      return;
    }

    void logEngagement({
      eventId: currentAttendee.event_id,
      attendeeId: storedAttendeeId,
      activityType: "participants_view",
    });
  }, [currentAttendee?.event_id]);

  const registeredParticipants = participants.filter(
    (p) => p.email && p.email.trim() !== "",
  ).length;

  const vacantSlots = Math.max(0, capacity - participantCount);

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div>
        <h1>Participants</h1>{" "}
        <p>Manage the people associated with your registration.</p>
      </div>

      <div className="card">
        <div className="app-section-title">Participant Accounts</div>

        <div className="app-card-section" style={{ textAlign: "center" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700 }}>
            {registeredParticipants} of {capacity}
          </div>

          <div className="app-muted-text">Registered</div>
        </div>

        <div
          style={{
            marginTop: "1rem",
            background: "#e5e7eb",
            borderRadius: "999px",
            height: "12px",
            overflow: "hidden",
          }}
        >
          <div
            className=""
            style={{
              width: `${
                capacity > 0 ? (registeredParticipants / capacity) * 100 : 0
              }%`,
              background:
                registeredParticipants === capacity && capacity > 0
                  ? "#22c55e"
                  : "#f59e0b",
              height: "100%",
            }}
          />
        </div>

        <div className="app-card-section" style={{ textAlign: "center" }}>
          {capacity > 0 && registeredParticipants === capacity ? (
            <div className="font-medium text-green-700">
              ✓ All participant accounts registered
            </div>
          ) : (
            <div className="font-medium text-amber-700">
              {Math.max(0, capacity - registeredParticipants)} participant Still
              needs an account.
            </div>
          )}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "0.75rem",
            marginTop: "0.75rem",
          }}
        >
          <div className="card" style={{ textAlign: "center" }}>
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Participants
            </div>
            <div className="text-2xl font-semibold">{capacity}</div>
          </div>

          <div className="card" style={{ textAlign: "center" }}>
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Registered
            </div>
            <div className="text-2xl font-semibold text-green-600">
              {registeredParticipants}
            </div>
          </div>

          <div className="card" style={{ textAlign: "center" }}>
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Available Invitations
            </div>
            <div className="text-2xl font-semibold text-blue-600">
              {vacantSlots}
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border p-4">Loading...</div>
      ) : (
        <>
          {participants.map((participant) => (
            <div key={participant.id} className="card">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 220px",
                  gap: "1rem",
                  alignItems: "center",
                }}
              >
                <div className="font-semibold">
                  {participant.person_role === "pilot"
                    ? "Pilot"
                    : participant.person_role === "copilot"
                      ? "Co-Pilot"
                      : "Additional Attendee"}
                </div>

                <div style={{ textAlign: "right", fontWeight: 600 }}>
                  {participant.email ? (
                    <div className="text-green-600">✓ Account Registered</div>
                  ) : (
                    <span className="text-amber-600">
                      ⚠ Currently Using Registration Account
                    </span>
                  )}
                </div>
              </div>
              <div>
                {participant.display_name ||
                  `${participant.first_name ?? ""} ${participant.last_name ?? ""}`.trim()}
              </div>
              {participant.email && (
                <div className="text-sm text-gray-500">{participant.email}</div>
              )}
            </div>
          ))}

          {canMutateParticipantIdentity &&
            Array.from({ length: vacantSlots }).map((_, index) => (
              <div key={`vacant-${index}`} className="card">
                <div className="font-semibold">Additional Attendee</div>

                <div
                  className="text-amber-700 font-medium"
                  style={{ marginTop: "0.5rem" }}
                >
                  Participant Not Yet Identified
                </div>

                <div
                  className="text-sm text-gray-500"
                  style={{ marginTop: "0.25rem" }}
                >
                  This participant position has been reserved but has not yet
                  been assigned to a person.
                </div>

                <div
                  className="app-card-section-muted"
                  style={{ marginTop: "0.75rem", textAlign: "center" }}
                >
                  <button
                    type="button"
                    className="app-button app-button-primary"
                    onClick={() => setShowEditor(true)}
                  >
                    + Add Participant
                  </button>
                </div>
              </div>
            ))}

          {!canMutateParticipantIdentity && (
            <div className="card app-card-section-muted">
              Participant identity changes require a signed-in account or
              assistance from event administration.
            </div>
          )}
        </>
      )}
      <ParticipantIdentityEditor
        open={showEditor}
        onClose={() => setShowEditor(false)}
        onSaved={loadParticipants}
        attendeeId={currentAttendee?.id ?? ""}
        eventId={currentAttendee?.event_id ?? ""}
        sortOrder={participants.length + 1}
        slotRole="additional"
      />
    </div>
  );
}

export default function ParticipantsPage() {
  return (
    <MemberRouteGuard>
      <ParticipantsPageInner />
    </MemberRouteGuard>
  );
}
