import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  addOrganizerEventInputError,
  createEventInMyOrganization,
  createMyPrivateEventDraft,
  deleteMyUnfinishedEvent,
  getMyOrganizerCapacity,
  listMyPrivateEventDrafts,
  listMyPrivateOrganizations,
  organizerDraftInputError,
  type OrganizerDraftRpcClient,
  organizerEventDetailsError,
  replaceMyUnfinishedEvent,
  replaceOrganizerEventInputError,
  saveMyPrivateDraftDetails,
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

test("P-2D.1: a capacity conflict is a returned outcome (not an error), naming only the caller's own blocking Event", async () => {
  const result = await createMyPrivateEventDraft(
    {
      async rpc() {
        // Mirrors the server's actual narrowed contract exactly (Lun's
        // review): every column beyond id/name/schedule is NULL, including
        // organizer_person_id and the lifecycle flags -- never a populated
        // value the adapter merely chooses not to read.
        return {
          data: [{
            outcome: "active_event_exists",
            tenant_id: null,
            organizer_appointment_id: null,
            organizer_person_id: null,
            event_id: "blocking-event",
            organization_name: null,
            event_name: "Existing Reunion",
            start_date: "2026-08-01",
            end_date: "2026-08-02",
            timezone: "America/Denver",
            location_mode: null,
            location: null,
            starter_template: null,
            status: null,
            is_active: null,
            visible_to_members: null,
            created_at: null,
          }],
          error: null,
        };
      },
    },
    input,
  );
  assert.equal(result.status, "active_event_exists");
  assert.deepEqual(
    result.status === "active_event_exists" ? result.blockingEvent : null,
    {
      eventId: "blocking-event",
      eventName: "Existing Reunion",
      startDate: "2026-08-01",
      endDate: "2026-08-02",
      timezone: "America/Denver",
    },
  );
  // no tenant/organization/location/template/Person-id/lifecycle-flag
  // leakage for this outcome -- the adapter result exposes only status +
  // blockingEvent, and blockingEvent itself carries only the 5 display
  // fields (verified structurally below too).
  assert.deepEqual(Object.keys(result), ["status", "blockingEvent"]);
  assert.deepEqual(
    result.status === "active_event_exists" ? Object.keys(result.blockingEvent) : null,
    ["eventId", "eventName", "startDate", "endDate", "timezone"],
  );
});

test("P-2D.1: the blocking-event mapper never reads organizer_person_id, tenant_id, organization_name, location, template, or lifecycle flags, even if a future server response regressed and sent them", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./organizerDrafts.ts", import.meta.url)),
    "utf8",
  );
  const fnStart = source.indexOf("function blockingEventFromRow");
  assert.notEqual(fnStart, -1);
  const fnBody = source.slice(fnStart, source.indexOf("\n}", fnStart));
  for (const forbidden of [
    "organizer_person_id",
    "tenant_id",
    "organizer_appointment_id",
    "organization_name",
    "location",
    "starter_template",
    "status",
    "is_active",
    "visible_to_members",
    "created_at",
  ]) {
    assert.doesNotMatch(fnBody, new RegExp(`row\\.${forbidden}\\b`));
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

test("P-2C: listing event spaces uses only the caller-scoped organizations RPC", async () => {
  const orgs = await listMyPrivateOrganizations({
    async rpc(name) {
      assert.equal(name, "list_my_self_service_private_organizations");
      return {
        data: [{
          tenant_id: "space-1",
          organizer_appointment_id: "appt-1",
          organizer_person_id: "person-1",
          organization_name: "Sofia Personal Org",
          draft_event_count: 2,
          created_at: "2026-09-05T00:00:00Z",
        }],
        error: null,
      };
    },
  });
  assert.equal(orgs[0]?.draft_event_count, 2);
  assert.equal(orgs[0]?.organizer_person_id, "person-1");
});

test("P-2C: adding an event to a space calls the add-event RPC with the tenant + narrow inputs", async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const result = await createEventInMyOrganization(
    {
      async rpc(name, args) {
        calls.push({ name, args });
        return {
          data: [{
            outcome: "created",
            tenant_id: "space-1",
            organizer_appointment_id: "appt-1",
            organizer_person_id: "person-1",
            event_id: "event-2",
            organization_name: "Sofia Personal Org",
            event_name: "Autumn Dinner",
            start_date: null,
            end_date: "2026-10-10",
            timezone: "America/Los_Angeles",
            location_mode: "location",
            location: "Community Hall",
            starter_template: "casual",
            status: "Draft",
            is_active: false,
            visible_to_members: false,
            created_at: "2026-09-05T00:00:00Z",
          }],
          error: null,
        };
      },
    },
    {
      organizationTenantId: "space-1",
      eventName: "Autumn Dinner",
      startDate: "",
      endDate: "2026-10-10",
      timezone: "America/Los_Angeles",
      locationMode: "location",
      location: "Community Hall",
      starterTemplate: "casual",
      idempotencyKey: "c54d7fa0-d55f-43bc-a66a-419385789b87",
    },
  );
  assert.equal(result.status, "created");
  assert.equal(result.status === "created" ? result.draft.event_id : null, "event-2");
  assert.equal(calls[0]?.name, "create_self_service_organizer_event");
  assert.deepEqual(calls[0]?.args, {
    p_organization_tenant_id: "space-1",
    p_event_name: "Autumn Dinner",
    p_start_date: null,
    p_end_date: "2026-10-10",
    p_timezone: "America/Los_Angeles",
    p_location_mode: "location",
    p_location: "Community Hall",
    p_starter_template: "casual",
    p_idempotency_key: "c54d7fa0-d55f-43bc-a66a-419385789b87",
  });
});

