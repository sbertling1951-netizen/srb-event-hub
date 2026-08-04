"use client";

import { useEffect, useState } from "react";

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

  const [emailInputs, setEmailInputs] = useState<Record<string, string>>({});
  const [savingParticipantId, setSavingParticipantId] = useState<string | null>(
    null,
  );
  const [editingParticipantId, setEditingParticipantId] = useState<
    string | null
  >(null);
  const [showEditor, setShowEditor] = useState(false);

  // Refactored participant loading logic for reuse
  const loadParticipants = async () => {
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
  };

  useEffect(() => {
    if (!isReady || !event?.id || !attendeeId) {
      return;
    }

    loadParticipants();
  }, [attendeeId, event?.id, isReady]);

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

  const identifiedParticipants = participantCount;

  const handleSaveEmail = async (participantId: string) => {
    const email = (emailInputs[participantId] || "").trim();

    if (!email) {
      alert("Please enter an email address.");
      return;
    }

    try {
      setSavingParticipantId(participantId);

      const result = await supabase.rpc("update_participant_email", {
        p_participant_id: participantId,
        p_email: email,
      });

      console.log("PARTICIPANT UPDATE RESULT", result);
      console.log("PARTICIPANT ID", participantId);
      console.log("NEW EMAIL", email);

      if (result.error) {
        throw result.error;
      }

      setParticipants((current) =>
        current.map((p) =>
          p.id === participantId
            ? {
                ...p,
                email,
                participant_status: "registered",
              }
            : p,
        ),
      );

      setEmailInputs((current) => {
        const next = { ...current };
        delete next[participantId];
        return next;
      });

      setEditingParticipantId(null);
    } catch (err) {
      console.error(err);
      alert("Unable to save email. Please try again.");
    } finally {
      setSavingParticipantId(null);
    }
  };

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
                    <div>
                      <div className="text-green-600">✓ Account Registered</div>
                      <button
                        type="button"
                        className="app-link-button"
                        onClick={() => {
                          setEditingParticipantId(participant.id);
                          setEmailInputs((current) => ({
                            ...current,
                            [participant.id]: participant.email || "",
                          }));
                        }}
                      >
                        Edit Email
                      </button>
                    </div>
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
              {participant.email && editingParticipantId === participant.id && (
                <div
                  className="app-card-section-muted"
                  style={{ marginTop: "0.75rem" }}
                >
                  <div className="text-sm font-medium">
                    Update participant email address.
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      marginTop: "0.5rem",
                    }}
                  >
                    <input
                      type="email"
                      value={emailInputs[participant.id] || ""}
                      onChange={(e) =>
                        setEmailInputs((current) => ({
                          ...current,
                          [participant.id]: e.target.value,
                        }))
                      }
                      className="flex-1 rounded-md border px-3 py-2 text-sm"
                    />

                    <button
                      type="button"
                      className="app-button app-button-primary"
                      disabled={savingParticipantId === participant.id}
                      onClick={() => handleSaveEmail(participant.id)}
                    >
                      {savingParticipantId === participant.id
                        ? "Saving..."
                        : "Save"}
                    </button>
                  </div>
                </div>
              )}
              {!participant.email && (
                <div
                  className="app-card-section-muted"
                  style={{ marginTop: "0.75rem" }}
                >
                  <div className="text-sm font-medium text-amber-800">
                    Add{" "}
                    {participant.display_name ||
                      `${participant.first_name ?? ""} ${participant.last_name ?? ""}`.trim()}
                    's email to complete participant registration.
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      marginTop: "0.5rem",
                    }}
                  >
                    <input
                      type="email"
                      placeholder="Enter participant email"
                      value={emailInputs[participant.id] || ""}
                      onChange={(e) =>
                        setEmailInputs((current) => ({
                          ...current,
                          [participant.id]: e.target.value,
                        }))
                      }
                      className="flex-1 rounded-md border px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      className="app-button app-button-primary"
                      disabled={savingParticipantId === participant.id}
                      onClick={() => handleSaveEmail(participant.id)}
                    >
                      {savingParticipantId === participant.id
                        ? "Saving..."
                        : "Add Email"}
                    </button>
                  </div>

                  <div className="mt-2 text-xs text-amber-700">
                    Adding an email allows this participant to have their own
                    account, login, photo attribution, evaluations, and event
                    activity history.
                  </div>
                </div>
              )}
            </div>
          ))}

          {Array.from({ length: vacantSlots }).map((_, index) => (
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
                This participant position has been reserved but has not yet been
                assigned to a person.
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
        </>
      )}
      <ParticipantIdentityEditor
        open={showEditor}
        onClose={() => setShowEditor(false)}
        onSaved={loadParticipants}
        registrationId=""
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
