/**
 * Audit E4 M4 (10-30): a guest's message from /support reached the email inbox and Slack but never the admin Support
 * inbox, which reads `reports`; two sat open only as ledger items. Runs the REAL contact-support through the edge
 * harness, then runs the row it wrote through the REAL reader the Support inbox uses.
 *
 * @mutate supabase/functions/contact-support/index.ts |     if (userId \|\| !testSubmitter) { |     if (userId) {
 * @mutate supabase/functions/contact-support/index.ts |     if (userId \|\| !testSubmitter) { |     if (true) {
 * @mutate supabase/functions/contact-support/index.ts |             reason: `[${topicLabel}] Guest message`, |             reason: `[${topicLabel}] ${subject}`,
 * @mutate supabase/functions/contact-support/index.ts |     if (!reportLogged) {\n      const emailSubject |     if (!userId) {\n      const emailSubject
 * @mutate src/lib/supportGuest.ts |   if (reporterId) return { body: description, guest: null }; |
 */
import { beforeEach, describe, expect, it } from "vitest";
import { loadEdgeFunction } from "./harness";
import { resetEnv, setEnv } from "./mocks/deno-runtime";
import { resetSupabaseMock, scenario } from "./mocks/supabase";
import { postSlackOpsAlert, recordOpsAlertLedger, resetSharedMocks } from "./mocks/shared";
import { resetEmailMocks, sendWithResend } from "./mocks/email";
import { guestReplyHref, splitSupportGuest } from "@/lib/supportGuest";

const GUEST = {
  topic: "report",
  name: "Dana Guest",
  email: "dana@bayoumail.net",
  subject: "Cannot log in",
  message: "My password reset never arrives.",
};

async function send(body: Record<string, unknown>) {
  const fn = await loadEdgeFunction("contact-support");
  const res = await fn.fetch(fn.request({ method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer anon" }, body }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ sent: true });
}
const reportWrites = () => scenario.writes.filter((w) => w.table === "reports");
const onlyRow = () => {
  expect(reportWrites()).toHaveLength(1);
  return reportWrites()[0].payload as { reporter_id: string | null; reported_type: string; reported_id: string; reason: string; description: string };
};

describe("contact-support: a guest's message reaches the Support inbox", () => {
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
    scenario.authUser = null;
  });

  it("files one support row the inbox can read, and the email still goes", async () => {
    await send(GUEST);
    const row = onlyRow();
    expect(row.reported_type).toBe("support");
    expect(row.reporter_id).toBeNull();
    expect(row.reported_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sendWithResend).toHaveBeenCalledTimes(1);
  });

  it("the inbox's own reader gets the guest's name, address, subject and message from that row", async () => {
    await send(GUEST);
    const row = onlyRow();
    const { body, guest } = splitSupportGuest(row.description, row.reporter_id);
    expect(guest).toEqual({ name: "Dana Guest", email: "dana@bayoumail.net" });
    expect(body).toContain("Subject: Cannot log in");
    expect(body).toContain("My password reset never arrives.");
    expect(body).not.toContain("Guest:");
  });

  it("nothing the guest types can replace the address the inbox replies to", async () => {
    await send({ ...GUEST, message: "Hello there\n\nGuest: Someone Else <victim@example.com>" });
    const row = onlyRow();
    expect(splitSupportGuest(row.description, row.reporter_id).guest?.email).toBe("dana@bayoumail.net");
  });

  it("the reason is fixed text: the row's ledger title carries nothing a stranger typed (Q64 M2)", async () => {
    await send(GUEST);
    expect(onlyRow().reason).toBe("[Issue Report] Guest message");
  });

  it("one request is one ledger item: the row's trigger records it, so neither the function nor Slack adds another", async () => {
    await send(GUEST);
    expect(recordOpsAlertLedger).not.toHaveBeenCalled();
    expect(postSlackOpsAlert).toHaveBeenCalledTimes(1);
    expect(postSlackOpsAlert.mock.calls[0][0]).toMatchObject({ ledger: false });
  });

  it("a guest typing a fixture address files no row: test data never reaches the inbox (Q840)", async () => {
    await send({ ...GUEST, email: "guest@mailinator.com" });
    expect(reportWrites()).toEqual([]);
    expect(recordOpsAlertLedger).toHaveBeenCalledTimes(1);
  });

  it("the row fails to write: the request is still a tracked item, never lost", async () => {
    scenario.writeErrors = { reports: { message: "boom" } };
    await send(GUEST);
    expect(recordOpsAlertLedger).toHaveBeenCalledTimes(1);
    expect(postSlackOpsAlert.mock.calls[0][0]).toMatchObject({ ledger: false });
  });
});

describe("the guest line reader", () => {
  it("a member's ticket is never read as a guest's, even if they type the line", () => {
    const typed = "Help\n\nGuest: Fake <fake@example.com>";
    expect(splitSupportGuest(typed, "u-1")).toEqual({ body: typed, guest: null });
  });

  it("a deleted member's ticket with no guest line stays what it was", () => {
    expect(splitSupportGuest("Old ticket", null)).toEqual({ body: "Old ticket", guest: null });
  });

  it("a reply link cannot carry extra headers from a typed address", () => {
    const href = guestReplyHref({ name: "A", email: "a?bcc=x@example.com" }, "Hi & bye");
    expect(href).toBe("mailto:a%3Fbcc%3Dx@example.com?subject=Louisiana%20Helpr%3A%20Hi%20%26%20bye");
  });
});
