/**
 * Owner 2026-10-30 (Get help now, CMP-3): a signed-in test account's support message never reaches admin: no email
 * to the support inbox, no admin-queue row, no ledger item, no Slack. Runs the REAL contact-support through the edge
 * harness. A real member gets all of them; a guest typing a fixture address keeps its ledger and Slack trail (Q840),
 * because anyone can type an address.
 *
 * @mutate supabase/functions/contact-support/index.ts |       if (testAccount) { |       if (false) {
 * @mutate supabase/functions/contact-support/index.ts |         testAccount = data === true |         testAccount = false
 * @mutate supabase/functions/contact-support/index.ts |     if (userId) {\n      let testAccount = testSubmitter |     if (true) {\n      let testAccount = testSubmitter
 * @mutate supabase/functions/contact-support/index.ts |         testAccount = data === true |         testAccount = data !== false
 */
import { beforeEach, describe, expect, it } from "vitest";
import { loadEdgeFunction } from "./harness";
import { resetEnv, setEnv } from "./mocks/deno-runtime";
import { resetSupabaseMock, scenario } from "./mocks/supabase";
import { postSlackOpsAlert, recordOpsAlertLedger, resetSharedMocks } from "./mocks/shared";
import { resetEmailMocks, sendWithResend } from "./mocks/email";

const FORM = { topic: "message", subject: 'Help with "Oak chair" (order #9d2c1b0a)', message: "Where is my pickup address please?" };

async function send(body: Record<string, unknown>, bearer = "Bearer user-jwt") {
  const fn = await loadEdgeFunction("contact-support");
  const res = await fn.fetch(fn.request({ method: "POST", headers: { "Content-Type": "application/json", Authorization: bearer }, body }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ sent: true });
}
const reportWrites = () => scenario.writes.filter((w) => w.table === "reports");

describe("contact-support: a test account never reaches admin", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    sendWithResend.mockClear();
    resetEnv();
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      SUPABASE_ANON_KEY: "anon",
      PUBLISHABLE_KEY: "anon",
      RESEND_API_KEY: "re_test",
    });
    scenario.authUser = { id: "u-1", email: "member@louisianahelpr.com" };
    scenario.reads.profiles = { rows: [{ full_name: "Dana Member", email: "member@louisianahelpr.com" }] };
  });

  it("a real member: the queue row and Slack go, with no admin@ copy (owner 10-30)", async () => {
    scenario.rpc.is_test_subject = false;
    await send(FORM);
    expect(sendWithResend).not.toHaveBeenCalled();
    expect(reportWrites()).toHaveLength(1);
    expect(postSlackOpsAlert).toHaveBeenCalledTimes(1);
  });

  it("a test account the address cannot give away (test_accounts): nothing reaches admin, and the member still sees sent", async () => {
    scenario.rpc.is_test_subject = true;
    await send(FORM);
    expect(scenario.rpcCalls).toContainEqual(expect.objectContaining({ name: "is_test_subject", args: { p_user_id: "u-1" } }));
    expect(sendWithResend).not.toHaveBeenCalled();
    expect(reportWrites()).toEqual([]);
    expect(recordOpsAlertLedger).not.toHaveBeenCalled();
    expect(postSlackOpsAlert).not.toHaveBeenCalled();
  });

  it("a signed-in fixture address: nothing reaches admin either", async () => {
    scenario.authUser = { id: "u-2", email: "x@mailinator.com" };
    scenario.reads.profiles = { rows: [{ full_name: "Fixture", email: "x@mailinator.com" }] };
    scenario.rpc.is_test_subject = false;
    await send(FORM);
    expect(sendWithResend).not.toHaveBeenCalled();
    expect(reportWrites()).toEqual([]);
    expect(postSlackOpsAlert).not.toHaveBeenCalled();
  });

  it("the test-account read fails: the sender counts as real, so a real request is never lost", async () => {
    scenario.rpcErrors = { is_test_subject: { message: "boom" } };
    await send(FORM);
    expect(reportWrites()).toHaveLength(1);
    expect(postSlackOpsAlert).toHaveBeenCalledTimes(1);
  });

  it("a guest typing a fixture address: not mailed, but the ledger and Slack trail stay (Q840)", async () => {
    scenario.authUser = null;
    await send({ ...FORM, name: "Guest Person", email: "guest@mailinator.com" }, "Bearer anon");
    expect(sendWithResend).not.toHaveBeenCalled();
    expect(recordOpsAlertLedger).toHaveBeenCalledTimes(1);
    expect(postSlackOpsAlert).toHaveBeenCalledTimes(1);
    expect(scenario.rpcCalls?.some((c) => c.name === "is_test_subject")).toBe(false);
  });
});
