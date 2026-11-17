// A sponsor sign-up is never silently dropped (2026-11-17: Playtopia and Mystic Forests Nursery were told
// "you're in" and no sponsor_signups row was saved). Prod edge logs showed POST sponsor-25days 200 ->
// sponsor_25days_on_for 200 and then no sponsor_create_signup: the only 200 path that saves nothing was the
// honeypot, a hidden "Company fax" field that browser autofill fills (it ignores autocomplete="off").
//
// @mutate supabase/functions/sponsor-25days/index.ts |   const honeypotFilled = typeof raw.company_fax === 'string' && raw.company_fax.trim() !== '' |   if (typeof raw.company_fax === 'string' && raw.company_fax.trim() !== '') return json({ ok: true, days: [], any_day: true })
// @mutate supabase/functions/sponsor-25days/index.ts |     logNotCreated('closed') |     void 0
// @mutate supabase/functions/sponsor-25days/index.ts |     await alertNotCreated(admin, 'save_failed', { error: error?.message ?? JSON.stringify(result), brand: s.brandName }) |     logNotCreated('save_failed')
// @mutate supabase/functions/sponsor-25days/index.ts |         await alertNotCreated(serviceClient(), 'crashed', { error: caughtMessage(e) }) |         void 0
// @mutate supabase/functions/sponsor-25days/index.ts |   else await sendConfirmation(admin, key, s) |   await sendConfirmation(admin, key, s)
// @mutate supabase/functions/sponsor-25days/index.ts |       severity: 'error', |       severity: 'info',
// @mutate supabase/functions/sponsor-25days/index.ts |   return json({ ok: true, id: signupId, days: s.days, any_day: s.anyDay }) |   return json({ ok: true, days: s.days, any_day: s.anyDay })
// @mutate supabase/functions/sponsor-25days/index.ts |       tags: { source: 'sponsor-25days', origin: 'server', reason }, |       tags: { source: 'sponsor-25days', origin: 'server' },
// @mutate src/components/sponsor/ClaimSection.tsx |           <label htmlFor="lh25-hp-check">Leave this empty</label> |           <label htmlFor="lh25-hp-check">Company fax</label>
// @mutate src/components/sponsor/ClaimSection.tsx |       report(e, { severity: "warning", tags: { source: "sponsor-signup", kind: "threw" } }); |       return;
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { sponsorPage as C } from "@/content/sponsorPage";
import { ClaimSection } from "@/components/sponsor/ClaimSection";
import type { SponsorPublicState } from "@/lib/sponsor/types";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const FN = path.resolve(__dirname, "../../supabase/functions/sponsor-25days/index.ts");
const code = blankComments(fs.readFileSync(FN, "utf8"));

/** handleSignup's body, comments blanked: from its signature to the next top-level function. */
function signupBody(): string {
  const start = code.indexOf("async function handleSignup(");
  expect(start).toBeGreaterThan(0);
  const end = code.indexOf("\nasync function ", start + 10);
  return code.slice(start, end > start ? end : undefined);
}

