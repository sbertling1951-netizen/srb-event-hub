import assert from "node:assert/strict";
import test from "node:test";

import {
  createMyPrivateEventDraft,
  listMyPrivateEventDrafts,
  organizerDraftInputError,
  type OrganizerDraftRpcClient,
} from "./organizerDrafts";

const input = {
  organizationName: "Pap's Events",
  eventName: "Autumn Dinner",
  startDate: "2026-10-10",
  endDate: "2026-10-10",
  timezone: "America/Los_Angeles",
  locationMode: "location" as const,
  location: "Community Hall",
  starterTemplate: "casual",
  idempotencyKey: "c54d7fa0-d55f-43bc-a66a-419385789b87",
};

test("organizer draft input requires an end date and IANA time zone", () => {
  assert.equal(organizerDraftInputError(input), null);
  assert.match(organizerDraftInputError({ ...input, endDate: "2026-10-09" }) ?? "", /cannot be before/);
  assert.equal(organizerDraftInputError({ ...input, startDate: "" }), null);
  assert.match(organizerDraftInputError({ ...input, timezone: "Not/AZone" }) ?? "", /valid time zone/);
});

test("creation uses the one governed RPC with the complete idempotent contract", async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const client: OrganizerDraftRpcClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: [{
          outcome: "created",
          tenant_id: "tenant",
          event_id: "event",
          organizer_person_id: "person-1",
          ...input,
          created_at: "2026-09-05T00:00:00Z",
        }],
        error: null,
      };
    },
  };

  const result = await createMyPrivateEventDraft(client, input);
  assert.equal(result.status, "created");
  assert.equal(
    result.status === "created" ? result.draft.organizer_person_id : null,
    "person-1",
  );
  assert.equal(calls[0]?.name, "create_self_service_organizer_draft");
  assert.deepEqual(calls[0]?.args, {
    p_organization_name: "Pap's Events",
    p_event_name: "Autumn Dinner",
    p_start_date: "2026-10-10",
    p_end_date: "2026-10-10",
    p_timezone: "America/Los_Angeles",
    p_location_mode: "location",
    p_location: "Community Hall",
    p_starter_template: "casual",
    p_idempotency_key: "c54d7fa0-d55f-43bc-a66a-419385789b87",
  });
});

test("an unset optional start date reaches the RPC as null, never an empty string", async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const client: OrganizerDraftRpcClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: [{ tenant_id: "tenant", event_id: "event", ...input, start_date: null, created_at: "2026-09-05T00:00:00Z" }],
        error: null,
      };
    },
  };

  await createMyPrivateEventDraft(client, { ...input, startDate: "" });
  assert.equal(calls[0]?.args?.p_start_date, null);
});

test("an uncertain prior identity is a returned outcome (not an error), and carries no draft/candidate data", async () => {
  for (const outcome of [
    "identity_confirmation_required",
    "identity_review_required",
  ] as const) {
    const result = await createMyPrivateEventDraft(
      {
        async rpc() {
          // the RPC returns the discriminator with every draft column null,
          // and no error -- the server-side resolution-audit row has committed.
          return {
            data: [{
              outcome,
              tenant_id: null,
              organizer_appointment_id: null,
              organizer_person_id: null,
              event_id: null,
              organization_name: null,
              event_name: null,
            }],
            error: null,
          };
        },
      },
      input,
    );
    assert.equal(result.status, outcome);
    // the discriminated result exposes nothing but the status
    assert.deepEqual(Object.keys(result), ["status"]);
  }
});

test("a genuine RPC error is still surfaced as an error, never coerced to an identity outcome", async () => {
  await assert.rejects(
    () =>
      createMyPrivateEventDraft(
        {
          async rpc() {
            return { data: null, error: { message: "A valid IANA Event timezone is required." } };
          },
        },
        input,
      ),
    /valid IANA Event timezone/,
  );
  await assert.rejects(
    () =>
      createMyPrivateEventDraft(
        {
          async rpc() {
            return { data: null, error: { message: "Idempotency key was already used with different draft input." } };
          },
        },
        input,
      ),
    /Idempotency key was already used/,
  );
});

test("the list adapter never falls back to a table read", async () => {
  const drafts = await listMyPrivateEventDrafts({
    async rpc(name) {
      assert.equal(name, "list_my_self_service_private_drafts");
      return { data: [], error: null };
    },
  });
  assert.deepEqual(drafts, []);
});
