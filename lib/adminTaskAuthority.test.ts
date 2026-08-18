import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { checkAdminEventTaskAuthority } from "./adminTaskAuthority";

// Task-Authority Guard Design, section C-D. Run with:
//   npx tsx --test lib/adminTaskAuthority.test.ts
//
// Following the same split as lib/eventOperationalSummary.test.ts's own
// RPC-calling function: the no-Event early return needs no network and
// is executed for real; the RPC-dependent branches (this repo has no
// HTTP/Supabase mocking infrastructure anywhere) are proven structurally
// against source, exactly as that precedent already does for its own
// fetchEventOperationalSummary.

const SOURCE = readFileSync(
  fileURLToPath(new URL("./adminTaskAuthority.ts", import.meta.url)),
  "utf8",
);

// ---- Executed for real: no network involved. ----

test("missing eventId resolves to no_event without ever reaching the RPC call", async () => {
  assert.deepEqual(await checkAdminEventTaskAuthority("event.print.view", null), {
    status: "no_event",
  });
  assert.deepEqual(await checkAdminEventTaskAuthority("event.print.view", undefined), {
    status: "no_event",
  });
  assert.deepEqual(await checkAdminEventTaskAuthority("event.print.view", ""), {
    status: "no_event",
  });
});

test("the no_event early return appears before the RPC call in source -- structurally unreachable once no_event is returned", () => {
  const returnIdx = SOURCE.indexOf('return { status: "no_event" };');
  const rpcIdx = SOURCE.indexOf(".rpc(");
  assert.ok(returnIdx > -1 && rpcIdx > -1);
  assert.ok(returnIdx < rpcIdx);
});

// ---- Structural proof for the RPC-dependent branches. ----

test("calls exactly the existing governed RPC, with exactly this parameter shape, and no other table or function", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("export async function checkAdminEventTaskAuthority"));
  assert.match(
    fn,
    /\.rpc\("has_event_task_authority", \{\s*\n\s*p_task_key: taskKey,\s*\n\s*p_event_id: eventId,\s*\n\s*\}\)/,
  );
  assert.equal((fn.match(/\.rpc\(/g) || []).length, 1);
  assert.equal(/\.from\(/.test(SOURCE), false);
});

test("an RPC error resolves to check_failed, checked before the data branch -- never treated as allowed", () => {
  const errorBranch = SOURCE.slice(
    SOURCE.indexOf("if (error)"),
    SOURCE.indexOf("return data ?"),
  );
  assert.match(errorBranch, /status: "check_failed"/);
  assert.equal(/"allowed"/.test(errorBranch), false);
});

test("RPC true maps to allowed, RPC false maps to denied, in one ternary with no third path", () => {
  assert.match(
    SOURCE,
    /return data \? \{ status: "allowed" \} : \{ status: "denied" \};/,
  );
});

test("the error check comes before the data ternary in source order -- an error can never fall through to allowed/denied", () => {
  const errorIdx = SOURCE.indexOf("if (error)");
  const ternaryIdx = SOURCE.indexOf("return data ?");
  assert.ok(errorIdx > -1 && ternaryIdx > -1);
  assert.ok(errorIdx < ternaryIdx);
});

test("no alternative/duplicate task-authority implementation exists in the function body -- exactly one code path produces each outcome, beyond the type declaration", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("export async function checkAdminEventTaskAuthority"));
  assert.equal((fn.match(/status: "allowed"/g) || []).length, 1);
  assert.equal((fn.match(/status: "denied"/g) || []).length, 1);
  assert.equal((fn.match(/status: "check_failed"/g) || []).length, 1);
  assert.equal((fn.match(/status: "no_event"/g) || []).length, 1);
  assert.equal((fn.match(/\.rpc\(/g) || []).length, 1);
});
