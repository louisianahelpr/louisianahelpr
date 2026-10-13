/**
 * Q1731 (owner, 2026-10-12: "send one-time refund notices for the 2
 * pre-feature refunds"; the notice is in-app AND email).
 *
 * Measured on prod: the two one-time notices (jobs 5d43debf and 1e16c281)
 * were sent at 2026-10-12 23:25Z by a LOCAL script that called
 * sendRefundNotice with ~/louisianahelpr/.env's SUPABASE_SERVICE_ROLE_KEY, the
 * legacy service_role JWT. PostgREST accepted that key, so both refund_notices
 * claims and both in-app notices were written; send-notification-email
 * compares the bearer to its own key and answered 401 (function_edge_logs
 * 23:25:59Z, user-agent "node"), so neither email went, and the rows sat at
 * emailed=false for 19 hours until the emails were re-sent from the server.
 *
 * The class: any sender outside the edge runtime (the only kind that passes
 * `endpoint`) with a key the email function refuses. It must stop BEFORE it
 * claims or writes anything, and say why, never leave a half-sent notice.
 * The preflight relies on send-notification-email checking the bearer first
 * and answering an empty body 400 before it reads, logs or sends anything
 * (measured live 2026-10-13 18:3xZ through pg_net: the vault key with "{}"
 * answered 400 {"error":"Missing required fields"}, a wrong key 401), so the
 * second half of this file holds that order in the function's source.
 *
 * @mutate supabase/functions/_shared/refundNotice.ts |       if (refused) return { status: "failed", error: refused }; |       void refused;
 * @mutate supabase/functions/_shared/refundNotice.ts |     if (res.status === 400 && /Missing required fields/.test(text)) return null; |     if (res.status === 400 \|\| res.status === 401) return null;
 * @mutate supabase/functions/_shared/refundNotice.ts |       if (refused) {\n        out.problems.push(refused);\n        return out;\n      } |       if (refused) {\n        out.problems.push(refused);\n      }
 * @mutate supabase/functions/send-notification-email/index.ts |     const { notification_id, user_id, title, message, type, link, job_id } = await req.json() |     await supabase.rpc('log_notification', {}); const { notification_id, user_id, title, message, type, link, job_id } = await req.json()
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryFailedRefundEmails, sendRefundNotice } from "../../supabase/functions/_shared/refundNotice.ts";
import { blankComments } from "./helpers/blankNonCode";

type Call = { table: string; op: string; payload?: unknown };

/** A supabase-js stand-in: records every table touched, answers like prod would. */
function fakeClient() {
  const calls: Call[] = [];
  const job = {
    id: "5d43debf-6a0b-4a51-9686-a3e49b5dae0a", customer_id: "7f65ef12-1d3d-439b-b0a7-f42ce8bc176d",
    title: "Mow & Weed Eat Yard", status: "cancelled", cancellation_fee: "0", customer_fee_amount: "12",
    dispute_status: null, onboarding_fee_amount: null,
  };
  const client = {
    from(table: string) {
      let op = "select";
      let payload: unknown;
      const b: Record<string, unknown> = {};
      const chain = () => b;
      for (const m of ["select", "eq", "is", "ilike", "limit", "neq", "lt", "gte", "lte", "order", "not", "or"]) b[m] = chain;
      b.insert = (p: unknown) => { op = "insert"; payload = p; calls.push({ table, op, payload }); return b; };
      b.update = (p: unknown) => { op = "update"; payload = p; calls.push({ table, op, payload }); return b; };
      b.delete = () => { op = "delete"; calls.push({ table, op }); return b; };
      const answer = () => {
        if (op === "select") calls.push({ table, op });
        if (table === "jobs") return { data: job, error: null };
        if (table === "notifications" && op === "insert") return { data: [{ id: "notice-1" }], error: null };
        return { data: op === "select" ? null : [{ notice_key: "k" }], error: null };
      };
      b.maybeSingle = async () => answer();
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(answer()).then(res, rej);
      return b;
    },
    rpc: async () => ({ data: false, error: null }),
  };
  return { client, calls };
}