test("P-2C: add-event needs a chosen event space, and surfaces the non-enumerating rejection as an error", async () => {
  assert.match(
    addOrganizerEventInputError({
      organizationTenantId: "",
      eventName: "X",
      startDate: "",
      endDate: "2026-10-10",
      timezone: "America/Los_Angeles",
      locationMode: "no_location",
      location: "",
      starterTemplate: "casual",
      idempotencyKey: "c54d7fa0-d55f-43bc-a66a-419385789b87",
    }) ?? "",
    /event space/i,
  );

  await assert.rejects(
    () =>
      createEventInMyOrganization(
        {
          async rpc() {
            return { data: null, error: { message: "Organization not found." } };
          },
        },
        {
          organizationTenantId: "not-mine",
          eventName: "X",
          startDate: "",
          endDate: "2026-10-10",
          timezone: "America/Los_Angeles",
          locationMode: "no_location",
          location: "",
          starterTemplate: "casual",
          idempotencyKey: "c54d7fa0-d55f-43bc-a66a-419385789b87",
        },
      ),
    /Organization not found\./,
  );
});

test("P-2C: an uncertain identity outcome from add-event is a returned status, not an error or draft", async () => {
  for (const outcome of ["identity_confirmation_required", "identity_review_required"] as const) {
    const result = await createEventInMyOrganization(
      {
        async rpc() {
          return {
            data: [{ outcome, tenant_id: null, event_id: null, organizer_person_id: null }],
            error: null,
          };
        },
      },
      {
        organizationTenantId: "space-1",
        eventName: "X",
        startDate: "",
        endDate: "2026-10-10",
        timezone: "America/Los_Angeles",
        locationMode: "no_location",
        location: "",
        starterTemplate: "casual",
        idempotencyKey: "c54d7fa0-d55f-43bc-a66a-419385789b87",
      },
    );
    assert.equal(result.status, outcome);
    assert.deepEqual(Object.keys(result), ["status"]);
  }
});

test("P-2D: getMyOrganizerCapacity maps the server contract and coerces types", async () => {
  const client: OrganizerDraftRpcClient = {
    async rpc(name) {
      assert.equal(name, "get_my_self_service_organizer_capacity");
      return {
        data: [{ active_event_limit: 1, active_unfinished_event_count: 1, can_start_another_event: false }],
        error: null,
      };
    },
  };
  const capacity = await getMyOrganizerCapacity(client);
  assert.deepEqual(capacity, {
    active_event_limit: 1,
    active_unfinished_event_count: 1,
    can_start_another_event: false,
  });
});

test("P-2D: getMyOrganizerCapacity returns null on an empty (fail-closed) result and rethrows RPC errors", async () => {
  const empty: OrganizerDraftRpcClient = {
    async rpc() {
      return { data: [], error: null };
    },
  };
  assert.equal(await getMyOrganizerCapacity(empty), null);

  const failing: OrganizerDraftRpcClient = {
    async rpc() {
      return { data: null, error: { message: "capacity unavailable" } };
    },
  };
  await assert.rejects(() => getMyOrganizerCapacity(failing), /capacity unavailable/);
});

test("P-2D: deleteMyUnfinishedEvent uses the one governed RPC with the two-argument contract", async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const client: OrganizerDraftRpcClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: [{
          outcome: "deleted",
          deleted_event_id: "event-1",
          deleted_tenant_id: "tenant-1",
          deletion_scope: "event_and_empty_workspace",
          removed_command_audit_count: 1,
          occurred_at: "2026-09-26T00:00:00Z",
        }],
        error: null,
      };
    },
  };

  const result = await deleteMyUnfinishedEvent(client, {
    eventId: "event-1",
    idempotencyKey: "c54d7fa0-d55f-43bc-a66a-419385789b87",
  });

  assert.deepEqual(result, {
    status: "deleted",
    deletedEventId: "event-1",
    deletionScope: "event_and_empty_workspace",
    deletedWorkspace: true,
  });
  assert.equal(calls[0]?.name, "delete_self_service_organizer_event");
  assert.deepEqual(calls[0]?.args, {
    p_event_id: "event-1",
    p_idempotency_key: "c54d7fa0-d55f-43bc-a66a-419385789b87",
  });
});

