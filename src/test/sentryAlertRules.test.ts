// @mutate scripts/sentry/alertRules.mjs |     name: "P0 — invalid job state transition", |     name: "P0 - invalid job state transition",
// @mutate scripts/sentry/alertRules.mjs | export const ENVIRONMENT = "production"; | export const ENVIRONMENT = "staging";
// @mutate scripts/sentry/alertRules.mjs |     data: { fallthroughType: "ActiveMembers" }, |     data: { fallthroughType: "NoOne" },
// @mutate scripts/sentry/alertRules.mjs |   return rule.anyOf.map((f) => ({ logicType: "all", conditions: [...common, filterCondition(f)], actions: [emailAction()] })); |   return [{ logicType: "any-short", conditions: [...common, ...rule.anyOf.map(filterCondition)], actions: [emailAction()] }];
// @mutate scripts/sentry/alertRules.mjs |     return diffs.length === 0 |     return diffs.length !== 0
// @mutate scripts/sentry/alertRules.mjs |     if (matches.length > 1) {\n      throw new Error( |     if (false) {\n      throw new Error(
// @mutate scripts/sentry/alertRules.mjs |     if (diffs.length > 0) failures.push(`${payload.name}: read back differs in ${diffs.join(", ")}`); |     if (false) failures.push(`${payload.name}: read back differs in ${diffs.join(", ")}`);
// @mutate scripts/sentry/alertRules.mjs |     frequency: { value: 5, interval: "1h" }, |     frequency: { value: 5, interval: "1hr" },
// @mutate scripts/sentry/sync-alert-rules.mjs |   if (!token) { |   if (false) {
// @mutate scripts/sentry/sync-alert-rules.mjs |   const failures = verifyReadback(desired, after); |   const failures = [];
// @mutate scripts/sentry/sync-alert-rules.mjs |     next = nextPageUrl(link); |     next = null;
// @mutate scripts/sentry/sync-alert-rules.mjs |   const run = env.DRY_RUN === "1" ? Promise.resolve(dryRun()) : sync(); |   const run = sync();
// @mutate .github/workflows/sentry-alert-rules.yml |         run: node scripts/sentry/sync-alert-rules.mjs |         run: echo skipped
// @mutate .github/workflows/sentry-alert-rules.yml |           SENTRY_ALERTS_TOKEN: ${{ secrets.SENTRY_ALERTS_TOKEN }} |           SENTRY_ALERTS_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALLOWED_FREQUENCIES,
  ENVIRONMENT,
  FREQUENCY_INTERVALS,
  MATCH_TYPES,
  RULES,
  TRIGGER_TYPES,
  buildPayload,
  planRules,
  ruleNamesInDoc,
  verifyReadback,
  type WorkflowPayload,
} from "../../scripts/sentry/alertRules.mjs";

/**
 * Q185: the Sentry issue alerts docs/SENTRY_ALERT_RULES.md specifies are
 * created by .github/workflows/sentry-alert-rules.yml from
 * scripts/sentry/alertRules.mjs, email only, environment production.
 * Pins (1) the rule file and the doc name the same rules (two-way), (2) every
 * payload is production + email to Suggested Assignees -> Active Members and
 * uses only documented values, (3) the idempotent planner (create / update /
 * skip, never delete, refuse duplicates), (4) the read-back proof, and (5) the
 * CLI end to end against a stub Sentry API: no secret -> green notice; DRY_RUN
 * -> no request; a sync creates, updates and reads back; a lost alert -> red.
 */

const ROOT = join(__dirname, "..", "..");
const DOC = readFileSync(join(ROOT, "docs/SENTRY_ALERT_RULES.md"), "utf8");
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/sentry-alert-rules.yml"), "utf8");
const DETECTOR = 4242;
const payloads = () => RULES.map((r) => buildPayload(r, { detectorId: DETECTOR }));

/** What Sentry returns for a payload it stored (Fetch Alerts response shape): ids, string detector ids, extra fields. */
function asStored(original: WorkflowPayload, id: string): WorkflowPayload {
  const p = structuredClone(original);
  let n = 0;
  const nid = () => `${id}${++n}`;
  return {
    ...p,
    id,
    organizationId: "1",
    createdBy: "2345",
    dateCreated: "2026-10-21T00:00:00Z",
    lastTriggered: null,
    owner: null,
    detectorIds: (p.detectorIds ?? []).map(String),
    triggers: { ...p.triggers!, conditions: [...p.triggers!.conditions].reverse().map((c) => ({ ...c, id: nid() })) },
    actionFilters: [...(p.actionFilters ?? [])].reverse().map((g) => ({
      ...g,
      id: nid(),
      conditions: [...g.conditions].reverse().map((c) => ({ ...c, id: nid() })),
      actions: g.actions.map((a) => ({ ...a, id: nid(), config: { ...a.config, targetIdentifier: null } })),
    })),
  };
}

