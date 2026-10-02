/**
 * Q840 — no test or seed recipient is ever handed to Resend, on ANY path.
 *
 * Before this gate, 279 of 282 emails sent in the week to 2026-09-30 went to
 * mailinator fixture inboxes and is_seed accounts (email_send_log on prod),
 * spending the Resend quota for mail nobody reads.
 *
 * The class, built from an inventory of supabase/functions (never a hand list):
 *   1. Only `_shared/resend.ts` talks to the Resend send API. The one other file
 *      that loads the SDK (resend-webhook) only verifies signatures.
 *   2. `sendWithResend` refuses a fixture address before `.emails.send(`.
 *   3. Every file that calls `sendWithResend(` asks `isTestRecipient(` first.
 *   4. Everything else that emails enqueues (`enqueue_email` / `queueEmail(`),
 *      and the ONE queue consumer (process-email-queue) is covered by 3.
 * A new sender that skips the predicate turns this red.
 */
// @mutate supabase/functions/_shared/resend.ts |   if (isTestAddress(params.to)) { |   if (false) {
// @mutate supabase/functions/send-account-status-email/index.ts |     if (await isTestRecipient(supabaseAdmin, profile.email)) { |     if (false) {
// @mutate supabase/functions/notify-email-change/index.ts |     if (await isTestRecipient(supabase, oldEmail)) { |     if (false) {
// @mutate supabase/functions/send-marketing-blast/index.ts |         if (isTestRecipientIn(seedAddresses, r.email)) { |         if (false) {
// @mutate supabase/functions/_shared/testRecipient.ts |       if (typeof email === 'string') seeds.add(email.trim().toLowerCase()) |       if (false) seeds.add(email)
// @mutate supabase/functions/process-email-queue/index.ts |           const { error: ttlLogError } = await supabase.from('email_send_log').insert({ |           await supabase.from('email_send_log').insert({
// @mutate supabase/functions/send-notification-email/index.ts |       const { error: skipLogError } = await supabase.rpc('log_notification', { |       await supabase.rpc('log_notification', {
// @mutate supabase/functions/send-account-status-email/index.ts |     const { error: pendingLogError } = await supabaseAdmin.from('email_send_log').insert({ |     await supabaseAdmin.from('email_send_log').insert({
// @mutate supabase/migrations/20260926040523_seed_flag_derived_at_birth.sql |         OR lower(btrim(p_email)) LIKE '%@helpr.test'\n | 
// @mutate supabase/functions/contact-support/index.ts |     const testSubmitter = await isTestRecipient(admin, email) |     const testSubmitter = false
// @mutate supabase/functions/process-email-queue/index.ts |         if (error instanceof Error && error.name === 'TestRecipientRefusedError') { |         if (false) {
// @mutate supabase/functions/_shared/testRecipient.ts |       .eq('email', addr.trim().toLowerCase())\n      .eq('is_seed', true) |       .eq('email', addr.trim().toLowerCase())\n      .eq('is_seed', false)
// @mutate supabase/functions/_shared/testRecipient.ts |       .in('email', chunk)\n      .eq('is_seed', true) |       .in('email', chunk)\n      .eq('is_seed', false)
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { isTestAddress, isTestRecipient, isTestRecipientIn, seedAddressesAmong, SEED_LOOKUP_CHUNK } from "../../supabase/functions/_shared/testRecipient";

const ROOT = join(__dirname, "..", "..");
const FN = join(ROOT, "supabase", "functions");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const files = walk(FN).map((p) => ({ rel: relative(FN, p), code: blankComments(readFileSync(p, "utf8")) }));
const having = (re: RegExp) => files.filter((f) => re.test(f.code)).map((f) => f.rel).sort();

