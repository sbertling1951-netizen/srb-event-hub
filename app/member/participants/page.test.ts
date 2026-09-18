import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

test("the page is guarded by MemberRouteGuard and uses the canonical Member shell with no back target", () => {
  assert.match(source, /<MemberRouteGuard>/);
  assert.match(source, /<MemberShellAdapter[\s\S]*pageTitle="Participants"/);
  assert.match(source, /pageSubtitle="Manage the people associated with your registration\."/);
  assert.equal((source.match(/backTarget=/g) || []).length, 0);
});

test("participant data is read only through the two governed member RPCs, never a direct table read", () => {
  assert.match(source, /supabase\.rpc\(\s*\n?\s*"get_my_attendee_record"/);
  assert.match(source, /supabase\.rpc\(\s*\n?\s*"get_my_household_members"/);
  assert.doesNotMatch(source, /\.from\(\s*["']/);
});

test("the capacity summary, participant rows, and vacant-slot rows use the shared PageSection/LoadingState/AppButton primitives", () => {
  assert.match(source, /import \{ AppButton \} from "@\/components\/ui\/AppButton";/);
  assert.match(source, /import \{ LoadingState \} from "@\/components\/ui\/LoadingState";/);
  assert.match(source, /import \{ PageSection \} from "@\/components\/ui\/PageSection";/);
  assert.equal((source.match(/<PageSection\b/g) || []).length, 3);
  assert.match(source, /<LoadingState message="Loading participants…" \/>/);
  assert.doesNotMatch(source, /<button\b/);
  assert.doesNotMatch(source, /className="rounded-lg border p-4">Loading\.\.\./);
});

test("Add Participant uses AppButton, keeps its exact label and handler, and stays gated behind canMutateParticipantIdentity", () => {
  assert.match(
    source,
    /<AppButton variant="primary" onClick=\{\(\) => setShowEditor\(true\)\}>\s*\+ Add Participant\s*<\/AppButton>/,
  );
  assert.match(source, /canMutateParticipantIdentity &&\s*\n\s*Array\.from\(\{ length: vacantSlots \}\)/);
  assert.match(source, /!canMutateParticipantIdentity &&/);
});

test("the destructive capacity-bar fill uses the exact design token, and the amber warning / track / success / partial colors are untouched", () => {
  assert.match(source, /background: isOverCapacity\s*\n\s*\? "var\(--color-action-destructive\)"/);
  assert.doesNotMatch(source, /#dc2626/);
  // Colors deliberately preserved -- no exact token match exists for these.
  assert.match(source, /color: "#b45309"/);
  assert.match(source, /background: "#fffbeb"/);
  assert.match(source, /border: "1px solid #fde68a"/);
  assert.match(source, /background: "#e5e7eb"/);
  assert.match(source, /"#22c55e"/);
  assert.match(source, /"#f59e0b"/);
});

test("capacity calculations and their derivations are unchanged", () => {
  assert.match(source, /const registeredParticipantCount = participantCount;/);
  assert.match(
    source,
    /const accountLinkedCount = participants\.filter\(\s*\n\s*\(p\) => p\.email && p\.email\.trim\(\) !== "",\s*\n\s*\)\.length;/,
  );
  assert.match(source, /const hasKnownCapacity = typeof capacity === "number";/);
  assert.match(
    source,
    /const isOverCapacity =\s*\n\s*hasKnownCapacity && registeredParticipantCount > \(capacity as number\);/,
  );
  assert.match(
    source,
    /const vacantSlots = hasKnownCapacity\s*\n\s*\? Math\.max\(0, \(capacity as number\) - registeredParticipantCount\)\s*\n\s*: 0;/,
  );
});

test("ParticipantIdentityEditor props are unchanged", () => {
  assert.match(
    source,
    /<ParticipantIdentityEditor\s*\n\s*open=\{showEditor\}\s*\n\s*onClose=\{\(\) => setShowEditor\(false\)\}\s*\n\s*onSaved=\{loadParticipants\}\s*\n\s*attendeeId=\{currentAttendee\?\.id \?\? ""\}\s*\n\s*eventId=\{currentAttendee\?\.event_id \?\? ""\}\s*\n\s*sortOrder=\{participants\.length \+ 1\}\s*\n\s*slotRole="additional"\s*\n\s*\/>/,
  );
});

test("engagement logging on view is unchanged", () => {
  assert.match(source, /activityType: "participants_view"/);
});

test("the persistent no-mutate-access notice is untouched", () => {
  assert.match(
    source,
    /<div className="card app-card-section-muted">\s*\n\s*Participant identity changes require a signed-in account or\s*\n\s*assistance from event administration\.\s*\n\s*<\/div>/,
  );
});
