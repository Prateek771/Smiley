import assert from "node:assert/strict";
import { test } from "node:test";
import { branchScope } from "../../src/server/access/permissions";
import type { StaffSession } from "../../src/server/auth";

const actor: StaffSession = {
  authUserId: "synthetic", userId: "1", hospitalId: "1", email: "synthetic@smiley.test", name: "Synthetic",
  roles: ["INSURANCE_EXECUTIVE", "REPORT_USER"], branchIds: ["1", "2"],
  branchRoles: [{ branchId: "1", role: "INSURANCE_EXECUTIVE" }, { branchId: "2", role: "REPORT_USER" }],
};
test("write authority never combines a desk role in one branch with a read-only grant in another", () => {
  assert.deepEqual(branchScope(actor, "case:read"), ["1", "2"]);
  for (const permission of ["case:write", "case:act", "document:write"] as const) {
    assert.deepEqual(branchScope(actor, permission), ["1"]);
  }
});
test("platform metadata role grants no default patient or case scope", () => {
  assert.deepEqual(branchScope({ ...actor, roles: ["SUPER_ADMIN", "INSURANCE_EXECUTIVE"] }, "case:read"), []);
});
test("Billing, Finance and auditor grants read evidence but cannot prepare cases", () => {
  for (const role of ["BILLING_OFFICER", "FINANCE_OFFICER", "REPORT_USER"]) {
    const viewer = { ...actor, roles: [role], branchRoles: [{ branchId: "1", role }] };
    assert.deepEqual(branchScope(viewer, "document:read"), ["1"]);
    assert.deepEqual(branchScope(viewer, "case:write"), []);
  }
});