describe("no test or seed recipient reaches Resend (Q840)", () => {
  it("the inventory is the whole functions tree", () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it("only _shared/resend.ts calls the Resend send API; the webhook only verifies", () => {
    expect(having(/\.emails\.send\(|api\.resend\.com/)).toEqual(["_shared/resend.ts"]);
    expect(having(/npm:resend@/)).toEqual(["_shared/resend.ts", "resend-webhook/index.ts"]);
    const hook = files.find((f) => f.rel === "resend-webhook/index.ts")!.code;
    expect(hook).not.toMatch(/\.emails\b|\bbatch\.send\(/);
  });

  it("sendWithResend refuses a fixture address before the provider call", () => {
    const src = files.find((f) => f.rel === "_shared/resend.ts")!.code;
    const fn = src.indexOf("export async function sendWithResend(");
    const gate = src.indexOf("if (isTestAddress(params.to)) {", fn);
    const call = src.indexOf(".emails.send(", fn);
    expect(fn).toBeGreaterThan(0);
    expect(gate, "isTestAddress gate inside sendWithResend").toBeGreaterThan(fn);
    expect(call).toBeGreaterThan(gate);
  });

  it("every direct sender asks isTestRecipient before each sendWithResend call", () => {
    const senders = having(/\bsendWithResend\(/).filter((f) => f !== "_shared/resend.ts");
    expect(senders).toEqual([
      "contact-support/index.ts",
      "notify-email-change/index.ts",
      "process-email-queue/index.ts",
      "send-account-status-email/index.ts",
      "send-marketing-blast/index.ts",
      "send-notification-email/index.ts",
    ]);
    // Q855: per CALL SITE, not per file. Each sendWithResend( needs its own
    // gate before it (gates and calls pair up in order), and nothing between
    // that gate and the call may start a new function or handler, so a second
    // send added later in another function cannot ride on the first one's gate.
    const GATE = /\bisTestRecipient(?:In)?\(/g;
    const CALL = /\bsendWithResend\(/g;
    const SCOPE_BREAK = /\bfunction\s+\w+\s*\(|\bDeno\.serve\(|\bserve\(/;
    const bad: string[] = [];
    let sites = 0;
    for (const rel of senders) {
      const code = files.find((f) => f.rel === rel)!.code;
      const gates = [...code.matchAll(GATE)].map((m) => m.index!);
      const calls = [...code.matchAll(CALL)].map((m) => m.index!);
      calls.forEach((call, k) => {
        sites++;
        const before = gates.filter((g) => g < call);
        const nearest = before[before.length - 1];
        if (before.length < k + 1 || nearest === undefined) bad.push(`${rel} call #${k + 1}: no gate of its own`);
        else if (SCOPE_BREAK.test(code.slice(nearest, call))) bad.push(`${rel} call #${k + 1}: gate is in another function`);
      });
    }
    expect(sites, "call sites inventoried").toBeGreaterThan(5);
    expect(bad, "send call sites that can reach Resend without their own test-recipient gate").toEqual([]);
  });

  it("every other emailing path is a queue producer, drained only by the gated worker", () => {
    const producers = having(/enqueue_email|\bqueueEmail\(/).filter(
      (f) => f !== "_shared/resend.ts" && f !== "send-notification-email/index.ts",
    );
    // Exact: a new producer is fine (the worker gates it) but must be looked at.
    expect(producers).toEqual([
      "_shared/giftCardEmail.ts",
      "admin-update-email/index.ts",
      "admin-user-actions/index.ts",
      "auth-email-hook/index.ts",
      "engagement-automations/index.ts",
    ]);
    expect(having(/read_email_batch/)).toEqual(["process-email-queue/index.ts"]);
  });

  it("the queue worker suppresses test mail before the TTL/DLQ branches and never retries a refusal", () => {
    const code = files.find((f) => f.rel === "process-email-queue/index.ts")!.code;
    const gate = code.search(/\bisTestRecipient\(/);
    expect(gate).toBeGreaterThan(0);
    expect(gate, "suppress check precedes the TTL branch").toBeLessThan(code.indexOf("ttlMinutes[queue] * 60"));
    expect(gate, "suppress check precedes the max-retry branch").toBeLessThan(code.indexOf("msg.read_ct > MAX_RETRIES"));
    const catchAt = code.indexOf("} catch (error) {", code.search(/\bsendWithResend\(/));
    expect(code.indexOf("'TestRecipientRefusedError'", catchAt), "refusal handled as permanent").toBeGreaterThan(catchAt);
  });
});

describe("the predicate itself", () => {
  it("knows the fixture addresses and leaves real ones alone", () => {
    for (const to of ["a@mailinator.com", " B@Mailinator.com ", "x@helpr.test", "eli.test.1@gmail.com", "p@example.com", ["a@mailinator.com", "b@x.test"]])
      expect(isTestAddress(to), JSON.stringify(to)).toBe(true);
    for (const to of ["owner@gmail.com", "ops@louisianahelpr.com", "a@mailinator.co", ["a@mailinator.com", "real@gmail.com"], [], null])
      expect(isTestAddress(to), JSON.stringify(to)).toBe(false);
  });

  function client(result: { data: unknown; error: { message: string } | null }) {
    const calls: Array<[string, unknown]> = [];
    const chain = {
      select: () => chain,
      eq: (c: string, v: unknown) => (calls.push([c, v]), chain),
      limit: async () => result,
    };
    return { calls, db: { from: () => chain } };
  }

  it("an is_seed profile at an ordinary address is a test recipient", async () => {
    const { db, calls } = client({ data: [{ is_seed: true }], error: null });
    expect(await isTestRecipient(db, "Seed@LouisianaHelpr.com")).toBe(true);
    expect(calls).toEqual([["email", "seed@louisianahelpr.com"], ["is_seed", true]]);
  });

  it("a real profile is not, and a failed lookup falls back to the address check", async () => {
    expect(await isTestRecipient(client({ data: [], error: null }).db, "real@gmail.com")).toBe(false);
    expect(await isTestRecipient(client({ data: null, error: { message: "boom" } }).db, "real@gmail.com")).toBe(false);
    expect(await isTestRecipient(client({ data: null, error: { message: "boom" } }).db, "x@mailinator.com")).toBe(true);
  });
});

describe("Q855: the batched seed lookup", () => {
  function inClient(pages: Array<{ data: unknown; error: { message: string } | null }>) {
    const reads: string[][] = [];
    const filters: Array<[string, unknown]> = [];
    const chain = {
      select: () => chain,
      in: (_c: string, vals: string[]) => (reads.push(vals), chain),
      eq: async (c: string, v: unknown) => (filters.push([c, v]), pages[reads.length - 1] ?? { data: [], error: null }),
    };
    return { reads, filters, db: { from: () => chain } };
  }

  it("reads once per chunk, not once per recipient, and answers like isTestRecipient", async () => {
    const emails = Array.from({ length: SEED_LOOKUP_CHUNK + 5 }, (_, i) => `u${i}@gmail.com`);
    const { db, reads, filters } = inClient([{ data: [{ email: "u3@gmail.com" }], error: null }, { data: [], error: null }]);
    const seeds = await seedAddressesAmong(db, [...emails, " U3@Gmail.com "]);
    expect(reads.map((r) => r.length)).toEqual([SEED_LOOKUP_CHUNK, 5]);
    expect(filters).toEqual([["is_seed", true], ["is_seed", true]]);
    expect(isTestRecipientIn(seeds, "U3@gmail.com")).toBe(true);
    expect(isTestRecipientIn(seeds, "u4@gmail.com")).toBe(false);
    expect(isTestRecipientIn(seeds, "x@mailinator.com")).toBe(true);
  });

  it("a failed chunk falls back to the address check", async () => {
    const { db } = inClient([{ data: null, error: { message: "boom" } }]);
    const seeds = await seedAddressesAmong(db, ["real@gmail.com"]);
    expect(isTestRecipientIn(seeds, "real@gmail.com")).toBe(false);
  });
});

describe("Q855: email audit writes never drop their error", () => {
  // Inventory: every email_send_log insert/update and log_notification rpc in
  // supabase/functions. A write whose result is not captured (`await x.from(
  // 'email_send_log')...` as a bare statement) loses its error silently.
  const WRITE = /(\S*)\s*await\s+\w+\s*\.(?:from\(\s*['"]email_send_log['"]\s*\)\s*\.(?:insert|update|upsert)|rpc\(\s*['"]log_notification['"])/g;
  const sites = files.flatMap((f) =>
    [...f.code.matchAll(WRITE)].map((m) => ({ where: `${f.rel}@${f.code.slice(0, m.index).split("\n").length}`, lhs: m[1] })),
  );

  it("inventories the email audit writes", () => {
    expect(sites.length).toBeGreaterThan(15);
  });

  it("every one assigns its result (so the error can be checked)", () => {
    const bare = sites.filter((s) => s.lhs !== "=").map((s) => s.where);
    expect(bare).toEqual([]);
  });
});

describe("Q855: the address rule matches public.is_fixture_email", () => {
  const MIG = join(ROOT, "supabase", "migrations");
  const newest = readdirSync(MIG).filter((n) => n.endsWith(".sql")).sort().reverse()
    .find((n) => /FUNCTION public\.is_fixture_email\(/.test(readFileSync(join(MIG, n), "utf8")))!;
  const sql = readFileSync(join(MIG, newest), "utf8");
  const body = sql.slice(sql.indexOf("FUNCTION public.is_fixture_email("));
  const fnBody = body.slice(0, body.indexOf("$fn$;"));
  const likes = [...fnBody.matchAll(/LIKE\s+'([^']+)'/g)].map((m) => m[1]);
  const ts = readFileSync(join(FN, "_shared", "testRecipient.ts"), "utf8");
  const tsAlts = /const FIXTURE_ADDRESS = \/\(\?:(.*)\)\/i/.exec(ts)![1].split("|");

  it("reads the newest definition and finds its patterns", () => {
    expect(newest).toBeTruthy();
    expect(likes.length).toBeGreaterThan(2);
  });

  it("the TS regex has exactly one alternative per SQL LIKE, and each SQL pattern is a TS test address", () => {
    expect(tsAlts.length, `SQL ${newest}: ${likes.join(", ")}`).toBe(likes.length);
    for (const like of likes) {
      const sample = like.replace(/%/g, "someone").replace(/_/g, "x");
      expect(isTestAddress(sample), `${like} -> ${sample}`).toBe(true);
    }
  });
});