test("P-2D: deleteMyUnfinishedEvent reports event_only scope and blocks a missing secure key", async () => {
  const client: OrganizerDraftRpcClient = {
    async rpc() {
      return {
        data: [{ outcome: "deleted", deleted_event_id: "e2", deleted_tenant_id: null, deletion_scope: "event_only" }],
        error: null,
      };
    },
  };
  const result = await deleteMyUnfinishedEvent(client, { eventId: "e2", idempotencyKey: "k" });
  assert.equal(result.deletionScope, "event_only");
  assert.equal(result.deletedWorkspace, false);

  await assert.rejects(
    () => deleteMyUnfinishedEvent(client, { eventId: "e2", idempotencyKey: "" }),
    /secure/,
  );
});

test("P-2D: deleteMyUnfinishedEvent surfaces a non-owned / not-found rejection verbatim", async () => {
  const client: OrganizerDraftRpcClient = {
    async rpc() {
      return { data: null, error: { message: "Event not found." } };
    },
  };
  await assert.rejects(
    () => deleteMyUnfinishedEvent(client, { eventId: "someone-elses", idempotencyKey: "k" }),
    /Event not found\./,
  );
});

test("P-2D.1: replaceMyUnfinishedEvent calls the one atomic RPC with the old Event id plus the complete new-draft contract", async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const client: OrganizerDraftRpcClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: [{
          outcome: "replaced",
          tenant_id: "tenant-2",
          organizer_appointment_id: "appt-2",
          organizer_person_id: "person-1",
          event_id: "event-2",
          organization_name: "Autumn Dinner",
          event_name: "Autumn Dinner",
          start_date: "2026-10-10",
          end_date: "2026-10-10",
          timezone: "America/Los_Angeles",
          location_mode: "location",
          location: "Community Hall",
          starter_template: "casual",
          status: "Draft",
          is_active: false,
          visible_to_members: false,
          created_at: "2026-09-10T00:00:00Z",
          deleted_event_id: "event-1",
          deletion_scope: "event_and_empty_workspace",
        }],
        error: null,
      };
    },
  };

  const result = await replaceMyUnfinishedEvent(client, { ...input, oldEventId: "event-1" });
  assert.equal(result.status, "replaced");
  assert.equal(result.status === "replaced" ? result.draft.event_id : null, "event-2");
  assert.equal(result.status === "replaced" ? result.deletedEventId : null, "event-1");
  assert.equal(
    result.status === "replaced" ? result.deletionScope : null,
    "event_and_empty_workspace",
  );
  assert.equal(calls[0]?.name, "replace_self_service_organizer_event");
  assert.deepEqual(calls[0]?.args, {
    p_old_event_id: "event-1",
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

test("P-2D.1: replaceMyUnfinishedEvent requires an old Event to replace, before any RPC call", async () => {
  assert.match(
    replaceOrganizerEventInputError({ ...input, oldEventId: "" }) ?? "",
    /choose the unfinished event to replace/i,
  );
  await assert.rejects(
    () =>
      replaceMyUnfinishedEvent(
        {
          async rpc() {
            throw new Error("rpc should not be called with no old event id");
          },
        },
        { ...input, oldEventId: "" },
      ),
    /choose the unfinished event to replace/i,
  );
});

test("P-2D.1: an uncertain identity outcome from replace leaves the old Event untouched (returned outcome, not an error, no draft)", async () => {
  for (const outcome of ["identity_confirmation_required", "identity_review_required"] as const) {
    const result = await replaceMyUnfinishedEvent(
      {
        async rpc() {
          return {
            data: [{
              outcome,
              tenant_id: null, organizer_appointment_id: null, organizer_person_id: null,
              event_id: null, organization_name: null, event_name: null,
              deleted_event_id: null, deletion_scope: null,
            }],
            error: null,
          };
        },
      },
      { ...input, oldEventId: "event-1" },
    );
    assert.equal(result.status, outcome);
    assert.deepEqual(Object.keys(result), ["status"]);
  }
});

test("P-2D.1: an unauthorized/foreign/missing old Event surfaces the same non-enumerating rejection as standalone delete", async () => {
  await assert.rejects(
    () =>
      replaceMyUnfinishedEvent(
        {
          async rpc() {
            return { data: null, error: { message: "Event not found." } };
          },
        },
        { ...input, oldEventId: "someone-elses-event" },
      ),
    /Event not found\./,
  );
});

test("P-3A: saveMyPrivateDraftDetails maps values + baseline onto the 15-arg RPC contract", async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const client: OrganizerDraftRpcClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: [{
          tenant_id: "t", organizer_appointment_id: "a", organizer_person_id: "p",
          event_id: "e1", organization_name: "Sofia Personal Org", event_name: "Renamed Dinner",
          start_date: null, end_date: "2026-11-02", timezone: "America/Denver",
          location_mode: "online", location: null, starter_template: "dinner",
          status: "Draft", is_active: false, visible_to_members: false,
          created_at: "2026-09-05T00:00:00Z",
        }],
        error: null,
      };
    },
  };

  const result = await saveMyPrivateDraftDetails(client, {
    eventId: "e1",
    values: {
      eventName: "  Renamed Dinner  ", startDate: "", endDate: "2026-11-02",
      timezone: "America/Denver", locationMode: "online", location: "  ",
      starterTemplate: "dinner",
    },
    expected: {
      eventName: "Autumn Dinner", startDate: "", endDate: "2026-10-10",
      timezone: "America/Los_Angeles", locationMode: "location", location: "Community Hall",
      starterTemplate: "casual",
    },
  });

  assert.equal(result.status, "saved");
  assert.equal(result.status === "saved" ? result.draft.event_name : null, "Renamed Dinner");
  assert.equal(calls[0]?.name, "save_my_self_service_private_draft_details");
  assert.deepEqual(calls[0]?.args, {
    p_event_id: "e1",
    p_event_name: "Renamed Dinner",
    p_start_date: null,
    p_end_date: "2026-11-02",
    p_timezone: "America/Denver",
    p_location_mode: "online",
    p_location: null,
    p_starter_template: "dinner",
    p_expected_event_name: "Autumn Dinner",
    p_expected_start_date: null,
    p_expected_end_date: "2026-10-10",
    p_expected_timezone: "America/Los_Angeles",
    p_expected_location: "Community Hall",
    p_expected_location_mode: "location",
    p_expected_starter_template: "casual",
  });
});