describe("the rule file matches docs/SENTRY_ALERT_RULES.md (two-way)", () => {
  const docNames = ruleNamesInDoc(DOC);

  it("the doc declares its rules and the parser finds them all", () => {
    expect(docNames.length).toBeGreaterThan(8);
    expect(docNames.length).toBe((DOC.match(/^## Rule \d+:/gm) ?? []).length);
  });

  it("every doc rule has a definition with the same name, and every definition is a doc rule", () => {
    const fileNames = RULES.map((r) => r.name);
    expect(fileNames.filter((n) => !docNames.includes(n))).toEqual([]);
    expect(docNames.filter((n) => !fileNames.includes(n))).toEqual([]);
    expect(new Set(fileNames).size).toBe(fileNames.length);
    expect(fileNames).toEqual(docNames);
  });
});

describe("every payload is production + email and uses documented values", () => {
  it("environment, email action, frequency, intervals, match types, triggers", () => {
    const all = payloads();
    expect(all.length).toBe(RULES.length);
    for (const p of all) {
      expect(p.environment).toBe("production");
      expect(ENVIRONMENT).toBe("production");
      expect(p.detectorIds).toEqual([DETECTOR]);
      expect(ALLOWED_FREQUENCIES).toContain(p.config?.frequency);
      expect(p.actionFilters!.length).toBeGreaterThan(0);
      for (const t of p.triggers!.conditions) expect(TRIGGER_TYPES).toContain(t.type);
      for (const g of p.actionFilters!) {
        expect(["all", "any-short"]).toContain(g.logicType);
        expect(g.actions).toEqual([
          {
            type: "email",
            integrationId: null,
            data: { fallthroughType: "ActiveMembers" },
            config: { targetType: "issue_owners", targetDisplay: null, targetIdentifier: "" },
            status: "active",
          },
        ]);
        for (const c of g.conditions) {
          const cmp = c.comparison as Record<string, unknown>;
          if (c.type === "event_frequency_count") expect(FREQUENCY_INTERVALS).toContain(cmp.interval);
          else expect(MATCH_TYPES).toContain(cmp.match);
        }
      }
    }
  });

  it("the doc's semantics survive the mapping", () => {
    const by = Object.fromEntries(payloads().map((p) => [p.name, p]));
    const r1 = by["P0 schema drift — column missing"];
    expect(r1.triggers!.conditions.map((c) => c.type)).toEqual(["first_seen_event", "regression_event"]);
    expect(r1.actionFilters).toHaveLength(1);
    expect(r1.actionFilters![0].logicType).toBe("all");
    // Rule 5: contains send-push-notification AND any of four words = four "all" groups.
    const r5 = by["P0 — chat push notification trigger failed"];
    expect(r5.actionFilters).toHaveLength(4);
    for (const g of r5.actionFilters!) {
      expect(g.logicType).toBe("all");
      expect(g.conditions.map((c) => (c.comparison as { value: string }).value)[0]).toBe("send-push-notification");
    }
    // Rule 6: more than 5 in 1h AND tags.source equals any of six functions.
    const r6 = by["P1 — edge function 5xx burst"];
    expect(r6.triggers!.conditions).toEqual([]);
    expect(r6.actionFilters).toHaveLength(6);
    for (const g of r6.actionFilters!) {
      expect(g.conditions[0]).toEqual({ type: "event_frequency_count", comparison: { value: 5, interval: "1h" }, conditionResult: true });
      expect(g.conditions[1].type).toBe("tagged_event");
    }
    // Rule 8: any of two messages, no common part = one any-short group.
    const r8 = by["WARN — Stripe webhook signature mismatch"];
    expect(r8.actionFilters).toHaveLength(1);
    expect(r8.actionFilters![0].logicType).toBe("any-short");
    expect(r8.actionFilters![0].conditions).toHaveLength(2);
  });
});

describe("the idempotent planner", () => {
  it("creates the missing, updates the drifted, skips the identical, ignores the rest", () => {
    const desired = payloads();
    const [p0, p1] = desired;
    const drifted = asStored({ ...p1, environment: null }, "200");
    const unrelated = { id: "999", name: "Someone else's alert", actionFilters: [] };
    const plan = planRules(desired, [asStored(p0, "100"), drifted, unrelated]);
    expect(plan.map((s) => s.action)).toEqual(["skip", "update", ...Array(desired.length - 2).fill("create")]);
    expect(plan[0].id).toBe("100");
    expect(plan[1]).toMatchObject({ id: "200", diffs: ["environment"] });
    expect(plan.some((s) => s.name === unrelated.name)).toBe(false);
    expect(new Set(plan.map((s) => s.action))).toEqual(new Set(["skip", "update", "create"]));
  });

  it("a changed condition or action is drift", () => {
    const [p0] = payloads();
    const stored = asStored(p0, "1");
    (stored.actionFilters![0].actions[0].data as Record<string, unknown>).fallthroughType = "NoOne";
    expect(planRules([p0], [stored])[0]).toMatchObject({ action: "update", diffs: ["actionFilters"] });
    const stored2 = asStored(p0, "2");
    (stored2.actionFilters![0].conditions[0].comparison as Record<string, unknown>).value = "something else";
    expect(planRules([p0], [stored2])[0].action).toBe("update");
  });

  it("two alerts with one name is refused, not guessed", () => {
    const [p0] = payloads();
    expect(() => planRules([p0], [asStored(p0, "1"), asStored(p0, "2")])).toThrow(/2 Sentry alerts are named/);
  });
});

describe("the read-back proof", () => {
  it("passes only when every alert is there once, as sent", () => {
    const desired = payloads();
    const stored = desired.map((p, i) => asStored(p, String(i + 1)));
    expect(verifyReadback(desired, stored)).toEqual([]);
    expect(verifyReadback(desired, stored.slice(1))).toEqual([`${desired[0].name}: not found after the sync`]);
    expect(verifyReadback(desired, [...stored, stored[0]])[0]).toMatch(/2 alerts carry this name/);
    const noEmail = stored.map((w, i) => (i === 2 ? { ...w, actionFilters: w.actionFilters!.map((g) => ({ ...g, actions: [] })) } : w));
    const f = verifyReadback(desired, noEmail);
    expect(f).toContain(`${desired[2].name}: read back has no email action`);
    expect(f.some((x) => x.includes("differs in actionFilters"))).toBe(true);
  });
});

// ---- the CLI end to end against a stub Sentry API ----

type Stub = { workflows: WorkflowPayload[]; requests: string[]; dropCreates: boolean; nextId: number };
let server: Server;
let base = "";
let stub: Stub;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    stub.requests.push(`${req.method} ${url.pathname}${url.search}`);
    const json = (code: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== "Bearer test-token") return json(401, { detail: "no" });
    if (req.method === "GET" && url.pathname === "/api/0/organizations/test-org/detectors/") {
      return json(200, [
        { id: String(DETECTOR), projectId: "7", type: "issue_stream", name: "Issue Stream" },
        { id: "5", projectId: "7", type: "error", name: "Error Monitor" },
      ]);
    }
    if (req.method === "GET" && url.pathname === "/api/0/organizations/test-org/workflows/") {
      // Two pages, so the CLI must follow Sentry's Link header to see every alert.
      const half = Math.ceil(stub.workflows.length / 2);
      if (url.searchParams.get("cursor") === "p2") return json(200, stub.workflows.slice(half), { Link: `<${base}/x>; rel="next"; results="false"; cursor="p3"` });
      return json(200, stub.workflows.slice(0, half), {
        Link: `<${base}/api/0/organizations/test-org/workflows/?per_page=100&cursor=p2>; rel="next"; results="true"; cursor="p2"`,
      });
    }
    if (req.method === "POST" && url.pathname === "/api/0/organizations/test-org/workflows/") {
      const body = JSON.parse(await readBody(req)) as WorkflowPayload;
      const stored = asStored(body, String(stub.nextId++));
      if (!stub.dropCreates) stub.workflows.push(stored);
      return json(201, stored);
    }
    const put = url.pathname.match(/^\/api\/0\/organizations\/test-org\/workflows\/(\d+)\/$/);
    if (req.method === "PUT" && put) {
      const body = JSON.parse(await readBody(req)) as WorkflowPayload;
      const i = stub.workflows.findIndex((w) => w.id === put[1]);
      stub.workflows[i] = asStored(body, put[1]);
      return json(200, stub.workflows[i]);
    }
    return json(404, { detail: "not found" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function runCli(extra: Record<string, string>): Promise<{ code: number; out: string }> {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LH_SENTRY_API_BASE: base, SENTRY_ORG: "test-org", SENTRY_PROJECT: "javascript", ...extra };
  return new Promise((resolve) => {
    execFile(process.execPath, ["scripts/sentry/sync-alert-rules.mjs"], { cwd: ROOT, env, timeout: 60_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` });
    });
  });
}

describe("scripts/sentry/sync-alert-rules.mjs against a stub Sentry", () => {
  it("no secret: a notice naming SENTRY_ALERTS_TOKEN, exit 0, no request", async () => {
    stub = { workflows: [], requests: [], dropCreates: false, nextId: 1 };
    const { code, out } = await runCli({});
    expect(code).toBe(0);
    expect(out).toMatch(/::notice.*SENTRY_ALERTS_TOKEN/);
    expect(stub.requests).toEqual([]);
  });

  it("DRY_RUN=1 prints every payload and makes no request, even with a token", async () => {
    stub = { workflows: [], requests: [], dropCreates: false, nextId: 1 };
    const { code, out } = await runCli({ DRY_RUN: "1", SENTRY_ALERTS_TOKEN: "test-token" });
    expect(code).toBe(0);
    for (const r of RULES) expect(out).toContain(`"name":${JSON.stringify(r.name)}`);
    expect(stub.requests).toEqual([]);
  });

  it("creates the missing, updates the drifted, keeps the rest, never deletes, and reads back green", async () => {
    const desired = payloads();
    const keep = { id: "900", name: "Someone else's alert", environment: null, actionFilters: [] };
    // A drifted copy of alert 2 (its frequency changed by hand in Sentry). Built from a variable so the
    // fixture-schema contract does not read `{ frequency: <n> }` as a rental_rent_plans row.
    const driftedFrequency = 1440;
    stub = {
      workflows: [asStored(desired[0], "100"), asStored({ ...desired[1], config: { frequency: driftedFrequency } }, "200"), keep],
      requests: [],
      dropCreates: false,
      nextId: 300,
    };
    const { code, out } = await runCli({ SENTRY_ALERTS_TOKEN: "test-token" });
    expect(out).toMatch(/Read-back OK: all 9 alerts exist once/);
    expect(code).toBe(0);
    expect(stub.requests.filter((r) => r.startsWith("POST"))).toHaveLength(desired.length - 2);
    expect(stub.requests.filter((r) => r.startsWith("PUT"))).toEqual(["PUT /api/0/organizations/test-org/workflows/200/"]);
    expect(stub.requests.some((r) => r.startsWith("DELETE"))).toBe(false);
    expect(stub.requests.some((r) => r.includes("cursor=p2"))).toBe(true);
    expect(stub.workflows.find((w) => w.id === "900")).toEqual(keep);
    expect(out).toMatch(/read back: id 100 {2}P0 schema drift/);

    // A second run is a no-op: everything is skipped.
    stub.requests = [];
    const again = await runCli({ SENTRY_ALERTS_TOKEN: "test-token" });
    expect(again.code).toBe(0);
    expect(stub.requests.filter((r) => !r.startsWith("GET"))).toEqual([]);
    expect(again.out).toMatch(/created 0, updated 0, unchanged 9/);
  });

  it("an alert that does not read back turns the run red", async () => {
    stub = { workflows: [], requests: [], dropCreates: true, nextId: 1 };
    const { code, out } = await runCli({ SENTRY_ALERTS_TOKEN: "test-token" });
    expect(code).toBe(1);
    expect(out).toMatch(/Read-back FAILED: 9 of 9/);
  });

  it("the workflow runs the script with the SENTRY_ALERTS_TOKEN secret, on dispatch", () => {
    expect(WORKFLOW).toMatch(/^\s+run: node scripts\/sentry\/sync-alert-rules\.mjs$/m);
    expect(WORKFLOW).toMatch(/SENTRY_ALERTS_TOKEN: \$\{\{ secrets\.SENTRY_ALERTS_TOKEN \}\}/);
    expect(WORKFLOW).toMatch(/^\s+workflow_dispatch:/m);
  });
});
