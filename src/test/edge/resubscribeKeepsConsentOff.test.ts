/**
 * Q?unsub-resubscribe-consent (owner, 2026-10-15, pop-up: "Only undo what they
 * turned off"). Resubscribe on the /unsubscribe page restores just the list the
 * person left; promotional (marketing) consent stays OFF unless they agreed to
 * it before.
 *
 * Before: email-unsubscribe's resubscribe wrote `profiles.marketing_consent:
 * true` whatever it had been, so anyone holding a promotions link (a sign-up
 * lead reminder carries one) could opt in an address that never ticked the
 * sign-up consent box.
 *
 * Now, against the real function source (edge harness), replaying its writes
 * onto a member's starting state:
 *   - a member who NEVER agreed unsubscribes and resubscribes: marketing
 *     consent ends OFF and is never written true; the promotions list comes back;
 *   - a member who agreed at sign-up (legal_acceptances.marketing_opted_in)
 *     gets consent back on resubscribe: the undo is a real undo;
 *   - the consent-record read is scoped to that member and to an opt-in, and a
 *     failed read is a failure, never "they agreed";
 *   - unsubscribe still turns BOTH flags off (the opt-out is not weakened).
 */
// @mutate supabase/functions/email-unsubscribe/index.ts |   let restoreConsent = !optOut\n  if (!optOut) { |   let restoreConsent = !optOut\n  if (optOut) {
// @mutate supabase/functions/email-unsubscribe/index.ts |   if (optOut \|\| restoreConsent) { |   if (true) {
// @mutate supabase/functions/email-unsubscribe/index.ts |       .eq('marketing_opted_in', true) |       .eq('user_id', userId)
// @mutate supabase/functions/email-unsubscribe/index.ts |       .eq('user_id', userId)\n      .eq('marketing_opted_in', true) |       .eq('marketing_opted_in', true)\n      .eq('marketing_opted_in', true)
// @mutate supabase/functions/email-unsubscribe/index.ts |     if (agreedError) throw new Error(`consent record read failed: ${agreedError.message}`) |     if (agreedError) restoreConsent = true
// @mutate supabase/functions/email-unsubscribe/index.ts |     restoreConsent = Array.isArray(agreed) && agreed.length > 0 |     restoreConsent = Array.isArray(agreed)
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetEmailMocks } from "./mocks/email";
import { postUnsubscribe, type UnsubscribeLink } from "@/lib/emailUnsubscribe";

const BASE = "https://x.supabase.co";
const MEMBER = "member-1";
const link: UnsubscribeLink = { e: "member@example.com", sig: "ok-promotions", list: "promotions" };

async function loadUnsub(): Promise<EdgeHarness> {
  setEnv({ SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET: "c" });
  return loadEdgeFunction("email-unsubscribe");
}

const viaHarness = (fn: EdgeHarness): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => fn.fetch(new Request(input, init))) as typeof fetch;

/** The member's two commercial flags after replaying every write the function made. */
function stateAfterWrites(start: { marketing_consent: boolean; email_promotions: boolean }) {
  const state = { ...start };
  for (const w of scenario.writes) {
    const p = w.payload as Record<string, unknown>;
    if (w.table === "profiles" && typeof p.marketing_consent === "boolean") state.marketing_consent = p.marketing_consent;
    if (w.table === "notification_preferences" && typeof p.email_promotions === "boolean") state.email_promotions = p.email_promotions;
  }
  return state;
}

const consentWrites = () =>
  scenario.writes
    .filter((w) => w.table === "profiles")
    .map((w) => (w.payload as Record<string, unknown>).marketing_consent);

describe("resubscribe restores only what the unsubscribe turned off", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    resetEnv();
    scenario.reads.profiles = { rows: [{ user_id: MEMBER }] };
    scenario.reads.notification_preferences = { rows: [{ user_id: MEMBER }] };
    scenario.reads.signup_leads = { rows: [] };
  });

  it("a member who never agreed to marketing unsubscribes then resubscribes: consent stays off", async () => {
    scenario.reads.legal_acceptances = { rows: [] };
    const fn = await loadUnsub();
    const off = await postUnsubscribe(BASE, link, "unsubscribe", viaHarness(fn));
    expect(off.ok).toBe(true);
    const on = await postUnsubscribe(BASE, link, "resubscribe", viaHarness(fn));
    expect(on.ok && on.action).toBe("resubscribe");

    expect(consentWrites(), "marketing consent is never written true for someone who never agreed").not.toContain(true);
    expect(stateAfterWrites({ marketing_consent: false, email_promotions: true })).toEqual({
      marketing_consent: false,
      email_promotions: true,
    });
  });

  it("a resubscribe on its own (no unsubscribe first) never turns consent on for a never-agreed member", async () => {
    scenario.reads.legal_acceptances = { rows: [] };
    const fn = await loadUnsub();
    const on = await postUnsubscribe(BASE, link, "resubscribe", viaHarness(fn));
    expect(on.ok).toBe(true);
    expect(consentWrites()).toEqual([]);
    expect(stateAfterWrites({ marketing_consent: false, email_promotions: false }).marketing_consent).toBe(false);
  });

  it("a member who ticked the sign-up box gets consent back: the undo is a real undo", async () => {
    scenario.reads.legal_acceptances = { rows: [{ id: "la-1" }] };
    const fn = await loadUnsub();
    await postUnsubscribe(BASE, link, "unsubscribe", viaHarness(fn));
    expect(stateAfterWrites({ marketing_consent: true, email_promotions: true }), "the opt-out turns both off").toEqual({
      marketing_consent: false,
      email_promotions: false,
    });
    await postUnsubscribe(BASE, link, "resubscribe", viaHarness(fn));
    expect(stateAfterWrites({ marketing_consent: true, email_promotions: true })).toEqual({
      marketing_consent: true,
      email_promotions: true,
    });
  });

  it("the consent record is read for THIS member and only as an opt-in", async () => {
    scenario.reads.legal_acceptances = { rows: [{ id: "la-1" }] };
    const fn = await loadUnsub();
    await postUnsubscribe(BASE, link, "resubscribe", viaHarness(fn));
    const reads = (scenario.readQueries ?? []).filter((q) => q.table === "legal_acceptances");
    expect(reads).toHaveLength(1);
    const eqs = reads[0].filters.filter((f) => f.op === "eq").map((f) => [f.column, f.value]);
    expect(eqs).toEqual(expect.arrayContaining([["user_id", MEMBER], ["marketing_opted_in", true]]));
  });

  it("a failed consent-record read fails the resubscribe and never turns consent on", async () => {
    scenario.reads.legal_acceptances = { error: { message: "boom", code: "XX000" } };
    const fn = await loadUnsub();
    const on = await postUnsubscribe(BASE, link, "resubscribe", viaHarness(fn));
    expect(on).toEqual({ ok: false, error: "failed" });
    expect(consentWrites()).not.toContain(true);
  });

  it("an unsubscribe never reads the consent record (it only ever turns consent off)", async () => {
    scenario.reads.legal_acceptances = { rows: [{ id: "la-1" }] };
    const fn = await loadUnsub();
    await postUnsubscribe(BASE, link, "unsubscribe", viaHarness(fn));
    expect((scenario.readQueries ?? []).filter((q) => q.table === "legal_acceptances")).toHaveLength(0);
    expect(consentWrites()).toEqual([false]);
  });
});
