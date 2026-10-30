/**
 * process-email-queue drains a backlog in one run, not 10 emails per 5 minutes.
 *
 * Measured on prod 2026-10-27 (read-only: email_send_log, cron_run_log, function logs):
 * the job-match fan-out enqueued 181 notification emails at 15:53Z. The worker read ONE
 * batch of 10 per queue per cron tick ('3-58/5 * * * *'), so it answered `processed: 10`
 * on every tick from 15:58 to 17:13. Four admin support replies (queued 15:58-16:01,
 * pgmq msg_id 2085-2088) and 26 welcome-drip emails (16:22) sat behind that backlog, and
 * when the worker reached them they were older than the 60-minute transactional TTL:
 * all 30 were dead-lettered ("TTL exceeded (60 minutes)") at 17:18-17:33Z, unsent.
 *
 * The worker now keeps reading batches while a full batch came back and its time budget
 * remains, so one tick clears a burst like that one.
 *
 * @mutate supabase/functions/process-email-queue/index.ts |       if (messages.length < batchSize) break | break
 * @mutate supabase/functions/process-email-queue/index.ts |     while (Date.now() - runStartedAt < DRAIN_BUDGET_MS) { |     for (let once = 0; once < 1; once++) {
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetEmailMocks, sendWithResend } from "./mocks/email";

const CRON = "cron-secret";

type QueuedMsg = { msg_id: number; read_ct: number; message: Record<string, unknown> };

function backlog(n: number, queuedAt: string): QueuedMsg[] {
  return Array.from({ length: n }, (_, i) => ({
    msg_id: 1000 + i,
    read_ct: 1,
    message: {
      message_id: `m-${i}`,
      to: `member${i}@gmail.com`,
      subject: "New job near you",
      html: "<p>hi</p>",
      text: "hi",
      label: "notification_job_matches",
      queued_at: queuedAt,
    },
  }));
}

async function tick() {
  const fn = await loadEdgeFunction("process-email-queue");
  return fn.fetch(fn.request({
    url: "https://edge.test/process-email-queue",
    headers: { Authorization: `Bearer ${CRON}` },
    body: {},
  }));
}

describe("process-email-queue drains a backlog in one run", () => {
  let queue: QueuedMsg[];

  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    sendWithResend.mockClear();
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      CRON_SECRET: CRON,
      RESEND_API_KEY: "re_test",
    });
    scenario.reads.email_send_state = {
      rows: [{ retry_after_until: null, batch_size: 10, send_delay_ms: 0, auth_email_ttl_minutes: 15, transactional_email_ttl_minutes: 60 }],
    };
    // No row says "already sent"; every recipient is a real-looking address.
    scenario.reads.email_send_log = { rows: [] };
    scenario.reads.profiles = { rows: [] };
    queue = backlog(45, new Date().toISOString());
    // pgmq read: the oldest `batch_size` visible messages of the named queue.
    scenario.rpc.read_email_batch = (a?: unknown) => {
      const { queue_name, batch_size } = a as { queue_name: string; batch_size: number };
      if (queue_name !== "transactional_emails") return [];
      return queue.slice(0, batch_size);
    };
    scenario.rpc.delete_email = (a?: unknown) => {
      const { message_id } = a as { message_id: number };
      queue = queue.filter((m) => m.msg_id !== message_id);
      return true;
    };
  });
  afterEach(() => resetEnv());

  it("sends all 45 queued emails in one tick (2026-10-27: it sent 10 and left 35 to age)", async () => {
    const res = await tick();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ processed: 45 });
    expect(sendWithResend).toHaveBeenCalledTimes(45);
    expect(queue).toEqual([]);
  });

  it("stops when a short batch says the queue is empty (no extra reads)", async () => {
    queue = backlog(7, new Date().toISOString());
    const res = await tick();
    expect(await res.json()).toMatchObject({ processed: 7 });
    const reads = (scenario.rpcCalls ?? []).filter((c) => c.name === "read_email_batch");
    // auth_emails once (empty), transactional_emails once (7 < 10, so done).
    expect(reads.map((c) => (c.args as { queue_name: string }).queue_name)).toEqual(["auth_emails", "transactional_emails"]);
  });
});
