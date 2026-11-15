/**
 * Welcome emails (owner 11-14): the sender, run for real through the edge harness.
 *
 * welcome-emails reads the real live items once, CLAIMS the due members for day 1 then day 3 (the claim RPC writes
 * each member's welcome_email_sends row in the same statement that returns them), reads the open jobs near each
 * member (never seed jobs), and queues ONE commercial email per claimed member with a signed one-click unsubscribe,
 * in the member's language, then stamps the claim and profiles.last_drip_at. WHO is due is decided in SQL (proven in
 * src/test/pglite/welcomeEmails.pglite.mjs); this file proves the sender's half.
 *
 * @mutate supabase/functions/welcome-emails/index.ts |   const denied = verifyCronSecret(req);\n  if (denied) return denied; |   const denied = null;
 * @mutate supabase/functions/welcome-emails/index.ts | const STEPS: WelcomeStep[] = [1, 3]; | const STEPS: WelcomeStep[] = [1];
 * @mutate supabase/functions/welcome-emails/index.ts |           p_include_seed: false, |           p_include_seed: true,
 * @mutate supabase/functions/welcome-emails/index.ts |       .eq("is_seed", false) |       .neq("status", "x")
 * @mutate supabase/functions/welcome-emails/index.ts |       items = items.filter((i) => !test.has(i.seller_id)); |       void test;
 * @mutate supabase/functions/welcome-emails/index.ts |   const mine = items.filter((i) => i.seller_id !== m.user_id); |   const mine = items;
 * @mutate supabase/functions/welcome-emails/index.ts |         .sort((a, b) => a.d - b.d) |         .sort(() => 0)
 * @mutate supabase/functions/welcome-emails/index.ts |         const lang = welcomeLang(m.language); |         const lang = welcomeLang(null);
 * @mutate supabase/functions/welcome-emails/index.ts |             .update({ last_drip_at: now }) |             .update({})
 * @mutate supabase/functions/welcome-emails/index.ts |           if (dripErr \|\| (dripped?.length ?? 0) === 0) { |           if (dripErr) {
 * @mutate supabase/functions/welcome-emails/index.ts |         if (refused) await release(m.user_id, step); |         await release(m.user_id, step);
 * @mutate supabase/functions/welcome-emails/index.ts |         if (isTestAddress(m.email)) { |         if (false) {
 * @mutate supabase/functions/welcome-emails/index.ts |           if (!unsubscribeUrl) { |           if (false) {
 * @mutate supabase/functions/welcome-emails/index.ts |             purpose: "commercial", |             purpose: "transactional",
 * @mutate supabase/functions/welcome-emails/index.ts |             headers,\n |             headers: {},\n
 * @mutate supabase/functions/welcome-emails/index.ts |         if (claimErr.code === "PGRST202") { |         if (false) {
 * @mutate supabase/functions/welcome-emails/index.ts | ${jobsErr.message}`);\n          await release(m.user_id, step); | ${jobsErr.message}`);
 * @mutate supabase/functions/welcome-emails/index.ts |     if (itemsErr) { |     if (false) {
 * @mutate supabase/functions/welcome-emails/index.ts |       for (const r of rows) { |       for (const r of []) {
 * @mutate supabase/functions/welcome-emails/index.ts |             return !!poster && poster !== m.user_id && !testSet.has(poster) && !blockedWith.has(poster); |             return !!poster;
 * @mutate supabase/functions/welcome-emails/index.ts |             return !!poster && poster !== m.user_id && !testSet.has(poster) && !blockedWith.has(poster); |             return !!poster && !testSet.has(poster) && !blockedWith.has(poster);
 * @mutate supabase/functions/welcome-emails/index.ts |  && !testSet.has(poster) && !blockedWith.has(poster); |  && !testSet.has(poster);
 * @mutate supabase/functions/welcome-emails/index.ts | itemsNear(items.filter((i) => !blockedWith.has(i.seller_id)), m, | itemsNear(items, m,
 * @mutate supabase/functions/welcome-emails/index.ts |           else if (b.blocked_id === m.user_id) blockedWith.add(b.blocker_id); |
 * @mutate supabase/functions/welcome-emails/index.ts | ${blocksErr.message}`);\n          await release(m.user_id, step);\n          continue; | ${blocksErr.message}`);
 * @mutate supabase/functions/welcome-emails/index.ts | .or(`blocker_id.eq.${m.user_id},blocked_id.eq.${m.user_id}`) | .or(`blocker_id.eq.${m.user_id}`)
 * @mutate supabase/functions/welcome-emails/index.ts |       .is("message_id", null)\n |
 * @mutate supabase/functions/welcome-emails/index.ts |             .update({ message_id: SKIPPED_TEST }) |             .update({})
 * @mutate supabase/functions/welcome-emails/index.ts | j.id && j.title && !maskedForGuest(j.title) | j.id && j.title
 * @mutate supabase/functions/welcome-emails/index.ts | "[email hidden]", "[phone hidden]", "[address hidden]" | "[email hidden]", "[address hidden]"
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "@/test/helpers/blankNonCode";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetEmailMocks, emailRenders, buildUnsubscribeUrl } from "./mocks/email";
import { WELCOME_COPY } from "../../../supabase/functions/_shared/welcomeEmail";

const CRON = "cron-secret";

async function cron(bearer = CRON) {
  const fn = await loadEdgeFunction("welcome-emails");
  return fn.fetch(fn.request({ url: "https://edge.test/welcome-emails", headers: { Authorization: `Bearer ${bearer}` }, body: {} }));
}

type Payload = Record<string, unknown>;
type Render = { type: { name: string }; props: Record<string, unknown> };
const rpcs = (n: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === n);
const sent = () => rpcs("enqueue_email").map((c) => (c.args as { payload: Payload }).payload);
const renders = () => emailRenders as Render[];
const releases = () => scenario.writes.filter((w) => w.table === "welcome_email_sends" && w.op === "delete");

const DAY1 = [
  { user_id: "u-1", email: "pat@gmail.com", full_name: "Pat Smith", language: "en", latitude: 30.45, longitude: -91.15 },
  { user_id: "u-2", email: "ana@yahoo.com", full_name: "Ana Ruiz", language: "es", latitude: null, longitude: null },
];
const DAY3 = [{ user_id: "u-9", email: "lee@gmail.com", full_name: "Lee Ray", language: "en", latitude: 30.45, longitude: -91.15 }];
const ITEMS = [
  // Newest first, as read. Far from Baton Rouge, then near, then the member's own, then a test account's.
  { id: "i-far", seller_id: "s-1", title: "Shreveport desk", current_price_cents: 5000, area_label: "Shreveport", area_lat: 32.5, area_lng: -93.75 },
  { id: "i-near", seller_id: "s-2", title: "Oak rocking chair", current_price_cents: 4000, area_label: "Mid City", area_lat: 30.45, area_lng: -91.16 },
  { id: "i-own", seller_id: "u-1", title: "My own lamp", current_price_cents: 1000, area_label: "Mid City", area_lat: 30.45, area_lng: -91.15 },
  { id: "i-test", seller_id: "s-test", title: "Test fixture item", current_price_cents: 100, area_label: "Mid City", area_lat: 30.45, area_lng: -91.15 },
  { id: "i-free", seller_id: "s-3", title: "Free firewood", current_price_cents: 0, area_label: "Denham Springs", area_lat: 30.49, area_lng: -90.95 },
  { id: "i-mid", seller_id: "s-4", title: "Bike", current_price_cents: 1250, area_label: "Lafayette", area_lat: 30.22, area_lng: -92.02 },
];
const JOBS = [
  { id: "j-1", title: "Rake leaves", location: "Baton Rouge", parish: "East Baton Rouge", distance_band: "Under 5 mi" },
  { id: "j-own", title: "My own job", location: "Baton Rouge", parish: null, distance_band: "Under 5 mi" },
  { id: "j-test", title: "Test poster job", location: "Baton Rouge", parish: null, distance_band: "Under 5 mi" },
];
const POSTERS = [
  { id: "j-1", customer_id: "p-1" },
  { id: "j-own", customer_id: "u-1" },
  { id: "j-test", customer_id: "p-test" },
];

describe("welcome-emails: claimed first, one email per claim, real listings near the member", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET: CRON });
    scenario.rpc.claim_welcome_emails = (a?: unknown) => ((a as { p_step: number }).p_step === 1 ? DAY1 : DAY3);
    scenario.rpc.get_ranked_open_jobs = JOBS;
    scenario.rpc.enqueue_email = 1;
    scenario.reads.declutter_items = { rows: ITEMS };
    scenario.reads.test_accounts = { rows: [{ user_id: "s-test" }, { user_id: "p-test" }] };
    scenario.reads.jobs = { rows: POSTERS };
    scenario.writeSelectRows.welcome_email_sends = [{ user_id: "u-1" }];
    scenario.writeSelectRows.profiles = [{ user_id: "u-1" }];
  });
  afterEach(() => resetEnv());

  it("refuses a caller without the cron secret, and claims nothing", async () => {
    const res = await cron("nope");
    expect(res.status).toBe(401);
    expect(scenario.rpcCalls ?? []).toEqual([]);
  });

  it("claims day 1 then day 3 and queues one commercial email per member, in the member's language", async () => {
    const res = await cron();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ claimed: 3, queued: 3, released: 0, unqueuedClaims: 0 });
    expect(rpcs("claim_welcome_emails").map((c) => c.args)).toEqual([{ p_step: 1, p_limit: 25 }, { p_step: 3, p_limit: 25 }]);
    const p = sent();
    expect(p.map((x) => x.to)).toEqual(["pat@gmail.com", "ana@yahoo.com", "lee@gmail.com"]);
    expect(p.map((x) => x.subject)).toEqual([WELCOME_COPY.en[1].subject, WELCOME_COPY.es[1].subject, WELCOME_COPY.en[3].subject]);
    expect(p.map((x) => x.label)).toEqual(["welcome_day_1", "welcome_day_1", "welcome_day_3"]);
    for (const x of p) {
      expect(x.purpose).toBe("commercial");
      expect((x.headers as Record<string, string>)["List-Unsubscribe"]).toContain(encodeURIComponent(x.to as string));
    }
    const r = renders();
    expect(r.map((e) => e.type.name)).toEqual(["WelcomeEmail", "WelcomeEmail", "WelcomeEmail"]);
    expect(r.map((e) => [e.props.step, e.props.lang])).toEqual([[1, "en"], [1, "es"], [3, "en"]]);
    expect(String(r[0].props.unsubscribeUrl)).toContain(encodeURIComponent("pat@gmail.com"));
    expect(String(r[0].props.appUrl)).toMatch(/\/home$/);
  });

  it("jobs come from the ranked feed near the member, never seed jobs", async () => {
    await cron();
    const calls = rpcs("get_ranked_open_jobs").map((c) => c.args);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({ p_limit: 12, p_offset: 0, p_include_seed: false, p_lat: 30.45, p_lng: -91.15 });
    // No saved position: the feed's own order, no coordinates sent.
    expect(calls[1]).toEqual({ p_limit: 12, p_offset: 0, p_include_seed: false });
    // The member's own job and a test account's job are dropped.
    const jobs = renders()[0].props.jobs as { title: string; detail: string; url: string }[];
    expect(jobs).toEqual([{ title: "Rake leaves", detail: "Baton Rouge · Under 5 mi", url: expect.stringMatching(/\/jobs\/j-1$/) }]);
    expect((renders()[1].props.jobs as { title: string }[]).map((j) => j.title)).toEqual(["Rake leaves", "My own job"]);
    expect((renders()[1].props.jobs as { detail: string }[])[0].detail).toBe("Baton Rouge · A menos de 5 mi");
  });

  it("items: real live ones only, nearest first, never the member's own or a test account's", async () => {
    await cron();
    const read = (scenario.readQueries ?? []).find((q) => q.table === "declutter_items");
    expect(read?.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "eq", column: "status", value: "live" }),
      expect.objectContaining({ op: "eq", column: "is_seed", value: false }),
      expect.objectContaining({ op: "eq", column: "seller_hidden", value: false }),
    ]));
    const near = renders()[0].props.items as { title: string; detail: string; url: string }[];
    expect(near.map((i) => i.title)).toEqual(["Oak rocking chair", "Free firewood", "Bike"]);
    expect(near.map((i) => i.detail)).toEqual(["$40 · Mid City", "Free · Denham Springs", "$12.50 · Lafayette"]);
    expect(near[0].url).toMatch(/\/declutter\/item\/i-near$/);
    // No saved position: the newest, in Spanish words.
    const es = renders()[1].props.items as { title: string; detail: string }[];
    expect(es.map((i) => i.title)).toEqual(["Shreveport desk", "Oak rocking chair", "My own lamp"]);
    expect(renders().flatMap((e) => (e.props.items as { title: string }[]).map((i) => i.title))).not.toContain("Test fixture item");
    expect((renders()[0].props.items as { title: string }[]).map((i) => i.title)).not.toContain("My own lamp");
  });

  it("stamps the claim's queued_at and the member's last_drip_at for each queued email", async () => {
    await cron();
    const stamps = scenario.writes.filter((w) => w.table === "welcome_email_sends" && w.op === "update");
    expect(stamps.map((w) => (w.payload as { message_id: string }).message_id)).toEqual(sent().map((x) => x.message_id));
    const drips = scenario.writes.filter((w) => w.table === "profiles" && w.op === "update");
    expect(drips).toHaveLength(3);
    for (const w of drips) expect((w.payload as { last_drip_at: string }).last_drip_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("a last_drip_at stamp that matched no row is a defect", async () => {
    scenario.rpc.claim_welcome_emails = (a?: unknown) => ((a as { p_step: number }).p_step === 1 ? [DAY1[0]] : []);
    scenario.writeSelectRows["profiles:update"] = [];
    const res = await cron();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).toMatch(/last_drip_at NOT stamped for member u-1 step 1/);
  });

  it("a failed items read claims nobody and is a defect", async () => {
    scenario.reads.declutter_items = { error: { message: "items down" } };
    const res = await cron();
    expect(res.status).toBe(500);
    expect(rpcs("claim_welcome_emails")).toEqual([]);
    expect(JSON.stringify(await res.json())).toMatch(/items read failed \(items down\)/);
  });

  it("a failed jobs read releases that member's claim and sends nothing to them", async () => {
    scenario.rpc.claim_welcome_emails = (a?: unknown) => ((a as { p_step: number }).p_step === 1 ? [DAY1[0]] : []);
    scenario.rpcErrors = { get_ranked_open_jobs: { message: "jobs down", code: "XX000" } };
    const res = await cron();
    expect(res.status).toBe(500);
    expect(sent()).toEqual([]);
    expect(releases()).toHaveLength(1);
  });

  it("PGRST202 on the claim: claims nothing, stops, and is a defect", async () => {
    scenario.rpcErrors = { claim_welcome_emails: { message: "Could not find the function", code: "PGRST202" } };
    const res = await cron();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).toMatch(/claim_welcome_emails not found \(PGRST202/);
    expect(rpcs("claim_welcome_emails")).toHaveLength(1);
    expect(sent()).toEqual([]);
  });

  it("with nobody due it sends nothing and answers 200", async () => {
    scenario.rpc.claim_welcome_emails = [];
    const res = await cron();
    expect(res.status).toBe(200);
    expect(sent()).toEqual([]);
  });

  it("with no signed one-click unsubscribe the member is NOT mailed and the claim is released", async () => {
    scenario.rpc.claim_welcome_emails = (a?: unknown) => ((a as { p_step: number }).p_step === 1 ? [DAY1[0]] : []);
    buildUnsubscribeUrl.mockResolvedValueOnce(null);
    const res = await cron();
    expect(res.status).toBe(500);
    expect(sent()).toEqual([]);
    expect(releases()).toHaveLength(1);
  });

  it("a test address that slips through the claim is never mailed", async () => {
    scenario.rpc.claim_welcome_emails = (a?: unknown) =>
      ((a as { p_step: number }).p_step === 1 ? [{ ...DAY1[0], email: "qa@mailinator.com" }] : []);
    const res = await cron();
    expect(res.status).toBe(200);
    expect(sent()).toEqual([]);
    expect((await res.json()).skippedTest).toBe(1);
    // The claim is marked, so the unqueued-claim check (which reads only unmarked rows) never reports it.
    const mark = scenario.writes.find((w) => w.table === "welcome_email_sends" && w.op === "update");
    expect((mark?.payload as { message_id: string }).message_id).toBe("not-sent:test-address");
    const check = (scenario.readQueries ?? []).find((q) => q.table === "welcome_email_sends");
    expect(check?.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "is", column: "queued_at", value: null }),
      expect.objectContaining({ op: "is", column: "message_id", value: null }),
    ]));
  });

  it("a database-refused enqueue releases the claim; a network failure keeps it", async () => {
    scenario.rpc.claim_welcome_emails = (a?: unknown) => ((a as { p_step: number }).p_step === 3 ? DAY3 : []);
    scenario.rpcErrors = { enqueue_email: { message: "queue missing", code: "42P01" } };
    let res = await cron();
    expect(res.status).toBe(500);
    expect(releases()).toHaveLength(1);
    resetSupabaseMock();
    scenario.rpc.claim_welcome_emails = (a?: unknown) => ((a as { p_step: number }).p_step === 3 ? DAY3 : []);
    scenario.rpc.get_ranked_open_jobs = JOBS;
    scenario.reads.declutter_items = { rows: ITEMS };
    scenario.rpcErrors = { enqueue_email: { message: "TypeError: fetch failed" } };
    res = await cron();
    expect(res.status).toBe(500);
    expect(releases()).toEqual([]);
  });

  it("blocks, either direction: no job or item from someone the member blocked or who blocked them", async () => {
    scenario.rpc.claim_welcome_emails = (a?: unknown) => ((a as { p_step: number }).p_step === 1 ? [DAY1[0]] : DAY3);
    scenario.rpc.get_ranked_open_jobs = [...JOBS, { id: "j-blocker", title: "Blocker's job", location: "Baton Rouge", parish: null, distance_band: "Under 5 mi" }];
    scenario.reads.jobs = { rows: [...POSTERS, { id: "j-blocker", customer_id: "p-blocker" }] };
    scenario.reads.user_blocks = {
      rows: [
        { blocker_id: "p-blocker", blocked_id: "u-1" }, // p-blocker blocked Pat
        { blocker_id: "u-1", blocked_id: "s-2" }, // Pat blocked the rocking chair's seller
        { blocker_id: "x-9", blocked_id: "p-1" }, // a block between two OTHER members hides nothing
      ],
    };
    const res = await cron();
    expect(res.status).toBe(200);
    // The read asks for the member's own blocks, both directions.
    const reads = (scenario.readQueries ?? []).filter((q) => q.table === "user_blocks");
    expect(reads.map((q) => q.filters)).toEqual([
      [{ op: "or", column: "", value: "blocker_id.eq.u-1,blocked_id.eq.u-1" }],
      [{ op: "or", column: "", value: "blocker_id.eq.u-9,blocked_id.eq.u-9" }],
    ]);
    const [pat, lee] = renders();
    expect((pat.props.jobs as { title: string }[]).map((j) => j.title)).toEqual(["Rake leaves"]);
    expect((pat.props.items as { title: string }[]).map((i) => i.title)).toEqual(["Free firewood", "Bike", "Shreveport desk"]);
    // Lee is in no block: the blocker's job and the rocking chair both reach Lee.
    expect((lee.props.jobs as { title: string }[]).map((j) => j.title)).toEqual(["Rake leaves", "My own job", "Blocker's job"]);
    expect((lee.props.items as { title: string }[]).map((i) => i.title)).toContain("Oak rocking chair");
  });

  it("a failed blocks read fails closed: that member is not mailed and the claim is released", async () => {
    scenario.rpc.claim_welcome_emails = (a?: unknown) => ((a as { p_step: number }).p_step === 1 ? [DAY1[0]] : []);
    scenario.reads.user_blocks = { error: { message: "blocks down" } };
    const res = await cron();
    expect(res.status).toBe(500);
    expect(sent()).toEqual([]);
    expect(rpcs("get_ranked_open_jobs")).toEqual([]);
    expect(releases()).toHaveLength(1);
    expect(JSON.stringify(await res.json())).toMatch(/blocks read failed for member u-1 step 1: blocks down/);
  });

  // Q2808 (decided by recommendation 2026-11-15): the service role reads the GUEST copy of a job's title. The email
  // keeps the masked read (no contact details ever go into an email) and leaves out a job whose title came back
  // masked, so it never prints "[phone hidden]"; the next job fills the slot.
  it("a job whose title came back guest-masked is left out of the email, never printed with the placeholder", async () => {
    scenario.rpc.claim_welcome_emails = (a?: unknown) => ((a as { p_step: number }).p_step === 1 ? [DAY1[0]] : []);
    scenario.rpc.get_ranked_open_jobs = [
      { id: "j-phone", title: "Move a couch, call [phone hidden]", location: "Baton Rouge", parish: null, distance_band: "Under 5 mi" },
      { id: "j-mail", title: "Paint fence, write [email hidden]", location: "Baton Rouge", parish: null, distance_band: "Under 5 mi" },
      { id: "j-addr", title: "Haul from [address hidden]", location: "Baton Rouge", parish: null, distance_band: "Under 5 mi" },
      ...JOBS,
      { id: "j-4", title: "Mow the lawn", location: "Baton Rouge", parish: null, distance_band: "5-15 mi" },
      { id: "j-5", title: "Wash the car", location: "Baton Rouge", parish: null, distance_band: "5-15 mi" },
      { id: "j-6", title: "Fourth clean job", location: "Baton Rouge", parish: null, distance_band: "15-30 mi" },
    ];
    scenario.reads.jobs = {
      rows: [
        ...POSTERS,
        ...["j-phone", "j-mail", "j-addr", "j-4", "j-5", "j-6"].map((id) => ({ id, customer_id: "p-1" })),
      ],
    };
    const res = await cron();
    expect(res.status).toBe(200);
    // Only the three masked titles are skipped; the next clean jobs backfill, so the email still shows 3 titles.
    const jobs = renders()[0].props.jobs as { title: string }[];
    expect(jobs.map((j) => j.title)).toEqual(["Rake leaves", "Mow the lawn", "Wash the car"]);
    expect(JSON.stringify(renders()[0].props)).not.toMatch(/hidden\]/);
  });

  it("the sender's placeholder list is exactly the one the newest mask_guest_contact writes", () => {
    const repo = resolve(__dirname, "..", "..", "..");
    const def = effectiveDefs(resolve(repo, "supabase/migrations")).get("mask_guest_contact");
    expect(def, "mask_guest_contact has a definition").toBeTruthy();
    const sqlPlaceholders = [...blankSqlComments(def!.stmt).matchAll(/'(\[[a-z ]+ hidden\])'/g)].map((m) => m[1]).sort();
    expect(sqlPlaceholders.length).toBeGreaterThan(2);
    const src = blankComments(readFileSync(resolve(repo, "supabase/functions/welcome-emails/index.ts"), "utf8"));
    const at = src.indexOf("GUEST_MASK_PLACEHOLDERS = [");
    expect(at, "GUEST_MASK_PLACEHOLDERS in welcome-emails").toBeGreaterThan(-1);
    const list = src.slice(at, src.indexOf("as const", at));
    const tsPlaceholders = [...list.matchAll(/"(\[[a-z ]+ hidden\])"/g)].map((m) => m[1]).sort();
    expect(tsPlaceholders).toEqual(sqlPlaceholders);
  });

  it("a claim left without queued_at for 2+ hours is reported as a defect", async () => {
    scenario.rpc.claim_welcome_emails = [];
    scenario.reads.welcome_email_sends = { rows: [{ user_id: "u-old", email_step: 1, claimed_at: "2026-11-14T08:00:00Z" }] };
    const res = await cron();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).toMatch(/claim for member u-old step 1 has no queued_at after 2 hours/);
  });
});