/** Each `return` statement in the body with the source lines just before it (the same block). */
function returnsWithLeadIn(body: string): { stmt: string; before: string }[] {
  const lines = body.split("\n");
  const out: { stmt: string; before: string }[] = [];
  lines.forEach((l, i) => {
    if (/^\s*(if \(.*\)\s*)?return\b/.test(l) || /\breturn (json|notFound|rateLimitResponse)\(/.test(l)) {
      out.push({ stmt: l.trim(), before: lines.slice(Math.max(0, i - 3), i + 1).join("\n") });
    }
  });
  return out;
}

const LOGGED = /(?:logNotCreated\(|await alertNotCreated\((?:admin|serviceClient\(\)), )'([a-z_]+)'/;

describe("sponsor-25days: every sign-up outcome that saves nothing is non-2xx and logged", () => {
  const body = signupBody();
  const returns = returnsWithLeadIn(body);

  it("finds the sign-up's returns (inventory floor)", () => {
    expect(returns.length).toBeGreaterThan(9);
  });

  it("only ONE return says ok, it is the last, and it carries the saved row's id", () => {
    const oks = returns.filter((r) => /ok:\s*true/.test(r.stmt));
    expect(oks.map((r) => r.stmt)).toEqual(["return json({ ok: true, id: signupId, days: s.days, any_day: s.anyDay })"]);
    // The ok return comes after the save call.
    expect(body.indexOf("ok: true")).toBeGreaterThan(body.indexOf("admin.rpc('sponsor_create_signup'"));
  });

  it("the honeypot never returns: a filled one is only logged, and the sign-up is saved", () => {
    const hp = body.slice(body.indexOf("raw.company_fax"), body.indexOf("validateSponsorSignup(raw)"));
    expect(hp.length).toBeGreaterThan(10);
    expect(hp).not.toMatch(/\breturn\b/);
    expect(body).toContain("if (honeypotFilled) console.warn(");
  });

  it("every early return (each non-created outcome) logs its reason right before it", () => {
    const early = returns.filter((r) => !/ok:\s*true/.test(r.stmt));
    expect(early.length).toBeGreaterThan(8);
    for (const r of early) {
      expect(r.before, `not logged: ${r.stmt}`).toMatch(LOGGED);
      expect(r.stmt, `a refusal must not be a 2xx ok: ${r.stmt}`).not.toMatch(/ok:\s*true/);
    }
    const reasons = [...body.matchAll(new RegExp(LOGGED.source, "g"))].map((m) => m[1]);
    for (const want of ["rate_limited", "switch_off", "closed", "unreadable_form", "unreadable_payload", "invalid", "invalid_logo", "logo_upload_failed", "days_full", "save_failed"]) {
      expect(reasons).toContain(want);
    }
  });

  it("OUR faults (upload, save, crash) write a paging error_logs row; refusals the visitor was told about do not", () => {
    const alertFn = code.slice(code.indexOf("async function alertNotCreated("), code.indexOf("function daysLabel("));
    expect(alertFn).toContain("logNotCreated(reason, context)");
    expect(alertFn).toContain("from('error_logs').insert(");
    expect(alertFn).toContain("severity: 'error',");
    expect(alertFn).toContain("tags: { source: 'sponsor-25days', origin: 'server', reason },");
    const logFn = code.slice(code.indexOf("function logNotCreated("), code.indexOf("async function alertNotCreated("));
    expect(logFn).toContain("console.warn(`[sponsor-25days] sign-up NOT saved: ${reason}`");
    expect(logFn).not.toContain("error_logs");
    const alerted = [...body.matchAll(/await alertNotCreated\(admin, '([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(alerted).toEqual(["logo_upload_failed", "save_failed"]);
    // A throw inside the sign-up is a lost sign-up too: the POST route catches it and pages.
    const route = code.slice(code.indexOf("return await handleSignup(req)"), code.indexOf("method_not_allowed"));
    expect(route).toContain("await alertNotCreated(serviceClient(), 'crashed', { error: caughtMessage(e) })");
  });

  it("a filled honeypot sends no confirmation to the given address and flags the admin email", () => {
    expect(body).toContain("await sendEmails(admin, emailSignup, logoPath, honeypotFilled)");
    const send = code.slice(code.indexOf("async function sendEmails("), code.indexOf("async function sendConfirmation("));
    expect(send).toMatch(/if \(honeypotFilled\)[^\n]*\n\s*else await sendConfirmation\(admin, key, s\)/);
    expect(code).toContain("${honeypotFilled ? '[Check: hidden field filled");
  });
});

const ST: SponsorPublicState = { on: true, greetingBrand: null, dayCounts: {}, maxPerDay: null, wall: [], testimonials: [], stats: {}, hasFounderPhoto: false };
const NOW = Date.UTC(2026, 10, 20);

function fillValid() {
  fireEvent.change(screen.getByLabelText(C.claim.form.brandName), { target: { value: "Bayou Candles" } });
  fireEvent.change(screen.getByLabelText(C.claim.form.contactName), { target: { value: "Ann Test" } });
  fireEvent.change(screen.getByLabelText(C.claim.form.email), { target: { value: "ann@example.com" } });
  fireEvent.change(screen.getByLabelText(C.claim.form.prizeDescription), { target: { value: "A candle set" } });
  fireEvent.click(screen.getByRole("checkbox", { name: C.claim.anyDay }));
  fireEvent.click(document.getElementById("lh25-agree")!);
}

describe("the /sponsor form: a failed send says so and keeps every entry", () => {
  it("a send that throws shows the not-saved banner and keeps the entries", async () => {
    const onSubmit = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    render(<ClaimSection state={ST} greetingBrand={null} refCode={null} nowMs={NOW} onSubmit={onSubmit} />);
    fillValid();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: C.claim.form.submit })); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toBe(C.claim.errors.generic);
    expect(C.claim.errors.generic).toContain("NOT saved");
    expect((screen.getByLabelText(C.claim.form.brandName) as HTMLInputElement).value).toBe("Bayou Candles");
    expect((screen.getByLabelText(C.claim.form.email) as HTMLInputElement).value).toBe("ann@example.com");
    expect(screen.queryByTestId("sponsor-thanks")).toBeNull();
  });

  it("a server error result shows the banner, not the thank-you", async () => {
    render(<ClaimSection state={ST} greetingBrand={null} refCode={null} nowMs={NOW} onSubmit={async () => ({ ok: false, kind: "error" })} />);
    fillValid();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: C.claim.form.submit })); });
    expect(screen.getByRole("alert").textContent).toBe(C.claim.errors.generic);
    expect(screen.queryByTestId("sponsor-thanks")).toBeNull();
  });

  it("the honeypot has no name, id or label browser autofill reads as a contact field", () => {
    render(<ClaimSection state={ST} greetingBrand={null} refCode={null} nowMs={NOW} onSubmit={async () => ({ ok: false, kind: "error" })} />);
    const hp = document.querySelector<HTMLInputElement>(".lh25-hp input");
    expect(hp).not.toBeNull();
    const label = document.querySelector(`label[for="${hp!.id}"]`)?.textContent ?? "";
    const autofillWords = /fax|phone|tel|mobile|company|organi[sz]ation|business|email|mail|address|street|city|zip|postal|country|name|url|website/i;
    for (const s of [hp!.name, hp!.id, label]) expect(s, s).not.toMatch(autofillWords);
    expect(hp!.getAttribute("autocomplete")).toBe("off");
    expect(hp!.tabIndex).toBe(-1);
  });
});
