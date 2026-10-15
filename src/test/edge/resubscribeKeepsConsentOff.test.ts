/**
 * Q?unsub-resubscribe-consent (owner, 2026-10-15, pop-up: "Only undo what they
 * turned off"). Resubscribe on the /unsubscribe page restores just what the
 * unsubscribe turned off; promotional (marketing) consent stays OFF unless the
 * person had agreed to it before.
 *
 * Before: email-unsubscribe's resubscribe wrote marketing_consent = true and
 * email_promotions = true whatever they had been, so anyone holding a
 * promotions link (the token never expires; a sign-up lead reminder carries
 * one) could opt in an address that never agreed, or switch on promotions a
 * member had turned off in Settings (measured on prod 2026-10-15: all 24
 * members with consent on have email_promotions off).
 *
 * Here the real function source runs through the edge harness against a member
 * whose rows CHANGE with every write it makes (the store below), so an
 * unsubscribe followed by a resubscribe is the real sequence:
 *   - never agreed to marketing: unsubscribe then resubscribe leaves consent
 *     OFF, and it is never written true;
 *   - agreed, receiving promotions: the undo puts both back on;
 *   - agreed, but promotions off in Settings: the undo leaves promotions off;
 *   - a resubscribe with no unsubscribe before it writes nothing;
 *   - a second unsubscribe keeps the first record;
 *   - unsubscribe still turns both off, and a failed read is a failure.
 */
// @mutate supabase/functions/email-unsubscribe/index.ts |   if (!saved) return\n |   if (!saved) { await writeEmailPromotions(supabase, userId, true); return }\n
// @mutate supabase/functions/email-unsubscribe/index.ts |     .update({ marketing_consent: saved.marketing_consent === true, promotions_before_unsubscribe: null }) |     .update({ marketing_consent: true, promotions_before_unsubscribe: null })
// @mutate supabase/functions/email-unsubscribe/index.ts |   await writeEmailPromotions(supabase, userId, saved.email_promotions === true) |   await writeEmailPromotions(supabase, userId, true)
// @mutate supabase/functions/email-unsubscribe/index.ts |     if (!columnMissing && !saved) { |     if (!columnMissing) {
// @mutate supabase/functions/email-unsubscribe/index.ts |         marketing_consent: profile?.marketing_consent === true, |         marketing_consent: true,
// @mutate supabase/functions/email-unsubscribe/index.ts |         email_promotions: prefsRow ? prefsRow.email_promotions !== false : true, |         email_promotions: true,
// @mutate supabase/functions/email-unsubscribe/index.ts |   if (readError && !columnMissing) throw new Error(`consent read failed: ${readError.message}`) |   if (readError && !columnMissing) return
// @mutate supabase/functions/email-unsubscribe/index.ts |   if (columnMissing) throw new Error('resubscribe needs promotions_before_unsubscribe (migration not deployed yet)') |   if (columnMissing) return
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetEmailMocks } from "./mocks/email";
import { postUnsubscribe, type UnsubscribeLink, type UnsubscribeAction } from "@/lib/emailUnsubscribe";

const BASE = "https://x.supabase.co";
const MEMBER = "member-1";
const link: UnsubscribeLink = { e: "member@example.com", sig: "ok-promotions", list: "promotions" };

type Profile = { user_id: string; marketing_consent: boolean; promotions_before_unsubscribe: unknown };
type Prefs = { user_id: string; email_promotions: boolean };

/** The member's rows, kept in step with every write the function makes. */
let profile: Profile;
let prefs: Prefs | null;
let seen = 0;

function seed(p: { consent: boolean; promotions: boolean | null; saved?: unknown }) {
  profile = { user_id: MEMBER, marketing_consent: p.consent, promotions_before_unsubscribe: p.saved ?? null };
  prefs = p.promotions === null ? null : { user_id: MEMBER, email_promotions: p.promotions };
  publish();
}

function publish() {
  scenario.reads.profiles = { rows: [profile] };
  scenario.reads.notification_preferences = { rows: prefs ? [prefs] : [] };
}

/** Fold the writes made since the last call into the rows. */
function applyWrites() {
  for (const w of scenario.writes.slice(seen)) {
    const p = w.payload as Record<string, unknown>;
    if (w.table === "profiles") profile = { ...profile, ...p } as Profile;
    if (w.table === "notification_preferences") prefs = { ...(prefs ?? { user_id: MEMBER, email_promotions: false }), ...p } as Prefs;
  }
  seen = scenario.writes.length;
  publish();
}

let fn: EdgeHarness;
async function tap(action: UnsubscribeAction) {
  const r = await postUnsubscribe(BASE, link, action, (async (input: RequestInfo | URL, init?: RequestInit) =>
    fn.fetch(new Request(input, init))) as typeof fetch);
  applyWrites();
  return r;
}

