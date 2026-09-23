/**
 * The admin push -> #ops-alerts mirror posts OPERATOR alerts only, and seed
 * subjects go to the digest (docs/OPEN.md Q2).
 *
 * THE BUG (measured on prod 2026-09-23). send-push-notification mirrors a
 * notification to Slack when its recipient is an admin with no push token. It
 * tested only the ROLE. The owner's account is an admin and a party to jobs,
 * so its own user mail — "Did you finish this job?" x5, "Has this job been
 * finished?" x5, "We've asked support to step in" x10, "Job auto-cancelled",
 * a chat message — reached #ops-alerts as critical pages. And every stalled
 * job shared the admin link `/admin?view=stalled`, so the once-a-day key
 * collapsed ALL of a day's stalled jobs into one post: a real job's page could
 * be swallowed by a seed job's.
 *
 * @mutate supabase/functions/send-push-notification/index.ts | if (isOperatorNotification(payload.thread_id)) { | if (true) {
 * @mutate supabase/functions/_shared/slack-alerts.ts | if (input.seed) { | if (false) {
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OPERATOR_NOTIFICATION_TYPES,
  alertSubjectFromLink,
  isOperatorNotification,
} from "../../supabase/functions/_shared/alertPolicy";

const ROOT = process.cwd();
const pushSrc = readFileSync(join(ROOT, "supabase/functions/send-push-notification/index.ts"), "utf8");

describe("which admin notifications are operator alerts", () => {
  it("admin_alert and system_alert only", () => {
    expect([...OPERATOR_NOTIFICATION_TYPES].sort()).toEqual(["admin_alert", "system_alert"]);
    for (const t of ["admin_alert", "system_alert"]) expect(isOperatorNotification(t)).toBe(true);
    // The types the owner's own user mail arrived under on 2026-09-23.
    for (const t of ["job_updates", "job_update", "message", "info", "work_status", "warning", "", undefined, null]) {
      expect(isOperatorNotification(t as string), String(t)).toBe(false);
    }
  });

  it("the mirror is gated on the notification TYPE, before the role lookup", () => {
    const gate = pushSrc.indexOf("if (isOperatorNotification(payload.thread_id)) {");
    const role = pushSrc.indexOf(".from('user_roles')");
    const post = pushSrc.indexOf("await postSlackOpsAlert({");
    expect(gate).toBeGreaterThan(0);
    expect(role).toBeGreaterThan(gate);
    expect(post).toBeGreaterThan(role);
    // …and it passes the subject's seed-ness through.
    expect(pushSrc.slice(post, post + 600)).toMatch(/\bseed,/);
  });
});

describe("alertSubjectFromLink", () => {
  const J = "5eed0a20-0000-4000-8000-000000000008";
  const U = "71c56dfb-b326-4010-b960-b18dd3966e7f";
  it("reads the job or user a link names", () => {
    expect(alertSubjectFromLink(`/admin?view=stalled&job=${J}`)).toEqual({ jobId: J });
    expect(alertSubjectFromLink(`/my-jobs?job=${J}`)).toEqual({ jobId: J });
    expect(alertSubjectFromLink(`/jobs/${J}`)).toEqual({ jobId: J });
    expect(alertSubjectFromLink(`/admin?view=people&user=${U}`)).toEqual({ userId: U });
  });
  it("returns null when the link names no subject (the mirror then treats it as real)", () => {
    expect(alertSubjectFromLink("/admin?view=stalled")).toBeNull();
    expect(alertSubjectFromLink(null)).toBeNull();
    expect(alertSubjectFromLink("/admin?view=jobs&job=not-a-uuid")).toBeNull();
  });
});

describe("postSlackOpsAlert({ seed: true }) goes to the digest", () => {
  const WEBHOOK = "https://hooks.slack.test/T/B/x";
  const SUPA = "https://proj.supabase.test";
  let calls: { url: string; init?: RequestInit }[];
  beforeEach(() => {
    calls = [];
    const env: Record<string, string> = { SLACK_WEBHOOK_URL: WEBHOOK, SUPABASE_URL: SUPA, SECRET_KEY: "svc" };
    (globalThis as any).Deno = { env: { get: (k: string) => env[k] } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.includes("/rest/v1/error_logs") && init?.method === "POST") {
          return new Response(JSON.stringify([{ id: "row-1" }]), { status: 201 });
        }
        if (url.includes("/rest/v1/error_logs?")) return new Response("[]", { status: 200 });
        return new Response("ok", { status: 200 });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any).Deno;
  });
  async function post(input: Record<string, unknown>) {
    const modulePath = "../../supabase/functions/_shared/slack-alerts";
    const { postSlackOpsAlert } = await import(/* @vite-ignore */ modulePath);
    await postSlackOpsAlert({ kind: "custom", title: "Job stalled", message: "M", ...input } as any);
  }

  it("seed: no Slack post, no ledger item, one seed-tagged info row", async () => {
    await post({ severity: "critical", seed: true });
    expect(calls.filter((c) => c.url === WEBHOOK)).toHaveLength(0);
    expect(calls.filter((c) => c.url.includes("rpc/ops_alert_record"))).toHaveLength(0);
    const rows = calls.filter((c) => c.url.includes("/rest/v1/error_logs") && c.init?.method === "POST");
    expect(rows).toHaveLength(1);
    const body = JSON.parse(String(rows[0].init!.body));
    expect(body.severity).toBe("info");
    expect(body.tags).toMatchObject({ source: "ops-alert-seed", seed: true, would_have_been: "critical" });
  });

  it("real (no seed flag): still posts and still records the ledger", async () => {
    await post({ severity: "critical" });
    expect(calls.filter((c) => c.url === WEBHOOK)).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes("rpc/ops_alert_record"))).toHaveLength(1);
  });
});
