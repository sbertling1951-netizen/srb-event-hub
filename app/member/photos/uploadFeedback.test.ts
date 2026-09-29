import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import ts from "typescript";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const start = source.indexOf("  async function uploadPhoto(file: File) {");
const end = source.indexOf("  // Confirmation now happens", start);
const uploadCode = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 });

function fixture(status: number, fetchError?: unknown) {
  const state = { error: null as string | null, completed: 0, reloads: 0 };
  const values = {
    workspaceEvent: { id: "event" }, attendeeId: "registration", memberCaption: "",
    supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "test" } } }) } },
    fetch: async () => { if (fetchError) {throw fetchError;} return new Response(status === 413 ? "<html>Too large</html>" : "{}", { status }); },
    setError: (value: string | null) => { state.error = value; },
    setUploading: () => {}, setStatus: () => {},
    setUploadCompleted: (update: (n: number) => number) => { state.completed = update(state.completed); },
    loadUploads: async () => { state.reloads++; },
    console: { error: () => {} },
  };
  const upload = new Function(...Object.keys(values), `${uploadCode}\nreturn uploadPhoto;`)(...Object.values(values));
  return { state, upload: () => upload(new File(["image"], "photo.jpeg", { type: "image/jpeg" })) };
}

test("proxy HTML 413 becomes a readable size error without claiming an upload", async () => {
  const f = fixture(413);
  assert.equal(await f.upload(), false);
  assert.match(f.state.error!, /too large/);
  assert.equal(f.state.completed, 0);
  assert.equal(f.state.reloads, 0);
});

test("ambiguous finalization tells the member to check My Uploads before retrying", async () => {
  const f = fixture(409);
  assert.equal(await f.upload(), false);
  assert.match(f.state.error!, /Refresh My Uploads before trying again/);
});

test("ordinary failure and network exceptions never display an empty JSON object", async () => {
  for (const f of [fixture(502), fixture(200, new Error("Connection interrupted")), fixture(200, {})]) {
    assert.equal(await f.upload(), false);
    assert.ok(f.state.error && f.state.error !== "{}");
  }
});

test("successful upload alone increments progress and reloads My Uploads", async () => {
  const f = fixture(200);
  assert.equal(await f.upload(), true);
  assert.equal(f.state.completed, 1);
  assert.equal(f.state.reloads, 1);
  assert.equal(f.state.error, null);
});

test("batch failure stops later files and preserves the caption without a success message", async () => {
  const composer = source.indexOf("const files = Array.from(e.target.files || []);");
  const batchStart = source.indexOf("void (async () => {", composer);
  const batchEnd = source.indexOf("})();", batchStart) + 5;
  const code = ts.transpile(source.slice(batchStart, batchEnd).replace("void (async", "return (async"), { target: ts.ScriptTarget.ES2022 });
  let calls = 0;
  let busy = false;
  let clearedCaption = false;
  const messages: string[] = [];
  const values = {
    files: [1, 2], uploadPhoto: async () => { calls++; return false; },
    setUploading: (v: boolean) => { busy = v; }, setError: () => {}, setUploadTotal: () => {}, setUploadCompleted: () => {},
    setStatus: (v: string) => { messages.push(v); }, setMemberCaption: () => { clearedCaption = true; },
  };
  await new Function(...Object.keys(values), code)(...Object.values(values));
  assert.equal(calls, 1);
  assert.equal(busy, false);
  assert.equal(clearedCaption, false);
  assert.ok(messages.every(m => !m.includes("Successfully")));
});