const INPUT = {
  key: "refund:re_3UOcZ8Kp2H4b7tEC1cVCF92O",
  kind: "refund" as const,
  paymentIntentId: "pi_3UOcZ8Kp2H4b7tEC15bAHH9d",
  amountCents: 10000,
  keptCents: 1200,
  jobId: "5d43debf-6a0b-4a51-9686-a3e49b5dae0a",
  method: { type: "link" },
  endpoint: { url: "https://fncmgoasalhdgfwzhsqa.supabase.co", key: "eyJ-legacy-service-role-jwt" },
};

/** send-notification-email as prod answers it: the bearer first, then the body. */
function emailFunction(acceptedKey: string) {
  const bodies: string[] = [];
  const fn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    if (auth !== `Bearer ${acceptedKey}`) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (!body.user_id || !body.title || !body.message) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }
    bodies.push(String(init?.body));
    return new Response(JSON.stringify({ success: true, delivery: "queued" }), { status: 200 });
  });
  return { fn, bodies };
}

describe("Q1731: a refund notice sent from outside the edge runtime never leaves an in-app notice without its email", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("the 10-12 case: a key the email function refuses stops the sender before it claims or writes anything", async () => {
    const { client, calls } = fakeClient();
    const email = emailFunction("sb_secret_the_edge_key");
    globalThis.fetch = email.fn as unknown as typeof fetch;

    const r = await sendRefundNotice(client, INPUT);

    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/refused this sender's key \(401\); nothing was written/);
    expect(calls.filter((c) => c.op !== "select")).toEqual([]);
    expect(calls).toEqual([]);
    expect(email.bodies).toEqual([]);
  });

  it("an email function that cannot send at all (500) also stops the sender first", async () => {
    const { client, calls } = fakeClient();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "Email service not configured" }), { status: 500 })) as unknown as typeof fetch;
    const r = await sendRefundNotice(client, INPUT);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/preflight answered 500/);
    expect(calls).toEqual([]);
  });

  it("a key the email function accepts: the preflight sends nothing, then ONE notice and ONE email go", async () => {
    const { client, calls } = fakeClient();
    const email = emailFunction(INPUT.endpoint.key);
    globalThis.fetch = email.fn as unknown as typeof fetch;

    const r = await sendRefundNotice(client, INPUT);

    expect(r).toMatchObject({ status: "sent", emailed: true });
    expect(email.fn).toHaveBeenCalledTimes(2); // the empty-body preflight, then the email
    expect(email.bodies).toHaveLength(1);
    expect(JSON.parse(email.bodies[0])).toMatchObject({ type: "payment", title: "Refund issued: $100", notification_id: "notice-1" });
    expect(calls.filter((c) => c.table === "notifications" && c.op === "insert")).toHaveLength(1);
    expect(calls.filter((c) => c.table === "refund_notices" && c.op === "insert")).toHaveLength(1);
  });

  it("an edge-runtime sender (no endpoint passed) is not preflighted: one call, the email", async () => {
    const { client } = fakeClient();
    const email = emailFunction("sb_secret_the_edge_key");
    globalThis.fetch = email.fn as unknown as typeof fetch;
    const g = globalThis as unknown as { Deno?: unknown };
    const hadDeno = "Deno" in g;
    const prevDeno = g.Deno;
    g.Deno = { env: { get: (k: string) => ({ SUPABASE_URL: "https://x.supabase.co", SECRET_KEY: "sb_secret_the_edge_key" } as Record<string, string>)[k] } };
    try {
      const r = await sendRefundNotice(client, { ...INPUT, endpoint: undefined });
      expect(r).toMatchObject({ status: "sent", emailed: true });
      expect(email.fn).toHaveBeenCalledTimes(1);
    } finally {
      if (hadDeno) g.Deno = prevDeno; else delete g.Deno;
    }
  });
});

/**
 * The retry run (retryFailedRefundEmails) with an explicit endpoint: a script
 * re-sending failed refund emails from a Mac with .env's legacy key used to
 * claim every notice's try, get 401 each time, and after its last allowed try page "gave up"
 * for every one (lh-silent-failure review of the Q1731 preflight, LOW). It now
 * asks the email function ONCE, before its loop, and stops before any claim.
 */
