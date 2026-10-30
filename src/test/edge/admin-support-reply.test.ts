/**
 * Owner request 2026-10-23 (via the lead): Admin Support had only Resolve /
 * Dismiss, so the owner could not answer a member who wrote in. An admin's
 * reply now reaches the ticket's REPORTER in the app and by email, is recorded
 * on the ticket, and nothing reaches anyone else.
 *
 * @mutate supabase/functions/admin-support-reply/index.ts |     if (!isAdmin) return json({ error: 'Forbidden' }, 403) |
 * @mutate supabase/functions/admin-support-reply/index.ts | user_id: memberId, // the ticket's reporter | user_id: body?.userId ?? memberId, // the ticket's reporter
 * @mutate supabase/functions/admin-support-reply/index.ts |     if (replyError \|\| !insertedId) { |     if (replyError) {
 * @mutate supabase/functions/admin-support-reply/index.ts |         .eq('status', 'pending') |
 * @mutate supabase/functions/admin-support-reply/index.ts |     if (!memberId && !guest) { |     if (false) {
 * @mutate supabase/functions/admin-support-reply/index.ts |            footerNote: guest\n |            footerNote: undefined && guest\n
 * @mutate supabase/functions/admin-support-reply/index.ts |            ctaLabel: guest ? 'Write back to us' : 'Reply in the app', |            ctaLabel: 'Open Helpr support',
 * @mutate supabase/functions/admin-support-reply/index.ts |                ? `${appUrl}/messages?teamThread=${memberId}&userId=${adminId}` |                ? `${appUrl}/support`
 * @mutate supabase/functions/admin-support-reply/index.ts |     const guest = !memberId && ticket.reported_id === SUPPORT_GUEST_REPORTED_ID |     const guest = !memberId
 * @mutate supabase/functions/admin-support-reply/index.ts |     let mailTo: string \| null = guest?.email ?? null |     let mailTo: string \| null = null
 * @mutate supabase/functions/admin-support-reply/index.ts |     const subject = guest ? '' : subjectOf(ticket.reason) |     const subject = subjectOf(ticket.reason)
 * @mutate supabase/functions/admin-support-reply/index.ts |       // A guest has no account to tell: the email below is the reply.\n      if (memberId) { |       // A guest has no account to tell: the email below is the reply.\n      if (true) {
 * @mutate supabase/functions/admin-support-reply/index.ts |     if (!ticket \|\| ticket.reported_type !== 'support') { |     if (!ticket) {
 * @mutate supabase/functions/admin-support-reply/index.ts |       mailTo = member.email && emailConfirmed ? member.email : null |       mailTo = member.email ?? null
 * @mutate supabase/functions/admin-support-reply/index.ts | .replace(/\s+/g, ' ').trim().slice(0, 120).trim() | .trim()
 * @mutate supabase/functions/admin-support-reply/index.ts |         if (!threadMessageId && !notificationId && !emailQueued) { |         if (false) {
 * @mutate supabase/functions/admin-support-reply/index.ts | outcome_recorded: !failedPartWay && outcomeOk } | outcome_recorded: !failedPartWay }
 * @mutate supabase/functions/admin-support-reply/index.ts |           ...(emailResult.ok ? {} : { email_skip_reason: 'not_queued' }), |
 * @mutate supabase/functions/admin-support-reply/index.ts |       if (notificationId) await recordOutcome({ notification_id: notificationId }, 'notice') |
 * @mutate supabase/functions/admin-support-reply/index.ts |       threadMessageId = (threadRow as { id?: string } \| null)?.id ?? null |       threadMessageId = null
 * @mutate supabase/functions/admin-support-reply/index.ts |         global: { headers: { Authorization: authHeader } }, |         global: { headers: {} },
 * @mutate supabase/functions/admin-support-reply/index.ts |       if (!threadMessageId) { |       if (true) {
 * @mutate supabase/functions/admin-support-reply/index.ts |         p_client_id: replyId, |         p_client_id: null,
 * @mutate supabase/functions/admin-support-reply/index.ts |           from: FROM_SUPPORT, |
 * @mutate supabase/functions/admin-support-reply/index.ts |             signOff: '— Louisiana Helpr Team', |
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { emailRenders, FROM_SUPPORT, queueEmail, queuedEmails, renderEmail, resetEmailMocks } from "./mocks/email";

const ADMIN = { id: "admin-1", email: "owner@test.com", email_confirmed_at: "2026-01-01T00:00:00Z" };
const TICKET = "11111111-2222-4333-8444-555555555555";
const MEMBER = "member-1";

async function call(body: Record<string, unknown>) {
  const fn = await loadEdgeFunction("admin-support-reply");
  const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer admin-jwt" }, body }));
  return { res, body: JSON.parse(await res.text()) as Record<string, unknown> };
}

const writesTo = (table: string, op?: string) =>
  scenario.writes.filter((w) => w.table === table && (!op || w.op === op));
const outcomeWrites = () => writesTo("support_replies", "update").map((w) => w.payload);

const GUEST_RESET = () => {
  scenario.reads.reports = {
    rows: [{
      id: TICKET, reporter_id: null, reported_type: "support", reported_id: "00000000-0000-0000-0000-000000000000",
      reason: "[Issue Report] Guest message", status: "pending",
      description: "Subject: BUY NOW cheap.example\n\nHelp\n\n(Submitted from /support)\n\nGuest: Dana Guest <dana@bayoumail.net>",
    }],
  };
  scenario.reads.profiles = { rows: [] };
};

describe("admin-support-reply", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" });
    scenario.authUser = ADMIN;
    scenario.rpc.has_role = true;
    scenario.reads.reports = {
      rows: [{ id: TICKET, reporter_id: MEMBER, reported_type: "support", reason: "[Issue Report] App freezes", status: "pending" }],
    };
    scenario.reads.profiles = { rows: [{ user_id: MEMBER, full_name: "Lucy Malveaux", email: "lucy@example.com" }] };
    scenario.writeSelectRows["support_replies:insert"] = [{ id: "reply-1" }];
    scenario.writeSelectRows["notifications:insert"] = [{ id: "notice-1" }];
  });

  describe("a guest's ticket (owner 2026-10-30: answered in the app, not by hand)", () => {
    beforeEach(GUEST_RESET);

    it("records the reply in the ticket's thread and queues it to the address on the ticket, from the team", async () => {
      const { res, body } = await call({ reportId: TICKET, message: "We reset it." });
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ success: true, guest: true, email_queued: true, has_email: true, notified: false, outcome_recorded: true });
      expect(writesTo("support_replies", "insert")[0].payload).toMatchObject({ report_id: TICKET, admin_id: ADMIN.id, body: "We reset it." });
      expect(queuedEmails).toHaveLength(1);
      expect(queuedEmails[0]).toMatchObject({ to: "dana@bayoumail.net", from: FROM_SUPPORT, templateName: "admin_support_reply" });
    });

    it("the address comes from the ticket, never the request", async () => {
      await call({ reportId: TICKET, message: "Hi", email: "other@bayoumail.net", to: "other@bayoumail.net" });
      expect(queuedEmails[0].to).toBe("dana@bayoumail.net");
    });

    it("no in-app step: no account is written to or looked up", async () => {
      await call({ reportId: TICKET, message: "Hi" });
      expect(writesTo("notifications")).toEqual([]);
      expect(scenario.rpcCalls?.some((c) => c.name === "admin_send_team_message")).toBe(false);
    });

    it("the mail carries the admin's words and a link back, and nothing the guest typed", async () => {
      await call({ reportId: TICKET, message: "We reset it." });
      expect(queuedEmails[0].subject).toBe("A reply from Helpr support");
      const props = (emailRenders[0] as { props: { paragraphs: unknown[]; ctaUrl: string; greetingName: string } }).props;
      expect(JSON.stringify(props.paragraphs)).toContain("We reset it.");
      expect(JSON.stringify(props)).not.toContain("BUY NOW");
      expect(props.ctaUrl).toMatch(/\/support\?subject=/);
      expect(props.greetingName).toBe("Dana");
    });

    it("the guest's link is the support form with their ticket noted, and nobody is told to reply by email", async () => {
      await call({ reportId: TICKET, message: "Hi" });
      const { ctaUrl, ctaLabel, footerNote } = (emailRenders[0] as { props: { ctaUrl: string; ctaLabel: string; footerNote: string } }).props;
      expect(ctaUrl).toMatch(/\/support\?subject=Follow-up%20on%20ticket%2011111111$/);
      expect(ctaLabel).toBe("Write back to us");
      expect(footerNote).not.toMatch(/reply to this email/i);
    });

    it("a typed name that is not a plain first name is not repeated in the mail", async () => {
      scenario.reads.reports.rows![0].description = "Help\n\nGuest: cheap.example/win Now <dana@bayoumail.net>";
      await call({ reportId: TICKET, message: "Hi" });
      expect((emailRenders[0] as { props: { greetingName: string } }).props.greetingName).toBe("there");
    });

    it("resolve on send works once the email is queued", async () => {
      scenario.writeSelectRows["reports:update"] = [{ id: TICKET }];
      const { body } = await call({ reportId: TICKET, message: "Done", resolve: true });
      expect(body).toMatchObject({ resolve: "resolved", resolved: true });
    });

    it("the audit row says it went to a guest", async () => {
      await call({ reportId: TICKET, message: "Hi" });
      expect((writesTo("admin_audit_log")[0].payload as { details: Record<string, unknown> }).details).toMatchObject({ guest: true, member_id: null, email_queued: true });
    });

    it("a deleted member who once typed a guest line is not a guest: reported_id is not the guest id, so nothing is sent", async () => {
      scenario.reads.reports.rows![0].reported_id = "22222222-3333-4444-8555-666666666666";
      const { res } = await call({ reportId: TICKET, message: "Hi" });
      expect(res.status).toBe(409);
      expect(queuedEmails).toEqual([]);
      expect(writesTo("support_replies")).toEqual([]);
    });
  });

  it("a member's email says Reply in the app, links to the support thread when it landed, and never says reply by email", async () => {
    scenario.rpc.admin_send_team_message = { id: "msg-1", created_at: "2026-10-29T12:00:00Z" };
    await call({ reportId: TICKET, message: "Hi" });
    const { ctaUrl, ctaLabel, footerNote } = (emailRenders[0] as { props: { ctaUrl: string; ctaLabel: string; footerNote: string } }).props;
    expect(ctaLabel).toBe("Reply in the app");
    expect(ctaUrl).toMatch(new RegExp(`/messages\\?teamThread=${MEMBER}&userId=${ADMIN.id}$`));
    expect(footerNote).toMatch(/reply in the app/i);
    expect(footerNote).not.toMatch(/reply to this email/i);
  });

  it("a member whose thread message failed still gets a link that works in the app", async () => {
    await call({ reportId: TICKET, message: "Hi" });
    expect((emailRenders[0] as { props: { ctaUrl: string } }).props.ctaUrl).toMatch(/\/support$/);
  });

  it("records the reply, tells the REPORTER in the app and by email, and audits it", async () => {
    const { res, body } = await call({ reportId: TICKET, message: "  Thanks Lucy.\nWe fixed it.  " });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      success: true, reply_id: "reply-1", notified: true, email_queued: true, has_email: true,
      resolved: false, resolve: "not_requested", outcome_recorded: true,
    });

    expect(writesTo("support_replies", "insert")[0].payload).toEqual({
      report_id: TICKET, admin_id: "admin-1", body: "Thanks Lucy.\nWe fixed it.", resolved_on_send: false,
    });
    const notice = writesTo("notifications", "insert");
    expect(notice).toHaveLength(1);
    expect(notice[0].payload).toMatchObject({
      user_id: MEMBER, title: "Louisiana Helpr Team replied", type: "info", link: "/support",
      message: 'About "App freezes": Thanks Lucy.\nWe fixed it.',
    });
    expect(queuedEmails).toHaveLength(1);
    expect(queuedEmails[0]).toMatchObject({
      to: "lucy@example.com", subject: "Re: App freezes", templateName: "admin_support_reply", replyTo: "admin@louisianahelpr.test",
    });
    // Each outcome is recorded as soon as it is known, then the reply is closed out.
    expect(outcomeWrites()).toEqual([
      { notification_id: "notice-1" },
      { email_message_id: "queued-mock-id" },
      { resolved_on_send: false, outcome_recorded: true },
    ]);
    expect(writesTo("admin_audit_log", "insert")[0].payload).toMatchObject({
      admin_id: "admin-1", action: "support_reply", target_type: "report", target_id: TICKET,
    });
    expect(writesTo("reports")).toHaveLength(0);
  });

  it("never reaches anyone but the ticket's reporter, whatever the request names", async () => {
    await call({ reportId: TICKET, message: "Hi", userId: "someone-else", email: "attacker@example.com", to: "x@example.com" });
    expect(writesTo("notifications", "insert").map((w) => (w.payload as { user_id: string }).user_id)).toEqual([MEMBER]);
    expect(queuedEmails.map((e) => e.to)).toEqual(["lucy@example.com"]);
  });

  it("a caller who is not an admin is refused and nothing is written or sent", async () => {
    scenario.rpc.has_role = false;
    const { res } = await call({ reportId: TICKET, message: "Hi" });
    expect(res.status).toBe(403);
    expect(scenario.writes).toEqual([]);
    expect(queuedEmails).toEqual([]);
  });

  it("an unreadable admin check fails closed (503)", async () => {
    scenario.rpcErrors = { has_role: { message: "boom" } };
    const { res } = await call({ reportId: TICKET, message: "Hi" });
    expect(res.status).toBe(503);
    expect(scenario.writes).toEqual([]);
  });

  it("no reply is sent unless it is recorded first", async () => {
    scenario.writeSelectRows["support_replies:insert"] = [];
    const { res, body } = await call({ reportId: TICKET, message: "Hi" });
    expect(res.status).toBe(500);
    expect(String(body.error)).toMatch(/Nothing was sent/);
    expect(writesTo("notifications")).toEqual([]);
    expect(queuedEmails).toEqual([]);
  });

  it("an in-app notice that lands zero rows is reported as not delivered; the email still goes", async () => {
    scenario.writeSelectRows["notifications:insert"] = [];
    const { body } = await call({ reportId: TICKET, message: "Hi" });
    expect(body).toMatchObject({ success: true, notified: false, email_queued: true });
    expect(outcomeWrites().some((p) => "notification_id" in (p as object))).toBe(false);
  });

  it("a member with no address on file gets the in-app notice; the answer says no email went", async () => {
    scenario.reads.profiles = { rows: [{ user_id: MEMBER, full_name: "Lucy", email: null }] };
    const { body } = await call({ reportId: TICKET, message: "Hi" });
    expect(body).toMatchObject({ success: true, notified: true, email_queued: false, has_email: false });
    expect(queuedEmails).toEqual([]);
    expect(outcomeWrites()).toContainEqual({ email_skip_reason: "no_address" });
  });

  it("an UNCONFIRMED address is never mailed: in-app only, and the answer says why (lh-authz-rls r1 #1)", async () => {
    scenario.adminUsers = { [MEMBER]: { email: "lucy@example.com", email_confirmed_at: null } };
    const { body } = await call({ reportId: TICKET, message: "Hi" });
    expect(body).toMatchObject({ success: true, notified: true, email_queued: false, email_unconfirmed: true });
    expect(queuedEmails).toEqual([]);
    expect(outcomeWrites()).toContainEqual({ email_skip_reason: "unconfirmed" });
  });

  it("an unreadable auth record fails closed (503) before anything is recorded or sent", async () => {
    scenario.adminUsers = { [MEMBER]: { error: { message: "boom" } } };
    const { res } = await call({ reportId: TICKET, message: "Hi" });
    expect(res.status).toBe(503);
    expect(scenario.writes).toEqual([]);
    expect(queuedEmails).toEqual([]);
  });

  it("a multi-line or over-long ticket subject reaches the email as one line of at most 120 characters (r1 #2)", async () => {
    scenario.reads.reports = { rows: [{ id: TICKET, reporter_id: MEMBER, reported_type: "support", reason: `[Other] Line one\r\nBcc: x@evil.test ${"y".repeat(300)}`, status: "pending" }] };
    await call({ reportId: TICKET, message: "Hi" });
    const subject = String(queuedEmails[0].subject);
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject.length).toBeLessThanOrEqual("Re: ".length + 120);
    expect(subject.startsWith("Re: Line one Bcc: x@evil.test y")).toBe(true);
  });

  it("resolve on send moves only a PENDING ticket to resolved", async () => {
    scenario.writeSelectRows["reports:update"] = [{ id: TICKET }];
    const { body } = await call({ reportId: TICKET, message: "Done", resolve: true });
    expect(body.resolved).toBe(true);
    const w = writesTo("reports", "update");
    expect(w).toHaveLength(1);
    expect(w[0].payload).toEqual({ status: "resolved" });
    expect(w[0].filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: "id", value: TICKET }),
      expect.objectContaining({ column: "status", value: "pending" }),
    ]));
    expect(body.resolve).toBe("resolved");
    expect(outcomeWrites().slice(-1)[0]).toEqual({ resolved_on_send: true, outcome_recorded: true });
  });

  it("resolve on a ticket another admin already closed says so (lh-silent-failure r1 #3)", async () => {
    scenario.writeSelectRows["reports:update"] = [];
    const { body } = await call({ reportId: TICKET, message: "Done", resolve: true });
    expect(body).toMatchObject({ success: true, resolved: false, resolve: "already_closed" });
  });

  it("a failed resolve is reported, not dropped (r1 #3)", async () => {
    scenario.writeErrors.reports = { message: "boom" };
    const { body } = await call({ reportId: TICKET, message: "Done", resolve: true });
    expect(body).toMatchObject({ success: true, resolved: false, resolve: "error" });
  });

  it("a reply that reached NO ONE never resolves the ticket (r1 #4)", async () => {
    scenario.writeSelectRows["notifications:insert"] = [];
    scenario.reads.profiles = { rows: [{ user_id: MEMBER, full_name: "Lucy", email: null }] };
    const { body } = await call({ reportId: TICKET, message: "Done", resolve: true });
    expect(body).toMatchObject({ success: true, notified: false, email_queued: false, resolve: "skipped_undelivered", resolved: false });
    expect(writesTo("reports")).toEqual([]);
  });

  it("a delivery record that does not save is told to the admin (outcome_recorded false) (r1 #1a)", async () => {
    scenario.writeSelectRows["support_replies:update"] = [];
    const { body } = await call({ reportId: TICKET, message: "Hi" });
    expect(body).toMatchObject({ success: true, notified: true, email_queued: true, outcome_recorded: false });
  });

  it("stopping part-way after the reply is recorded: 500 naming the reply, the outcome left unrecorded, the audit still written (r1 #1b)", async () => {
    renderEmail.mockRejectedValueOnce(new Error("render blew up"));
    const { res, body } = await call({ reportId: TICKET, message: "Hi" });
    expect(res.status).toBe(500);
    expect(body).toMatchObject({ reply_id: "reply-1" });
    expect(String(body.error)).toMatch(/Check the replies on this ticket before sending again/);
    // The notice that DID land is on the record; the reply is not marked finished.
    expect(outcomeWrites()).toEqual([{ notification_id: "notice-1" }, { resolved_on_send: false, outcome_recorded: false }]);
    expect(writesTo("admin_audit_log", "insert")[0].payload).toMatchObject({ details: expect.objectContaining({ failed_part_way: true, notified: true }) });
  });

  it("a lost NOTICE record leaves the reply unfinished, never 'not delivered' (lh-silent-failure r2 #1)", async () => {
    scenario.writeOverrides = [{ table: "support_replies", op: "update", when: (p) => "notification_id" in p, rows: [] }];
    const { body } = await call({ reportId: TICKET, message: "Hi" });
    expect(body).toMatchObject({ success: true, notified: true, outcome_recorded: false });
    expect(outcomeWrites().slice(-1)[0]).toEqual({ resolved_on_send: false, outcome_recorded: false });
  });

  it("a failed enqueue is stored on the reply as not_queued (r2 #3)", async () => {
    queueEmail.mockResolvedValueOnce({ ok: false, messageId: "m-failed", error: "queue down" } as never);
    const { body } = await call({ reportId: TICKET, message: "Hi" });
    expect(body).toMatchObject({ success: true, email_queued: false });
    expect(outcomeWrites()).toContainEqual({ email_message_id: "m-failed", email_skip_reason: "not_queued" });
    expect(writesTo("admin_audit_log", "insert")[0].payload).toMatchObject({ details: expect.objectContaining({ email_skip_reason: "not_queued" }) });
  });

  it("a resolve that never ran because sending stopped is audited as not attempted (r2 #4)", async () => {
    renderEmail.mockRejectedValueOnce(new Error("render blew up"));
    await call({ reportId: TICKET, message: "Hi", resolve: true });
    expect(writesTo("admin_audit_log", "insert")[0].payload).toMatchObject({ details: expect.objectContaining({ resolve: "not_attempted" }) });
    expect(writesTo("reports")).toEqual([]);
  });

  it("a lost audit row pages ops", async () => {
    scenario.writeSelectRows["admin_audit_log:insert"] = [];
    await call({ reportId: TICKET, message: "Hi" });
    expect(slackAlerts).toHaveLength(1);
    expect(slackAlerts[0]).toMatchObject({ title: "Admin action left no audit trail" });
  });

  it("a ticket whose member deleted their account is refused (409), nothing written", async () => {
    scenario.reads.reports = { rows: [{ id: TICKET, reporter_id: null, reported_type: "support", reason: "[Other] x", status: "pending" }] };
    const { res } = await call({ reportId: TICKET, message: "Hi" });
    expect(res.status).toBe(409);
    expect(scenario.writes).toEqual([]);
    expect(queuedEmails).toEqual([]);
  });

  it("only SUPPORT tickets can be answered: a user/job report is refused (404)", async () => {
    scenario.reads.reports = { rows: [{ id: TICKET, reporter_id: MEMBER, reported_type: "user", reason: "harassment", status: "pending" }] };
    const { res } = await call({ reportId: TICKET, message: "Hi" });
    expect(res.status).toBe(404);
    expect(scenario.writes).toEqual([]);
  });

  // Owner 2026-10-29 (B61): five support replies queued 2026-10-27 reached no
  // one's inbox (dead-lettered) and nothing of them was in the members'
  // Messages: support_replies + a bell notice to /support was the whole in-app
  // half. A reply is now written into the member's "Louisiana Helpr Team"
  // thread FIRST, as the admin who wrote it, and the email follows.
  describe("the reply lands in the member's support thread before the email", () => {
    const THREAD_LINK = `/messages?teamThread=${MEMBER}&userId=admin-1`;
    beforeEach(() => {
      scenario.rpc.admin_send_team_message = { id: "msg-1", created_at: "2026-10-29T12:00:00Z" };
      scenario.reads.notifications = { rows: [{ id: "thread-notice-1", user_id: MEMBER, link: THREAD_LINK }] };
    });

    it("writes the thread message as the admin (their own JWT), then queues the email", async () => {
      let rpcCallsWhenEmailQueued = -1;
      queueEmail.mockImplementationOnce((async () => {
        rpcCallsWhenEmailQueued = (scenario.rpcCalls ?? []).filter((c) => c.name === "admin_send_team_message").length;
        return { ok: true, messageId: "queued-mock-id" };
      }) as never);
      const { body } = await call({ reportId: TICKET, message: "  Thanks Lucy.\nWe fixed it.  " });
      const sends = (scenario.rpcCalls ?? []).filter((c) => c.name === "admin_send_team_message");
      expect(sends).toHaveLength(1);
      expect(sends[0].args).toEqual({ p_user_id: MEMBER, p_content: 'About "App freezes":\n\nThanks Lucy.\nWe fixed it.', p_client_id: "reply-1" });
      // On a client carrying the ADMIN's token, so the message's sender is that admin.
      const client = scenario.clients?.[sends[0].client ?? -1];
      expect(JSON.stringify(client?.options ?? {})).toContain("Bearer admin-jwt");
      expect(rpcCallsWhenEmailQueued).toBe(1);
      expect(body).toMatchObject({ success: true, in_thread: true, notified: true, email_queued: true });
    });

    it("the thread message's own notice is the in-app notice: no second /support notice", async () => {
      const { body } = await call({ reportId: TICKET, message: "Hi" });
      expect(writesTo("notifications", "insert")).toEqual([]);
      expect(outcomeWrites()[0]).toEqual({ notification_id: "thread-notice-1" });
      expect(body).toMatchObject({ notified: true, in_thread: true });
    });

    it("a thread message that fails falls back to the /support notice, and the email still goes", async () => {
      scenario.rpcErrors = { admin_send_team_message: { message: "rate_limited" } };
      const { body } = await call({ reportId: TICKET, message: "Hi" });
      expect(writesTo("notifications", "insert")).toHaveLength(1);
      expect(body).toMatchObject({ success: true, in_thread: false, notified: true, email_queued: true });
      expect(writesTo("admin_audit_log", "insert")[0].payload).toMatchObject({
        details: expect.objectContaining({ in_thread: false, thread_message_id: null }),
      });
    });

    it("a reply too long to carry the subject line goes into the thread as written", async () => {
      const long = "x".repeat(3990);
      await call({ reportId: TICKET, message: long });
      const sends = (scenario.rpcCalls ?? []).filter((c) => c.name === "admin_send_team_message");
      expect((sends[0].args as { p_content: string }).p_content).toBe(long);
    });
  });

  // Owner 2026-10-29 (B61): a reply speaks for the team, never as one admin.
  // In the app the team thread already shows "Louisiana Helpr Team" with the
  // team avatar on the member's side (loadConversations) and the message notice
  // is titled the same (notify_message_recipient); the email and the fallback
  // notice now say so too.
  it("the email comes From Louisiana Helpr Support and is signed by the Louisiana Helpr Team", async () => {
    await call({ reportId: TICKET, message: "Hi" });
    expect(queuedEmails[0].from).toBe(FROM_SUPPORT);
    const props = (emailRenders[0] as { props: Record<string, unknown> }).props;
    expect(props.title).toBe("Louisiana Helpr Team replied");
    expect(props.signOff).toBe("— Louisiana Helpr Team");
    expect(JSON.stringify(props)).not.toContain("owner@test.com");
  });

  it("an empty, over-long or ticketless request is refused before anything is read or written", async () => {
    for (const body of [{ reportId: TICKET, message: "   " }, { reportId: TICKET, message: "x".repeat(4001) }, { reportId: "nope", message: "Hi" }]) {
      const { res } = await call(body);
      expect(res.status).toBe(400);
    }
    expect(scenario.writes).toEqual([]);
  });
});
