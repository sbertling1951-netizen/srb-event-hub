import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveShellMode } from "@/components/shell/routeRegistry";

test("the approved Member pilot routes use the canonical Member shell", () => {
  for (const pathname of [
    "/member",
    "/member/agenda",
    "/member/announcements",
    "/member/attendees",
    "/member/checkin",
    "/member/evaluation",
    "/member/events",
    "/member/my-assignments",
    "/member/my-requests",
    "/member/participants",
    "/member/photos",
    "/member/vendor-signup",
  ]) {
    assert.equal(resolveShellMode(pathname), "canonical-member");
  }
});

test("Member Agenda children remain legacy while the exact Agenda route is canonical", () => {
  assert.equal(resolveShellMode("/member/agenda/categories"), "legacy");
  assert.equal(resolveShellMode("/member/agenda/import"), "legacy");
  assert.equal(resolveShellMode("/member/nearby"), "canonical-member");
});

test("Member authentication exceptions remain shell exceptions", () => {
  assert.equal(resolveShellMode("/member/login"), "exception");
  assert.equal(resolveShellMode("/member/activate"), "exception");
  assert.equal(resolveShellMode("/member/account"), "exception");
  assert.equal(resolveShellMode("/member/account/reset-password"), "exception");
});

test("Admin and Vendor shell classifications remain correct", () => {
  assert.equal(resolveShellMode("/admin/announcements"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/dashboard"), "canonical-admin");
  assert.equal(resolveShellMode("/vendor/workspace"), "canonical-vendor");
});

test("Admin Reports uses the canonical shell without moving print exceptions", () => {
  assert.equal(resolveShellMode("/admin/reports"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/reports/coach-plates/print"), "exception");
  assert.equal(resolveShellMode("/admin/reports/name-tags/print"), "exception");
  assert.equal(resolveShellMode("/admin/imports"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/validation-rules"), "canonical-admin");
});

test("Admin shell Cohort A routes use the canonical Admin shell", () => {
  for (const pathname of [
    "/admin/checklist",
    "/admin/export",
    "/admin/vendors/access",
  ]) {
    assert.equal(resolveShellMode(pathname), "canonical-admin");
  }

  assert.equal(resolveShellMode("/admin/login"), "exception");
  assert.equal(resolveShellMode("/admin/print"), "exception");
  assert.equal(resolveShellMode("/admin/reports/coach-plates/print"), "exception");
  assert.equal(resolveShellMode("/admin/events"), "legacy");
  // /admin/vendors itself was migrated by a later cohort (still legacy
  // when this Cohort A test was written); /admin/vendors/access/history
  // remains legacy since only the exact /admin/vendors/access path is
  // registered, not its /history child.
  assert.equal(resolveShellMode("/admin/vendors"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/vendors/access/history"), "legacy");
});

test("Admin shell Cohort B1 routes use the canonical Admin shell", () => {
  for (const pathname of ["/admin/events/new", "/admin/vendor-requests"]) {
    assert.equal(resolveShellMode(pathname), "canonical-admin");
  }

  assert.equal(resolveShellMode("/admin/events"), "legacy");
  assert.equal(resolveShellMode("/admin/vendor-requests/history"), "legacy");
  assert.equal(resolveShellMode("/admin/login"), "exception");
  assert.equal(resolveShellMode("/admin/print"), "exception");
});

test("Admin Check-In uses the canonical Admin shell", () => {
  assert.equal(resolveShellMode("/admin/checkin"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/attendees"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/parking"), "legacy");
  assert.equal(resolveShellMode("/admin/login"), "exception");
  assert.equal(resolveShellMode("/admin/print"), "exception");
});

test("Admin Attendees uses the exact canonical Admin route without moving adjacent legacy routes", () => {
  assert.equal(resolveShellMode("/admin/attendees"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/attendees/history"), "legacy");
  assert.equal(resolveShellMode("/admin/engagement"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/imports"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/validation-rules"), "canonical-admin");
});

test("Admin shell Cohort 2 routes use the canonical Admin shell", () => {
  for (const pathname of [
    "/admin/data-review",
    "/admin/engagement",
    "/admin/imports",
    "/admin/validation-rules",
  ]) {
    assert.equal(resolveShellMode(pathname), "canonical-admin");
  }
});

test("Admin Print Settings uses the canonical Admin shell", () => {
  assert.equal(resolveShellMode("/admin/print-settings"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/print"), "exception");
  assert.equal(
    resolveShellMode("/admin/reports/coach-plates/print"),
    "exception",
  );
  assert.equal(
    resolveShellMode("/admin/reports/name-tags/print"),
    "exception",
  );
  assert.equal(resolveShellMode("/admin/events"), "legacy");
});

test("Admin shell Cohort B2 routes use the canonical Admin shell", () => {
  for (const pathname of ["/admin/vendors", "/admin/evaluations"]) {
    assert.equal(resolveShellMode(pathname), "canonical-admin");
  }

  assert.equal(resolveShellMode("/admin/vendors/access"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/vendors/access/history"), "legacy");
  assert.equal(resolveShellMode("/admin/events"), "legacy");
  assert.equal(resolveShellMode("/admin/login"), "exception");
  assert.equal(resolveShellMode("/admin/print"), "exception");
  assert.equal(
    resolveShellMode("/admin/reports/coach-plates/print"),
    "exception",
  );
  assert.equal(
    resolveShellMode("/admin/reports/name-tags/print"),
    "exception",
  );
});

test("Admin shell Cohort 1 authority routes use the canonical Admin shell", () => {
  for (const pathname of [
    "/admin/admin-users",
    "/admin/event-staff",
    "/admin/permissions",
  ]) {
    assert.equal(resolveShellMode(pathname), "canonical-admin");
  }
});

test("Admin Dashboard uses the canonical Admin shell", () => {
  assert.equal(resolveShellMode("/admin/dashboard"), "canonical-admin");

  for (const pathname of [
    "/admin/checklist",
    "/admin/checkin",
    "/admin/evaluations",
    "/admin/events/new",
    "/admin/export",
    "/admin/print-settings",
    "/admin/vendor-requests",
    "/admin/vendors",
    "/admin/vendors/access",
  ]) {
    assert.equal(resolveShellMode(pathname), "canonical-admin");
  }

  assert.equal(resolveShellMode("/admin/events"), "legacy");
  assert.equal(resolveShellMode("/admin/login"), "exception");
  assert.equal(resolveShellMode("/admin/print"), "exception");
  assert.equal(
    resolveShellMode("/admin/reports/coach-plates/print"),
    "exception",
  );
  assert.equal(
    resolveShellMode("/admin/reports/name-tags/print"),
    "exception",
  );
});

test("Admin Photos, Photo Library, and Slideshow use the canonical Admin shell while the audience viewer stays an exception", () => {
  assert.equal(resolveShellMode("/admin/photos"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/photo-library"), "canonical-admin");
  assert.equal(resolveShellMode("/admin/slideshow"), "canonical-admin");
  assert.equal(resolveShellMode("/slideshow/view"), "exception");

  for (const pathname of [
    "/admin/checklist",
    "/admin/checkin",
    "/admin/dashboard",
    "/admin/evaluations",
    "/admin/events/new",
    "/admin/export",
    "/admin/print-settings",
    "/admin/vendor-requests",
    "/admin/vendors",
    "/admin/vendors/access",
  ]) {
    assert.equal(resolveShellMode(pathname), "canonical-admin");
  }
});