describe("Q1731: the failed-refund-email retry, run out of band, preflights once", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  const ROWS = [1, 2, 3].map((i) => ({
    notice_key: `refund:re_retry${i}`, user_id: "7f65ef12-1d3d-439b-b0a7-f42ce8bc176d", job_id: null,
    notification_id: `6ab00306-d7aa-4c2a-a8a8-a2c25794653${i}`, email_attempts: 1, email_error: "send-notification-email answered 401",
    created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  }));
  function retryClient() {
    const writes: Call[] = [];
    const client = {
      from(table: string) {
        let op = "select";
        const b: Record<string, unknown> = {};
        for (const m of ["select", "eq", "is", "ilike", "limit", "neq", "lt", "gte", "lte", "order", "not", "or"]) b[m] = () => b;
        b.update = (p: unknown) => { op = "update"; writes.push({ table, op, payload: p }); return b; };
        const answer = () => {
          if (table === "refund_notices" && op === "select") return { data: ROWS, error: null };
          if (table === "notifications") return { data: { id: "n", title: "Refund issued: $100", message: "We refunded $100.", link: null, job_id: null }, error: null };
          return { data: [{ notice_key: "k" }], error: null };
        };
        b.maybeSingle = async () => answer();
        b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(answer()).then(res, rej);
        return b;
      },
    };
    return { client, writes };
  }

  it("a refused key: ONE preflight, no claim on any notice, no email, no 'gave up', and it says why", async () => {
    const { client, writes } = retryClient();
    const email = emailFunction("sb_secret_the_edge_key");
    globalThis.fetch = email.fn as unknown as typeof fetch;
    const r = await retryFailedRefundEmails(client as never, { endpoint: INPUT.endpoint });
    expect(email.fn).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([]);
    expect(r.retried).toBe(0);
    expect(r.gaveUp).toEqual([]);
    expect(r.problems.join(" ")).toMatch(/refused this sender's key \(401\)/);
  });

  it("an accepted key: one preflight, then each notice is claimed and emailed", async () => {
    const { client, writes } = retryClient();
    const email = emailFunction(INPUT.endpoint.key);
    globalThis.fetch = email.fn as unknown as typeof fetch;
    const r = await retryFailedRefundEmails(client as never, { endpoint: INPUT.endpoint });
    expect(email.fn).toHaveBeenCalledTimes(1 + ROWS.length);
    expect(email.bodies).toHaveLength(ROWS.length);
    expect(r.retried).toBe(ROWS.length);
    expect(writes.filter((w) => w.op === "update").length).toBeGreaterThan(0);
  });
});

describe("Q1731: the preflight's contract with send-notification-email holds in its source", () => {
  const src = blankComments(readFileSync(resolve(__dirname, "../../supabase/functions/send-notification-email/index.ts"), "utf8"));

  beforeEach(() => {
    // Inventory floor: the function is the one the refund notice emails through.
    expect(src.length).toBeGreaterThan(5000);
  });

  it("the bearer is checked, then an empty body is refused 400, before ANY read, log or send", () => {
    const auth = src.indexOf("timingSafeEqual(presentedToken, expectedSecret)");
    const missing = src.indexOf("if (!user_id || !title || !message)");
    const missing400 = src.indexOf("status: 400", missing);
    expect(auth).toBeGreaterThan(0);
    expect(missing).toBeGreaterThan(auth);
    expect(src.slice(missing, missing400)).toContain("Missing required fields");
    // Nothing that reads, logs or sends may run before the empty-body 400.
    const before = src.slice(0, missing);
    for (const effect of [".from(", ".rpc(", "sendWithResend(", "postSlackOpsAlert(", "logSkip(", "recordLog("]) {
      const firstCall = before.indexOf(effect);
      // A definition (const logSkip = ...) is not a call; there is none before it either.
      expect(firstCall, `${effect} runs before the empty-body 400`).toBe(-1);
    }
  });
});
