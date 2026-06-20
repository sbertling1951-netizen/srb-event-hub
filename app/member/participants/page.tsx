"use client";

import { useEffect, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import {
  getCurrentMemberEvent,
  getStoredMemberAttendeeId,
  getStoredMemberEmail,
  getStoredMemberEntryId,
} from "@/lib/getCurrentMemberEvent";
import { supabase } from "@/lib/supabase";

interface Participant {
  id: string;
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
  participant_capacity?: number | null;
}

function ParticipantsPageInner() {
  const [loading, setLoading] = useState(true);
  const [participantCount, setParticipantCount] = useState(0);
  const [capacity, setCapacity] = useState(0);
  const [participants, setParticipants] = useState<Participant[]>([]);

  const [emailInputs, setEmailInputs] = useState<Record<string, string>>({});
  const [savingParticipantId, setSavingParticipantId] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const currentEvent = getCurrentMemberEvent();

        if (!currentEvent?.id) {
          setParticipantCount(0);
          setCapacity(0);
          setParticipants([]);
          return;
        }

        const attendeeId = getStoredMemberAttendeeId();
        const entryId = getStoredMemberEntryId();
        const email = getStoredMemberEmail();

        const { data: attendeeRows } = await supabase
          .from("attendees")
          .select("id,entry_id,email,participant_capacity")
          .eq("event_id", currentEvent.id);

        const attendees = (attendeeRows || []) as AttendeeRow[];

        let attendee = attendees.find((a) => attendeeId && a.id === attendeeId);

        if (!attendee) {
          attendee = attendees.find((a) => entryId && a.entry_id === entryId);
        }

        if (!attendee) {
          attendee = attendees.find((a) => email && a.email === email);
        }

        if (!attendee) {
          setParticipantCount(0);
          setCapacity(0);
          setParticipants([]);
          return;
        }

        setCapacity(attendee.participant_capacity ?? 0);

        const { data: memberRows } = await supabase
          .from("attendee_household_members")
          .select(
            "id,person_role,first_name,last_name,display_name,email,participant_status,sort_order",
          )
          .eq("attendee_id", attendee.id)
          .order("sort_order", { ascending: true });

        setParticipants((memberRows || []) as Participant[]);
        setParticipantCount((memberRows || []).length);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const registeredParticipants = participants.filter(
    (p) => p.email && p.email.trim() !== "",
  ).length;

  const vacantSlots = Math.max(0, capacity - participantCount);

  const handleAddEmail = async (participantId: string) => {
    const email = (emailInputs[participantId] || "").trim();

    if (!email) {
      alert("Please enter an email address.");
      return;
    }

    try {
      setSavingParticipantId(participantId);

      const { error } = await supabase
        .from("attendee_household_members")
        .update({
          email,
          participant_status: "registered",
        })
        .eq("id", participantId);

      if (error) throw error;

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
        <p>
          Manage the people associated with your registration.
        </p>
      </div>

      <div className="card">
        <div className="app-section-title">Participant Accounts</div>

        <div className="app-card-section" style={{ textAlign: "center" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700 }}>
            {registeredParticipants} of {participantCount || capacity}
          </div>

          <div className="app-muted-text">
            Registered
          </div>
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
                participantCount > 0
                  ? (registeredParticipants / participantCount) * 100
                  : 0
              }%`,
              background:
                registeredParticipants === participantCount && participantCount > 0
                  ? "#22c55e"
                  : "#f59e0b",
              height: "100%",
            }}
          />
        </div>

        <div className="app-card-section" style={{ textAlign: "center" }}>
          {participantCount > 0 &&
          registeredParticipants === participantCount ? (
            <div className="font-medium text-green-700">
              ✓ All participant accounts registered
            </div>
          ) : (
            <div className="font-medium text-amber-700">
              {participantCount - registeredParticipants} participant Still needs an account.
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginTop: "0.75rem" }}>
          <div className="card" style={{ textAlign: "center" }}>
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Participants
            </div>
            <div className="text-2xl font-semibold">{participantCount}</div>
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
            <div
              key={participant.id}
              className="card"
            >
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
                    <span className="text-green-600">✓ Account Registered</span>
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
              {!participant.email && (
                <div className="app-card-section-muted" style={{ marginTop: "0.75rem" }}>
                  <div className="text-sm font-medium text-amber-800">
                    Add {participant.display_name || `${participant.first_name ?? ""} ${participant.last_name ?? ""}`.trim()}'s email to complete participant registration.
                  </div>

                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
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
                      onClick={() => handleAddEmail(participant.id)}
                    >
                      {savingParticipantId === participant.id ? "Saving..." : "Add Email"}
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
            <div
              key={`vacant-${index}`}
              className="card"
            >
              <div className="font-semibold">Additional Attendee</div>
              <div className="text-sm text-gray-500">
                Vacant participant slot
              </div>
            </div>
          ))}
        </>
      )}
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
