import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeReportDataStatusFilter,
  normalizeStoredReportPresets,
} from "@/components/admin/reports/reportPresets";

test("stale Locked report presets normalize to All Statuses instead of retaining an inaccessible filter", () => {
  assert.equal(normalizeReportDataStatusFilter("locked"), "all");

  const [preset] = normalizeStoredReportPresets([
    {
      id: "preset-1",
      name: "Legacy Locked",
      reportType: "all_attendees",
      sortType: "name_asc",
      participantTypeFilter: "all",
      dataStatusFilter: "locked" as never,
    },
  ]);

  assert.equal(preset.dataStatusFilter, "all");
});