test("P-3A: a stale-save rejection is a discriminated result, not a thrown error", async () => {
  const client: OrganizerDraftRpcClient = {
    async rpc() {
      return { data: null, error: { message: "stale_draft_details" } };
    },
  };
  const result = await saveMyPrivateDraftDetails(client, {
    eventId: "e1",
    values: { eventName: "X", startDate: "", endDate: "2026-10-10", timezone: "UTC", locationMode: "no_location", location: "", starterTemplate: "casual" },
    expected: { eventName: "Y", startDate: "", endDate: "2026-10-10", timezone: "UTC", locationMode: "no_location", location: "", starterTemplate: "casual" },
  });
  assert.deepEqual(result, { status: "stale" });
});

test("P-3A: client-side validation and real RPC errors are surfaced without a write", async () => {
  const client: OrganizerDraftRpcClient = {
    async rpc() {
      throw new Error("rpc should not be called on invalid input");
    },
  };
  await assert.rejects(
    () => saveMyPrivateDraftDetails(client, {
      eventId: "e1",
      values: { eventName: "", startDate: "", endDate: "2026-10-10", timezone: "UTC", locationMode: "no_location", location: "", starterTemplate: "casual" },
      expected: { eventName: "", startDate: "", endDate: "2026-10-10", timezone: "UTC", locationMode: "no_location", location: "", starterTemplate: "casual" },
    }),
    /Enter an Event name/,
  );

  const failing: OrganizerDraftRpcClient = {
    async rpc() {
      return { data: null, error: { message: "Draft not found." } };
    },
  };
  await assert.rejects(
    () => saveMyPrivateDraftDetails(failing, {
      eventId: "not-mine",
      values: { eventName: "X", startDate: "", endDate: "2026-10-10", timezone: "UTC", locationMode: "no_location", location: "", starterTemplate: "casual" },
      expected: { eventName: "X", startDate: "", endDate: "2026-10-10", timezone: "UTC", locationMode: "no_location", location: "", starterTemplate: "casual" },
    }),
    /Draft not found\./,
  );
});

test("P-3A: organizerEventDetailsError is the shared field-rule validator (no idempotency key needed)", () => {
  const ok = {
    eventName: "Dinner", startDate: "", endDate: "2026-10-10", timezone: "UTC",
    locationMode: "no_location" as const, location: "",
  };
  assert.equal(organizerEventDetailsError(ok), null);
  assert.match(organizerEventDetailsError({ ...ok, eventName: " " }) ?? "", /Enter an Event name/);
  assert.match(organizerEventDetailsError({ ...ok, timezone: "Nope/Zone" }) ?? "", /valid time zone/);
  assert.match(
    organizerEventDetailsError({ ...ok, locationMode: "online", location: "somewhere" }) ?? "",
    /only used when the Event has a location/,
  );
});