const state = () => ({ consent: profile.marketing_consent, promotions: prefs ? prefs.email_promotions : null });
const consentWrittenTrue = () =>
  scenario.writes.some((w) => w.table === "profiles" && (w.payload as Record<string, unknown>).marketing_consent === true);

describe("resubscribe undoes only what the unsubscribe turned off", () => {
  beforeEach(async () => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    resetEnv();
    seen = 0;
    scenario.reads.signup_leads = { rows: [] };
    setEnv({ SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET: "c" });
    fn = await loadEdgeFunction("email-unsubscribe");
  });

  it("never agreed to marketing: unsubscribe then resubscribe leaves consent off", async () => {
    seed({ consent: false, promotions: null });
    expect((await tap("unsubscribe")).ok).toBe(true);
    expect(state()).toEqual({ consent: false, promotions: false });
    expect((await tap("resubscribe")).ok).toBe(true);
    expect(consentWrittenTrue(), "consent is never written true for someone who never agreed").toBe(false);
    expect(state().consent).toBe(false);
    expect(profile.promotions_before_unsubscribe, "the record is cleared by the undo").toBeNull();
  });

  it("agreed and receiving promotions: the undo puts both back on", async () => {
    seed({ consent: true, promotions: true });
    await tap("unsubscribe");
    expect(state(), "the opt-out turns both off").toEqual({ consent: false, promotions: false });
    expect(profile.promotions_before_unsubscribe).toEqual({ marketing_consent: true, email_promotions: true });
    await tap("resubscribe");
    expect(state()).toEqual({ consent: true, promotions: true });
  });

  it("agreed, no preferences row yet (every sender reads that as promotions on): the undo puts both back on", async () => {
    seed({ consent: true, promotions: null });
    await tap("unsubscribe");
    await tap("resubscribe");
    expect(state()).toEqual({ consent: true, promotions: true });
  });

  it("agreed, but promotions turned off in Settings: the undo leaves promotions off", async () => {
    seed({ consent: true, promotions: false });
    await tap("unsubscribe");
    await tap("resubscribe");
    expect(state()).toEqual({ consent: true, promotions: false });
  });

  it("a resubscribe with no unsubscribe before it writes nothing", async () => {
    seed({ consent: false, promotions: false });
    expect((await tap("resubscribe")).ok).toBe(true);
    expect(scenario.writes.filter((w) => w.table !== "signup_leads")).toEqual([]);
  });

  it("a second unsubscribe keeps the first record, so the undo still restores what the person had", async () => {
    seed({ consent: true, promotions: true });
    await tap("unsubscribe");
    await tap("unsubscribe");
    expect(profile.promotions_before_unsubscribe).toEqual({ marketing_consent: true, email_promotions: true });
    await tap("resubscribe");
    expect(state()).toEqual({ consent: true, promotions: true });
  });

  it("a failed read fails the request and writes nothing", async () => {
    seed({ consent: false, promotions: null });
    scenario.reads.profiles = { rows: [profile], selectOverrides: [{ includes: "promotions_before_unsubscribe", result: { error: { message: "boom", code: "XX000" } } }] };
    for (const action of ["unsubscribe", "resubscribe"] as const) {
      expect(await postUnsubscribe(BASE, link, action, (async (i: RequestInfo | URL, n?: RequestInit) => fn.fetch(new Request(i, n))) as typeof fetch))
        .toEqual({ ok: false, error: "failed" });
    }
    expect(scenario.writes.filter((w) => w.table !== "signup_leads")).toEqual([]);
  });

  it("before the column is deployed: unsubscribe still turns both off, resubscribe fails rather than guess", async () => {
    seed({ consent: true, promotions: true });
    scenario.reads.profiles = { rows: [profile], selectOverrides: [{ includes: "promotions_before_unsubscribe", result: { error: { message: "column profiles.promotions_before_unsubscribe does not exist", code: "42703" } } }] };
    const off = await postUnsubscribe(BASE, link, "unsubscribe", (async (i: RequestInfo | URL, n?: RequestInit) => fn.fetch(new Request(i, n))) as typeof fetch);
    expect(off.ok).toBe(true);
    const writes = scenario.writes.filter((w) => w.table !== "signup_leads").map((w) => [w.table, w.payload]);
    expect(writes).toEqual([
      ["profiles", { marketing_consent: false }],
      ["notification_preferences", { user_id: MEMBER, email_promotions: false }],
    ]);
    const on = await postUnsubscribe(BASE, link, "resubscribe", (async (i: RequestInfo | URL, n?: RequestInit) => fn.fetch(new Request(i, n))) as typeof fetch);
    expect(on).toEqual({ ok: false, error: "failed" });
    expect(consentWrittenTrue()).toBe(false);
  });
});
