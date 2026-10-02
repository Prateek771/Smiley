import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closePools } from "../../src/server/db/client";
import { workflowFixture } from "../helpers/workflow";
const origin = process.env.HTTP_TEST_ORIGIN!;
let fixture: Awaited<ReturnType<typeof workflowFixture>>; let item: Awaited<ReturnType<typeof fixture.approvedCase>>; const cookies = {} as Record<string, string>;
before(async () => {
  assert.equal(origin, "http://127.0.0.1:3216"); fixture = await workflowFixture(); item = await fixture.approvedCase();
  for (const role of ["deskA", "billingA", "financeA", "deskB"] as const) {
    const options = { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email: fixture.users[role].email, password: fixture.users[role].password }) };
    let response = await fetch(`${origin}/api/auth/sign-in/email`, options);
    if (role === "deskB") {
      assert.equal(response.status, 429, "the fourth rapid production login must remain throttled");
      assert.equal(response.headers.getSetCookie().length, 0);
      const retryAfter = Number(response.headers.get("x-retry-after"));
      assert.ok(Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 10);
      await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
      response = await fetch(`${origin}/api/auth/sign-in/email`, options);
    }
    assert.equal(response.status, 200); cookies[role] = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  }
}); after(closePools);
test("production login and staff pages expose role-appropriate financial, settlement and job controls", async () => {
  assert.match(await (await fetch(`${origin}/login`)).text(), /Work email/u);
  const guest = await fetch(`${origin}/desk`, { redirect: "manual" }); assert.equal(guest.status, 307); assert.match(guest.headers.get("location")!, /login/u);
  for (const role of ["deskA", "billingA", "financeA"]) {
    const response = await fetch(`${origin}/desk/cases/${item.caseId}`, { headers: { cookie: cookies[role] } }); assert.equal(response.status, 200);
    const html = await response.text(); for (const text of ["Bill and financial assessment", "Payer decision and patient reconciliation", "Settlement and remittance", "Background review jobs"]) assert.ok(html.includes(text), text);
    const controls = { deskA: "Record payer decision", billingA: "Billing confirmation", financeA: "Record remittance receipt" }; assert.ok(html.includes(controls[role as keyof typeof controls]));
  }
});
test("served APIs require scoped cookies and reject cross-origin mutations", async () => {
  const url = `${origin}/api/cases/${item.caseId}/financial`;
  assert.equal((await fetch(url)).status, 401); assert.equal((await fetch(url, { headers: { cookie: cookies.deskB } })).status, 404);
  const allowed = await fetch(url, { headers: { cookie: cookies.financeA } }); assert.equal(allowed.status, 200); assert.equal((await allowed.json()).patientConfirmedPaise, 800000);
  assert.equal((await fetch(url, { method: "POST", headers: { cookie: cookies.billingA, origin: "https://wrong.invalid", "content-type": "application/json" }, body: "{}" })).status, 403);
});
