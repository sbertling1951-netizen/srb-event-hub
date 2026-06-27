"use client";

import { useEffect, useState } from "react";
import {
  createParticipantIdentity,
  saveParticipantIdentity,
} from "@/lib/participants/participantIdentity";

export type ParticipantIdentityEditorProps = {
  open: boolean;
  onClose: () => void;
  registrationId: string;
  attendeeId: string;
  eventId: string;
  sortOrder: number;
  participantId?: string;
  slotRole: "pilot" | "copilot" | "additional";
  participant?: ParticipantIdentity;
  onSaved?: () => void;
};

export type ParticipantIdentity = {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string;
  email: string;
  cellPhone: string;
};

export default function ParticipantIdentityEditor({
  open,
  onClose,
  registrationId,
  attendeeId,
  eventId,
  sortOrder,
  slotRole,
  participant,
  onSaved,
}: ParticipantIdentityEditorProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [cellPhone, setCellPhone] = useState("");

  useEffect(() => {
    if (!participant) return;

    setFirstName(participant.firstName ?? "");
    setLastName(participant.lastName ?? "");
    setNickname(participant.nickname ?? "");
    setEmail(participant.email ?? "");
    setCellPhone(participant.cellPhone ?? "");
  }, [participant]);

  async function handleSave() {
    try {
      if (participant) {
        await saveParticipantIdentity({
          id: participant.id,
          firstName,
          lastName,
          nickname,
          email,
          cellPhone,
        });
      } else {
        await createParticipantIdentity({
          attendeeId,
          eventId,
          personRole: slotRole,
          sortOrder,
          firstName,
          lastName,
          nickname,
          email,
          cellPhone,
        });
      }
      onSaved?.();
      onClose();
    } catch (error) {
      console.error("Participant save failed:", error);
      if (error && typeof error === "object" && "message" in error) {
        alert((error as any).message);
      } else {
        alert("Participant save failed. See browser console for details.");
      }
    }
  }

  if (!open) return null;

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3000,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: "100%", maxWidth: 650, padding: 20 }}
      >
        <h2 style={{ marginTop: 0 }}>Participant Information</h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16 }}>
          <div>
            <label>First Name</label>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label>Last Name</label>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label>Nickname</label>
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label>Cell Phone</label>
            <input value={cellPhone} onChange={(e) => setCellPhone(e.target.value)} style={{ width: "100%" }} />
          </div>
        </div>

        <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="app-button app-button-primary"
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
