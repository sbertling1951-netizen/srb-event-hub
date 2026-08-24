import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./adminAuthz.ts", import.meta.url)),
  "utf8",
);

const VENDOR_INVITATIONS_SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "../../app/api/admin/vendors/invitations/route.ts",
      import.meta.url,
    ),
  ),
  "utf8",
);

function functionBody(name: string, nextName?: string) {
  const start = SOURCE.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextName
    ? SOURCE.indexOf(`export function ${nextName}(`, start)
    : SOURCE.length;
  assert.notEqual(end, -1, `${nextName || "EOF"} must follow ${name}`);
  return SOURCE.slice(start, end);
}

test("T0 leaves the established Admin authentication and identity-linkage path unchanged", () => {
  const body = functionBody("resolveAdminActorFromBearer", "adminHasPermission");

  assert.match(body, /authorizationHeader\?\.match\(\/\^Bearer/);
  assert.match(body, /supabaseAdmin\.auth\.getUser\(bearerToken\)/);
  assert.match(body, /resolveAndLinkAdminIdentity\(supabaseAdmin/);
  assert.equal(/credential|resolveAuthenticatedRequest/.test(body), false);
});

test("adminCanManageEvent consumes the canonical database authority predicate", () => {
  const body = functionBody("adminCanManageEvent");

  assert.match(
    body,
    /supabaseAdmin\.rpc\(\s*\n\s*"has_event_admin_authority"/,
  );
  assert.match(
    body,
    /p_auth_user_id: admin\.authUserId,\s*\n\s*p_event_id: eventId/,
  );
  assert.equal(/admin\.isSuperAdmin/.test(body), false);
  assert.equal(/admin_event_access/.test(body), false);
  assert.equal(/has_tenant_admin_authority/.test(body), false);
  assert.match(body, /return data === true;/);
});

test("Vendor invitation and revocation keep one shared server authority path", () => {
  const calls = VENDOR_INVITATIONS_SOURCE.match(/adminCanManageEvent\(/g) || [];
  assert.equal(calls.length, 2);
  assert.match(
    VENDOR_INVITATIONS_SOURCE,
    /existingAccess\.invited_for_event_id[\s\S]*adminCanManageEvent\([\s\S]*existingAccess\.invited_for_event_id/,
  );
  assert.match(
    VENDOR_INVITATIONS_SOURCE,
    /if \(eventId\) \{[\s\S]*adminCanManageEvent\([\s\S]*eventId/,
  );
  assert.equal(
    /from\("admin_event_access"\)/.test(VENDOR_INVITATIONS_SOURCE),
    false,
  );
});
