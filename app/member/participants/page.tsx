"use client";

import { useEffect, useState } from "react";
import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { supabase } from "@/lib/supabase";
import { getCurrentMemberEvent, getStoredMemberAttendeeId, getStoredMemberEmail, getStoredMemberEntryId } from "@/lib/getCurrentMemberEvent";

interface Participant {
  id: string;
  person_role: string;
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
          .select("id,person_role,first_name,last_name,display_name,email,participant_status,sort_order")
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
    (p) => p.email && p.email.trim() !== ""
  ).length;

  const vacantSlots = Math.max(0, capacity - participantCount);

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Participants</h1>
        <p className="text-sm text-gray-500">
          Manage the people associated with your registration.
        </p>
      </div>

      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">
              Registration Progress
            </div>
            <div className="text-sm text-gray-500">
              Track participant identification for this registration.
            </div>
          </div>

          <div className="text-right">
            <div className="text-2xl font-bold text-blue-600">
              {registeredParticipants}/{participantCount || capacity}
            </div>
            <div className="text-xs text-gray-500">
              Digital Identities
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="font-medium">Participant Accounts Registered</span>
            <span>
              {registeredParticipants} of {participantCount}
            </span>
          </div>

          <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-green-500 transition-all"
              style={{
                width: `${participantCount > 0
                  ? (registeredParticipants / participantCount) * 100
                  : 0}%`,
              }}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border bg-gray-50 p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Participants
            </div>
            <div className="text-xl font-semibold">
              {participantCount}
            </div>
          </div>

          <div className="rounded-lg border bg-gray-50 p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Accounts Registered
            </div>
            <div className="text-xl font-semibold text-green-600">
              {registeredParticipants}
            </div>
          </div>

          <div className="rounded-lg border bg-gray-50 p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Open Slots
            </div>
            <div className="text-xl font-semibold text-blue-600">
              {Math.max(0, capacity - participantCount)}
            </div>
          </div>
        </div>

        {capacity > participantCount && (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
            You still have {capacity - participantCount} participant slot{capacity - participantCount === 1 ? '' : 's'} available.
          </div>
        )}
      </div>

      {loading ? (
        <div className="rounded-lg border p-4">Loading...</div>
      ) : (
        <>
          {participants.map((participant) => (
            <div
              key={participant.id}
              className="rounded-lg border p-4 bg-white"
            >
              <div className="flex items-center justify-between">
                <div className="font-semibold">
                  {participant.person_role === "pilot"
                    ? "Pilot"
                    : participant.person_role === "copilot"
                      ? "Co-Pilot"
                      : "Additional Attendee"}
                </div>

                <div className="text-sm">
                  {participant.email ? (
                    <span className="text-green-600">
                      ✓ Account Registered
                    </span>
                  ) : (
                    <span className="text-amber-600">
                      ⚠ Uses Registration Account
                    </span>
                  )}
                </div>
              </div>
              <div>
                {participant.display_name ||
                  `${participant.first_name ?? ""} ${participant.last_name ?? ""}`.trim()}
              </div>
              {participant.email && (
                <div className="text-sm text-gray-500">
                  {participant.email}
                </div>
              )}
              {!participant.email && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="text-sm font-medium text-amber-800">
                    Email needed to register this participant.
                  </div>

                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      type="email"
                      placeholder="Enter participant email"
                      className="flex-1 rounded-md border px-3 py-2 text-sm"
                    />

                    <button
                      type="button"
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      Add Email
                    </button>
                  </div>

                  <div className="mt-2 text-xs text-amber-700">
                    Adding an email allows this participant to have their own account, login, photo attribution, evaluations, and event activity history.
                  </div>
                </div>
              )}
            </div>
          ))}

          {Array.from({ length: vacantSlots }).map((_, index) => (
            <div
              key={`vacant-${index}`}
              className="rounded-lg border-2 border-dashed p-4"
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
