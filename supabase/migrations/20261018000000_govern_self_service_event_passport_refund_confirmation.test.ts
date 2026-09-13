import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./20261018000000_govern_self_service_event_passport_refund_confirmation.sql", import.meta.url)), "utf8");

test("refund confirmation is service-only and atomically writes audit before Passport state", () => {
  assert.match(source, /state IN \('requested', 'confirmed'\)/);
  assert.match(source, /INSERT INTO public\.self_service_event_passport_refund_audit/);
  assert.match(source, /SET state = 'refunded', refunded_at = now\(\)/);
  assert.ok(source.indexOf("INSERT INTO public.self_service_event_passport_refund_audit") < source.indexOf("SET state = 'refunded'"));
  assert.match(source, /GRANT EXECUTE ON FUNCTION public\.confirm_self_service_event_passport_refund[\s\S]*TO service_role;/);
  assert.match(source, /REVOKE ALL ON FUNCTION public\.confirm_self_service_event_passport_refund[\s\S]*FROM PUBLIC, anon, authenticated;/);
});
