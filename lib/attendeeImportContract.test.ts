import assert from "node:assert/strict"; import { test } from "node:test";
import { classifyExternalDedupeEvidence, classifyFileAmbiguities, FIELD_ALIASES, interpretAttendeeImportRow, PREFERRED_ATTENDEE_HEADINGS } from "./attendeeImportContract.ts";
const row={"Entry ID":"E1","Email":"A@EXAMPLE.COM","Pilot First":"Ada","Pilot Last":"Lovelace","Co-Pilot Email":"COPILOT@EXAMPLE.COM","Co-Pilot Cell Phone":"(555) 123-4567","Party Size":"2","Additional Attendees":"Pat, 7","Dinner (Name)":"Dinner","Dinner (Price)":"$10","Dinner (Quantity)":"1","Volunteer":"yes"};
test("normalizes historical aliases, preferred copilot headings, capacity evidence, and reference-only additions", async()=>{const r=interpretAttendeeImportRow(row,2); assert.equal(r.validation_state,"valid"); assert.equal(r.candidate.registration.email,"a@example.com"); assert.equal(r.candidate.copilot.email,"copilot@example.com"); assert.equal(r.candidate.capacity_evidence.structured_participant_minimum,1); assert.equal(r.candidate.reference_only.additional_attendees,"Pat, 7"); assert.equal(r.candidate.activities.length,1); assert.ok((await r.fingerprint).startsWith("sha256:"));});
test("required evidence, malformed values, and invalid capacity fail structurally",()=>{const r=interpretAttendeeImportRow({"Entry ID":"",Email:"bad", "Party Size":"0", "Pilot First":"", "Phone":"123", Volunteer:"maybe"},2); assert.equal(r.validation_state,"validation_failed"); assert.ok(r.issues.some(i=>i.code==="missing_entry_id")); assert.ok(r.issues.some(i=>i.code==="malformed_email")); assert.ok(r.issues.some(i=>i.code==="invalid_capacity"));});
test("fingerprint is semantic and deterministic",async()=>{const a=interpretAttendeeImportRow(row,2),b=interpretAttendeeImportRow({Email:"a@example.com","Pilot Last":"Lovelace","Pilot First":"Ada","Entry Id":"E1","Party Size":"2","Dinner (Quantity)":"1","Dinner (Price)":"$10","Dinner (Name)":"Dinner","Additional Attendees":"Pat, 7","Volunteer":"YES","Co-Pilot Email":"copilot@example.com","Co-Pilot Cell Phone":"5551234567"},2); assert.equal(await a.fingerprint,await b.fingerprint); const changed=interpretAttendeeImportRow({...row,"Party Size":"3"},2); assert.notEqual(await a.fingerprint,await changed.fingerprint);});
test("file and external ambiguity are surfaced rather than resolved",()=>{const a=interpretAttendeeImportRow(row,2),b=interpretAttendeeImportRow({...row,"Entry ID":"E2"},3); assert.equal(classifyFileAmbiguities([a,b])[0].state,"needs_review"); assert.equal(classifyExternalDedupeEvidence("A","B"),"needs_review");});

// Stage 5A: every heading a downloadable template advertises as
// "preferred" must actually be accepted by this same parser -- the
// template contract (lib/importTemplateContract.ts) is derived from
// PREFERRED_ATTENDEE_HEADINGS/FIELD_ALIASES, not hand-typed, but this
// proves the source data itself is internally consistent.
test("every preferred heading is a case-insensitively accepted alias for its own field, and every field has a preferred heading", () => {
  const normalize = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
  for (const key of Object.keys(FIELD_ALIASES) as (keyof typeof FIELD_ALIASES)[]) {
    assert.ok(key in PREFERRED_ATTENDEE_HEADINGS, `missing preferred heading for ${key}`);
    const preferred = PREFERRED_ATTENDEE_HEADINGS[key as keyof typeof PREFERRED_ATTENDEE_HEADINGS];
    const aliases = FIELD_ALIASES[key].map(normalize);
    assert.ok(aliases.includes(normalize(preferred)), `preferred heading "${preferred}" for ${key} is not an accepted alias`);
  }
  assert.equal(Object.keys(PREFERRED_ATTENDEE_HEADINGS).length, Object.keys(FIELD_ALIASES).length);
});

test("a row built entirely from preferred headings parses identically to the historical-alias row", async () => {
  const preferredRow = {
    [PREFERRED_ATTENDEE_HEADINGS.entry_id]: "E1", [PREFERRED_ATTENDEE_HEADINGS.email]: "A@EXAMPLE.COM",
    [PREFERRED_ATTENDEE_HEADINGS.pilot_first]: "Ada", [PREFERRED_ATTENDEE_HEADINGS.pilot_last]: "Lovelace",
    [PREFERRED_ATTENDEE_HEADINGS.copilot_email]: "COPILOT@EXAMPLE.COM", [PREFERRED_ATTENDEE_HEADINGS.copilot_cell_phone]: "(555) 123-4567",
    [PREFERRED_ATTENDEE_HEADINGS.participant_capacity]: "2", [PREFERRED_ATTENDEE_HEADINGS.additional_attendees]: "Pat, 7",
    [PREFERRED_ATTENDEE_HEADINGS.wants_to_volunteer]: "yes",
  };
  const r = interpretAttendeeImportRow(preferredRow, 2);
  assert.equal(r.validation_state, "valid");
  assert.equal(r.candidate.registration.email, "a@example.com");
  assert.equal(r.candidate.copilot.email, "copilot@example.com");
  assert.equal(r.candidate.registration.wants_to_volunteer, true);
});
