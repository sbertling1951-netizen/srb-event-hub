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

// ---------------------------------------------------------------------------
// Email-sharing consent answers. The registration platform's export answers the
// sharing question with two full phrases rather than Yes/No. They are recognized
// EXACTLY (after the parser's existing trim / case-fold / whitespace-collapse /
// curly-apostrophe normalization) and only for share_with_attendees. All
// fixtures are synthetic; no roster data appears here.

const SHARING_HEADER = "Ok to share your email with other attendees?";
const SHARE_YES = "Yes, Share my email";
const SHARE_NO = "No. Don't share my email";
const base = { "Entry ID": "E9", Email: "pilot@example.invalid", "Pilot First": "Grace", "Pilot Last": "Hopper" };
const withSharing = (answer: string, header: string = SHARING_HEADER) => interpretAttendeeImportRow({ ...base, [header]: answer }, 2);
const codes = (r: ReturnType<typeof interpretAttendeeImportRow>) => r.issues.map((i) => i.code);

test("the two established sharing phrases are recognized: true AND false, valid, through the historical header and the preferred heading", () => {
  const yes = withSharing(SHARE_YES);
  assert.equal(yes.candidate.registration.share_with_attendees, true);
  assert.equal(yes.validation_state, "valid");
  assert.deepEqual(codes(yes), []);

  const no = withSharing(SHARE_NO);
  assert.equal(no.candidate.registration.share_with_attendees, false);
  assert.equal(no.validation_state, "valid");
  assert.deepEqual(codes(no), []);

  const preferredYes = withSharing(SHARE_YES, PREFERRED_ATTENDEE_HEADINGS.share_with_attendees);
  const preferredNo = withSharing(SHARE_NO, PREFERRED_ATTENDEE_HEADINGS.share_with_attendees);
  assert.equal(preferredYes.candidate.registration.share_with_attendees, true);
  assert.equal(preferredNo.candidate.registration.share_with_attendees, false);
  assert.equal(preferredYes.validation_state, "valid");
  assert.equal(preferredNo.validation_state, "valid");
});

test("the complete short boolean vocabulary and formatting variations are accepted for every boolean field; a negative answer is never true", () => {
  const fields = [
    { header: SHARING_HEADER, read: (r: ReturnType<typeof interpretAttendeeImportRow>) => r.candidate.registration.share_with_attendees },
    { header: "Volunteer", read: (r: ReturnType<typeof interpretAttendeeImportRow>) => r.candidate.registration.wants_to_volunteer },
    { header: "First Timer", read: (r: ReturnType<typeof interpretAttendeeImportRow>) => r.candidate.registration.is_first_timer },
  ];
  for (const { header, read } of fields) {
    for (const answer of ["Yes", "yes", "YES", "Y", "y", "True", "TRUE", "1", "  Yes  ", "tRuE"]) {
      const r = withSharing(answer, header);
      assert.equal(read(r), true, `${header}: ${JSON.stringify(answer)} must be true`);
      assert.equal(r.validation_state, "valid", `${header}: ${JSON.stringify(answer)} must be valid`);
    }
    for (const answer of ["No", "no", "NO", "N", "n", "False", "FALSE", "0", "  No  ", "fAlSe"]) {
      const r = withSharing(answer, header);
      assert.equal(read(r), false, `${header}: ${JSON.stringify(answer)} must be false`);
      assert.equal(r.validation_state, "valid", `${header}: ${JSON.stringify(answer)} must be valid`);
    }
  }

  // Formatting variations of the two sharing phrases: curly apostrophe,
  // repeated/surrounding whitespace, mixed case.
  for (const answer of ["Yes,   Share  my   email", "  yes, share my email  ", "YES, SHARE MY EMAIL", "yEs, sHaRe MY eMaIl"]) {
    const r = withSharing(answer);
    assert.equal(r.candidate.registration.share_with_attendees, true, JSON.stringify(answer));
    assert.equal(r.validation_state, "valid", JSON.stringify(answer));
  }
  for (const answer of ["No. Don’t share my email", "  No.  Don't   share my email  ", "NO. DON'T SHARE MY EMAIL", "no. don’t share my email"]) {
    const r = withSharing(answer);
    assert.equal(r.candidate.registration.share_with_attendees, false, JSON.stringify(answer));
    assert.equal(r.validation_state, "valid", JSON.stringify(answer));
  }
});

test("unknown, contradictory or merely similar answers stay malformed_boolean and validation_failed -- never a silent No", () => {
  for (const answer of [
    "maybe", "yes/no", "Yes, do not share my email", "No, share my email",
    "No. Don't share my email.", "Yes, Share my email please", "Share my email", "Don't share my email", "yes, share",
  ]) {
    const r = withSharing(answer);
    assert.ok(codes(r).includes("malformed_boolean"), `${JSON.stringify(answer)} must be malformed`);
    assert.equal(r.validation_state, "validation_failed", JSON.stringify(answer));
    assert.equal(r.candidate.registration.share_with_attendees, false, `${JSON.stringify(answer)} must not read as consent`);
  }

  // The sharing phrases are sharing-specific: they are not valid Volunteer or
  // First Timer answers.
  for (const header of ["Volunteer", "First Timer"]) {
    for (const answer of [SHARE_YES, SHARE_NO]) {
      const r = withSharing(answer, header);
      assert.ok(codes(r).includes("malformed_boolean"), `${header}: ${JSON.stringify(answer)} must be malformed`);
      assert.equal(r.validation_state, "validation_failed");
      assert.equal(r.candidate.registration.wants_to_volunteer, false);
      assert.equal(r.candidate.registration.is_first_timer, false);
    }
  }

  // Two sharing alias columns with different values are still a conflict.
  const conflicting = interpretAttendeeImportRow({ ...base, [SHARING_HEADER]: SHARE_YES, "Share email with attendees": "No" }, 2);
  assert.ok(codes(conflicting).includes("conflicting_aliases"));
  assert.equal(conflicting.validation_state, "validation_failed");
});

test("raw source payload is preserved exactly; equivalent sharing answers share one fingerprint, opposite consent changes it, blank stays false", async () => {
  const payload = { ...base, [SHARING_HEADER]: "No. Don’t share my email" };
  const snapshot = JSON.parse(JSON.stringify(payload));
  const r = interpretAttendeeImportRow(payload, 2);
  assert.equal(r.source_payload, payload, "the same payload object is retained");
  assert.deepEqual(r.source_payload, snapshot, "and its raw answer text is untouched");
  assert.equal(r.source_payload[SHARING_HEADER], "No. Don’t share my email");

  const [a, b, c] = await Promise.all([
    withSharing(SHARE_YES).fingerprint,
    withSharing("yes").fingerprint,
    withSharing("YES,  share my email").fingerprint,
  ]);
  assert.equal(a, b);
  assert.equal(b, c);
  const opposite = await withSharing(SHARE_NO).fingerprint;
  assert.notEqual(a, opposite);
  const plainNo = await withSharing("No").fingerprint;
  assert.equal(opposite, plainNo);

  const blank = withSharing("");
  assert.equal(blank.candidate.registration.share_with_attendees, false);
  assert.deepEqual(codes(blank), []);
  assert.equal(blank.validation_state, "valid");
  const missing = interpretAttendeeImportRow({ ...base }, 2);
  assert.equal(missing.candidate.registration.share_with_attendees, false);
  assert.equal(await blank.fingerprint, await missing.fingerprint);
});
