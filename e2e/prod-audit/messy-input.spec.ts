/**
 * MESSY INPUT on PROD — every form, as the seeded test accounts, no mocks
 * (owner, 2026-09-12). Replaces the mocked e2e/happy-path/messy-input*.spec.ts.
 *
 * Three layers, one inventory (docs/audit/form-inventory.md):
 *   1. SWEEP — every visible text-like field on each URL-reachable form gets
 *      the whole battery (empty, whitespace, max/max+1, 5,000-char paste, a
 *      200-char word, emoji + multibyte, padded, HTML/script, pasted newlines;
 *      number fields: 0, negative, decimal, 1e9). After EVERY value: no error
 *      screen, not stuck/blank, the script never ran, and, for the
 *      width-hostile values, zero horizontal overflow at 375.
 *   2. TARGETED — the fields whose correctness is a rule, not a rendering:
 *      email/phone/ZIP formats, DOB under 18, prices 0/negative/decimal/1e9,
 *      whitespace-only required fields. Each asserts a clear inline message
 *      and that the submit was blocked (watching the wire for the write that
 *      must not happen) or allowed (the write happens, on a test-owned row,
 *      and is cleaned up).
 *   3. EXPLORE — the dialog- and state-gated forms (dispute, cancel, review,
 *      report, decline, chat composer, admin dialogs, later post-job steps),
 *      opened from REAL seeded records (scripts/audit/prod-seed.mjs and the
 *      lifecycle jobs) by pressing every safe visible control, two levels
 *      deep, and sweeping each field that appears. Behind a WRITE FIREWALL
 *      (harness.ts): reads are prod, every write the presser would cause is
 *      refused at the wire and logged, so pressing "Confirm" on a real
 *      dialog can never cancel a job or ban a user. A refused write whose
 *      body carries the whitespace-only value is a finding: the form let it
 *      through.
 *   Coverage: inventory − sweep credits − explore credits − stated GAPS must
 *   be empty, so a form added to the app without a sweep fails this file.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { APIRequestContext, Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import { ADMIN_VIEWS } from "../happy-path/auditRoutes";
import {
  LONG_WORD,
  MARKER,
  NEVER_PRESS,
  SKIP_BUTTON,
  SUPABASE_URL,
  TEXTLIKE,
  WS,
  assertHealthy,
  baselineOf,
  fieldLabel,
  fieldSignature,
  health,
  inventoryFiles,
  inventoryHints,
  newUserContext,
  resolveFixtures,
  restAs,
  sessionFor,
  settle,
  shoot,
  sweepField,
  watchWrites,
  writeFirewall,
  type Account,
  type Baseline,
  type Fixtures,
  type Session,
} from "./harness";
import { FORMS, GAPS } from "./messyInputForms";

const test = base;
const CREDITS = join("test-results", "messy-input-prod", "credits");

const sessions = new Map<Account, Session>();
let api: APIRequestContext;
let fx: Fixtures;

test.beforeAll(async ({ request }) => {
  api = request;
  for (const a of ["poster", "helper", "incomplete", "admin"] as Account[]) sessions.set(a, await sessionFor(request, a));
  fx = await resolveFixtures(request, sessions.get("poster")!, sessions.get("helper")!);
  mkdirSync(CREDITS, { recursive: true });
});

async function open(browser: Browser, f: { url: string; as: Account | null; prepare?: (p: Page) => Promise<void> }): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await newUserContext(browser, f.as ? sessions.get(f.as)! : null);
  const page = await ctx.newPage();
  await page.goto(f.url);
  await settle(page);
  if (f.prepare) await f.prepare(page);
  await page.waitForTimeout(300);
  return { ctx, page };
}

// ---------------------------------------------------------------------------
// 1. SWEEP every field on every URL-reachable form
// ---------------------------------------------------------------------------

test.describe("sweep every field on every form", () => {
  for (const f of FORMS) {
    test(`sweep: ${f.name}`, async ({ browser }, info) => {
      const { ctx, page } = await open(browser, f);
      // Nothing the sweep types may be saved: it is not a submit, and a sweep
      // that could write would be a sweep that could store 5,000 chars of Lorem
      // in a real profile.
      const blocked = await writeFirewall(ctx);
      const base = await health(page, `${f.name} on load`, { layout: true });
      expect(base, `${f.name} broken before any input`).toEqual([]);
      const baseline = await baselineOf(page);
      const fields = page.locator(TEXTLIKE).filter({ visible: true });
      const count = await fields.count();
      expect(count, `${f.name}: no text-like field found at ${page.url()} — the form did not render`).toBeGreaterThan(0);
      const problems: string[] = [];
      const notes: string[] = [];
      for (let i = 0; i < count; i++) {
        const field = page.locator(TEXTLIKE).filter({ visible: true }).nth(i);
        if (!(await field.isVisible().catch(() => false)) || !(await field.isEditable().catch(() => false))) continue;
        const label = await fieldLabel(field);
        const r = await sweepField(page, field, `${f.name} › ${label}`, { baseline, shoot: (n) => shoot(page, info, n) });
        problems.push(...r.problems);
        notes.push(...r.notes);
        if (!page.url().includes(f.url.split("?")[0])) {
          notes.push(`${f.name} › ${label}: navigated to ${page.url()}`);
          break;
        }
      }
      await page.locator(TEXTLIKE).filter({ visible: true }).first().fill(LONG_WORD).catch(() => {});
      await shoot(page, info, `sample-${f.name}`);
      info.annotations.push({ type: "fields", description: String(count) }, ...notes.map((n) => ({ type: "note", description: n })));
      if (blocked.length) info.annotations.push({ type: "firewall", description: blocked.join(", ") });
      await ctx.close();
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. TARGETED rules — each watches the wire for the write that must (not) happen
// ---------------------------------------------------------------------------

test.describe("targeted rules", () => {
  test("login: empty and malformed email are blocked inline; a padded email is trimmed before it leaves", async ({ browser }, info) => {
    const { ctx, page } = await open(browser, FORMS[0]);
    const auth = watchWrites(page, /\/auth\/v1\/token/);
    // The trimmed request is inspected and then refused at the wire: a real
    // password-grant attempt with a wrong password would count against the
    // test account's lockout.
    await page.route(`${SUPABASE_URL}/auth/v1/token*`, (route) => route.abort("blockedbyclient"));
    const submit = page.getByRole("button", { name: /^(sign in|log in)$/i }).first();
    await submit.click();
    await page.waitForTimeout(400);
    expect(auth, "empty login must not call auth").toHaveLength(0);
    await assertHealthy(page, info, "login-empty");
    const email = page.locator('input[type="email"], input#email').first();
    await email.fill("not-an-email@");
    await page.locator('input[type="password"]').first().fill("whatever123");
    await submit.click();
    await page.waitForTimeout(400);
    expect(auth, "malformed email must not call auth").toHaveLength(0);
    await expect(page.getByRole("alert").or(page.locator("[aria-invalid=true]")).first()).toBeVisible();
    await assertHealthy(page, info, "login-bad-email");
    await email.fill("  padded.person@example.com  ");
    await submit.click();
    await expect.poll(() => auth.length, { timeout: 8_000 }).toBeGreaterThan(0);
    expect(JSON.parse(auth[0].postData() ?? "{}").email).toBe("padded.person@example.com");
    await page.waitForTimeout(800);
    await assertHealthy(page, info, "login-padded", { allow: ["generic failure copy"] });
    await ctx.close();
  });

  test("forgot-password: malformed email shows an inline alert and sends nothing", async ({ browser }, info) => {
    const { ctx, page } = await open(browser, FORMS[1]);
    const sent = watchWrites(page, /\/auth\/v1\/recover/);
    await page.locator('input[type="email"]').fill("foo@bar");
    await page.getByRole("button", { name: /send|reset/i }).first().click();
    await page.waitForTimeout(400);
    expect(sent).toHaveLength(0);
    await expect(page.locator("#fp-email-error")).toBeVisible();
    await assertHealthy(page, info, "forgot-bad-email");
    await ctx.close();
  });

  test("signup step 1: malformed email + whitespace password are explained inline and do not advance", async ({ browser }, info) => {
    const { ctx, page } = await open(browser, FORMS[2]);
    const signup = watchWrites(page, /\/auth\/v1\/signup/);
    await page.locator("#email").fill("bob@@example");
    await page.locator("#password").fill("   ");
    await page.getByRole("button", { name: /continue|next/i }).first().click();
    await page.waitForTimeout(400);
    expect(signup).toHaveLength(0);
    await expect(page.locator("#signup-email-error, #signup-password-error").first()).toBeVisible();
    await expect(page.locator("#firstName")).toHaveCount(0);
    await assertHealthy(page, info, "signup-step1-bad");
    await ctx.close();
  });

  test("signup step 2: the DOB wheel cannot pick an under-18 year; phone and ZIP formats are refused inline; nothing is sent", async ({ browser }, info) => {
    const { ctx, page } = await open(browser, FORMS.find((x) => x.name === "signup-step2")!);
    const signup = watchWrites(page, /\/auth\/v1\/signup/);
    await expect(page.locator("#firstName"), "step 2 did not open").toBeVisible({ timeout: 10_000 });
    await page.locator("#dob").click();
    const years = page.getByRole("listbox", { name: /year/i }).getByRole("option");
    await expect(years.first()).toBeVisible({ timeout: 5_000 });
    const labels = (await years.allInnerTexts()).map((t) => Number(t.trim())).filter((n) => !Number.isNaN(n));
    const maxYear = Math.max(...labels);
    expect(maxYear, `the year wheel offers ${maxYear}: an under-18 date of birth is selectable`).toBeLessThanOrEqual(new Date().getFullYear() - 18);
    await page.keyboard.press("Escape");
    await shoot(page, info, "signup-step2-dob-wheel");
    for (const [id, bad] of [["#phone", "123"], ["#zipCode", "1234"]] as const) {
      const el = page.locator(id);
      if (!(await el.isVisible().catch(() => false))) continue;
      await el.fill(bad);
      await el.press("Tab");
    }
    await page.getByRole("button", { name: /create account|sign up|continue|finish/i }).last().click().catch(() => {});
    await page.waitForTimeout(600);
    expect(signup, "an invalid step 2 must not create an account").toHaveLength(0);
    await expect(page.getByText(/valid phone|10 digits|zip|5 digits|required|18 or older/i).first(), "no inline message for the bad phone/ZIP").toBeVisible();
    await assertHealthy(page, info, "signup-step2-bad");
    await ctx.close();
  });

  test("support: whitespace-only required fields are blocked with messages; nothing is sent", async ({ browser }, info) => {
    const { ctx, page } = await open(browser, FORMS.find((x) => x.name === "support")!);
    const sent = watchWrites(page, /functions\/v1\/contact-support/);
    for (const el of await page.locator("input:visible, textarea:visible").all()) await el.fill("   ").catch(() => {});
    await page.getByRole("button", { name: /send|submit/i }).last().click();
    await page.waitForTimeout(500);
    expect(sent).toHaveLength(0);
    await expect(page.getByRole("alert").or(page.getByText(/required|please|enter/i)).first()).toBeVisible();
    await assertHealthy(page, info, "support-whitespace");
    await ctx.close();
  });

  test("complete-profile: under-18 unreachable, 3-digit phone and 4-digit ZIP refused inline, whitespace name refused; no profile write", async ({ browser }, info) => {
    const { ctx, page } = await open(browser, FORMS.find((x) => x.name === "complete-profile")!);
    const writes = watchWrites(page, /\/rest\/v1\/(profiles|rpc\/complete_profile)/);
    await expect(page.locator("#firstName"), "complete-profile did not render for the incomplete seed account").toBeVisible({ timeout: 15_000 });
    await page.locator("#dob").click();
    const years = page.getByRole("listbox", { name: /year/i }).getByRole("option");
    await expect(years.first()).toBeVisible({ timeout: 5_000 });
    const maxYear = Math.max(...(await years.allInnerTexts()).map((t) => Number(t.trim())).filter((n) => !Number.isNaN(n)));
    expect(maxYear, "an under-18 date of birth is selectable").toBeLessThanOrEqual(new Date().getFullYear() - 18);
    await page.keyboard.press("Escape");
    await page.locator("#firstName").fill(WS);
    await page.locator("#lastName").fill(WS);
    await page.locator("#phone").fill("123");
    await page.locator("#zipCode").fill("1234");
    await page.locator("#zipCode").press("Tab");
    const submit = page.getByRole("button", { name: /save|continue|finish|complete|done/i }).last();
    await submit.click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);
    expect(writes.map((w) => `${w.method()} ${w.url()}`), "an invalid profile must not be written").toEqual([]);
    await expect(page.getByText(/valid phone|10 digits|zip|name|required|18 or older/i).first(), "no inline message").toBeVisible();
    await assertHealthy(page, info, "complete-profile-bad");
    await ctx.close();
  });

  for (const [amount, ok] of [["0", false], ["-5", false], ["1e9", false], ["10.555", null], ["25", true]] as const) {
    test(`gift card: amount ${amount} → ${ok === null ? "normalised" : ok ? "allowed" : "blocked with a message"}`, async ({ browser }, info) => {
      const { ctx, page } = await open(browser, FORMS.find((x) => x.name === "gift-card")!);
      const sent = watchWrites(page, /functions\/v1\/create-pif-donation|functions\/v1\/.*gift/);
      // A $25 test-mode Checkout session is harmless, but the sweep does not
      // need to reach Stripe to prove the client let the value through.
      await page.route(`${SUPABASE_URL}/functions/v1/**`, (route) => route.abort("blockedbyclient"));
      const amt = page.locator('input[type="number"]').first();
      await amt.fill(amount);
      await amt.press("Tab");
      await page.locator('input[type="email"]').first().fill("friend@example.com").catch(() => {});
      await assertHealthy(page, info, `gift-${amount}-typed`);
      const send = page.getByRole("button", { name: /send|continue|pay|checkout/i }).last();
      if (await send.isEnabled().catch(() => false)) await send.click();
      await page.waitForTimeout(800);
      if (ok === false) {
        expect(sent, `gift ${amount} must not start checkout`).toHaveLength(0);
        await expect(page.getByText(/smallest|largest|valid amount|at least|no more than|\$\d/i).first()).toBeVisible();
      }
      if (ok === true) expect(sent.length, "a valid amount must start checkout").toBeGreaterThan(0);
      if (ok === null && sent.length) {
        expect(JSON.stringify(JSON.parse(sent[0].postData() ?? "{}")), "fractional cents must not reach checkout").not.toMatch(/10\.555/);
      }
      await shoot(page, info, `gift-${amount}`);
      expect(await health(page, `gift ${amount} after submit`, { layout: true, allow: ok ? ["generic failure copy"] : [] })).toEqual([]);
      await ctx.close();
    });
  }

  test("auto tip: negative and huge values do not save", async ({ browser }, info) => {
    const { ctx, page } = await open(browser, FORMS.find((x) => x.name === "auto-tip")!);
    const writes = watchWrites(page, /\/rest\/v1\/profiles|\/rest\/v1\/rpc\/.*tip/);
    const nums = page.locator('input[type="number"]');
    const n = await nums.count();
    for (let i = 0; i < n; i++) if (await nums.nth(i).isVisible()) await nums.nth(i).fill(i === 0 ? "-10" : "1e9");
    const save = page.getByRole("button", { name: /save/i }).first();
    if ((await save.isVisible().catch(() => false)) && (await save.isEnabled())) await save.click();
    await page.waitForTimeout(800);
    const bad = writes.filter((w) => /-10|1e9|1000000000/.test(w.postData() ?? ""));
    expect(bad.map((w) => w.postData()), "invalid tip settings must not be written").toEqual([]);
    await assertHealthy(page, info, "auto-tip-bad");
    await ctx.close();
  });

  test("post-job: whitespace-only title cannot advance; price 0, negative, decimal and 1e9 are refused before checkout", async ({ browser }, info) => {
    const { ctx, page } = await open(browser, FORMS.find((x) => x.name === "post-job")!);
    const writes = watchWrites(page, /\/rest\/v1\/(jobs|rpc\/.*job)|functions\/v1\/.*(checkout|job)/);
    const title = page.locator(TEXTLIKE).filter({ visible: true }).first();
    await title.fill("      ");
    await page.getByRole("button", { name: /^(continue|next)$/i }).last().click().catch(() => {});
    await page.waitForTimeout(500);
    expect(writes).toHaveLength(0);
    await expect(title, "a whitespace title advanced past the details step").toBeVisible();
    await assertHealthy(page, info, "post-job-ws-title");
    // Reach the price with a real title, then try every bad price.
    await title.fill(`${MARKER} price probe`);
    const desc = page.getByRole("textbox", { name: /describe|description|details/i }).first();
    if (await desc.isVisible().catch(() => false)) await desc.fill("Messy-input probe. Never posted.");
    let price: Locator | null = null;
    for (let step = 0; step < 6 && !price; step++) {
      const p = page.getByRole("spinbutton").filter({ visible: true }).first();
      if (await p.isVisible().catch(() => false)) {
        price = p;
        break;
      }
      const cat = page.getByRole("button", { name: /cleaning|handyman|moving|yard|pet|errand/i }).filter({ visible: true }).first();
      if (await cat.isVisible().catch(() => false)) await cat.click().catch(() => {});
      const next = page.getByRole("button", { name: /^(continue|next)$/i }).filter({ visible: true }).last();
      if (!(await next.count()) || !(await next.isEnabled().catch(() => false))) break;
      await next.click();
      await page.waitForTimeout(500);
    }
    test.skip(!price, "GAP: no price field reached with the generic stepper — see screenshots");
    for (const [v, tag] of [["0", "zero"], ["-5", "negative"], ["10.555", "decimal"], ["1e9", "1e9"]] as const) {
      await price!.fill(v);
      await price!.press("Tab");
      await page.waitForTimeout(300);
      const next = page.getByRole("button", { name: /^(continue|next|review|post|pay)/i }).filter({ visible: true }).last();
      if (await next.isEnabled().catch(() => false)) await next.click().catch(() => {});
      await page.waitForTimeout(500);
      await shoot(page, info, `post-job-price-${tag}`);
      const msg = await page.getByText(/minimum|at least|maximum|no more than|valid (price|amount|budget)|whole dollar|\$\d/i).first().isVisible().catch(() => false);
      const stillHere = await price!.isVisible().catch(() => false);
      expect(msg || stillHere, `price ${v}: neither an inline message nor a blocked step`).toBe(true);
      expect(await health(page, `price ${v}`, { layout: true })).toEqual([]);
      if (!stillHere) break;
    }
    expect(writes.map((w) => w.url()), "a bad price must never reach a job write or checkout").toEqual([]);
    await ctx.close();
  });

  test("chat composer: whitespace-only and 4,001 chars are refused; a marked emoji/multibyte/HTML message is sent once, rendered inert, then deleted", async ({ browser }, info) => {
    test.skip(!fx.inProgressJob, "GAP: no in-progress job between the two accounts");
    const helper = sessions.get("helper")!;
    const poster = sessions.get("poster")!;
    const ctx = await newUserContext(browser, helper);
    const page = await ctx.newPage();
    await page.goto(`/messages?jobId=${fx.inProgressJob!.id}&userId=${poster.user.id}`);
    await settle(page);
    const box = page.getByRole("textbox", { name: /type a message/i });
    await expect(box).toBeVisible({ timeout: 30_000 });
    const send = page.getByRole("button", { name: /^send message$/i });
    const writes = watchWrites(page, /\/rest\/v1\/messages(\?|$)/);
    await box.fill(WS);
    await send.click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);
    expect(writes.length, "a whitespace-only message was sent").toBe(0);
    await box.fill("x".repeat(4001));
    expect((await box.inputValue()).length, "the composer accepted more than MESSAGE_MAX_LENGTH").toBeLessThanOrEqual(4000);
    const text = `${MARKER} Ça va 🦞 日本 <b>bold</b> <img src=x onerror="window.__lhXss=1">`;
    await box.fill(text);
    await send.click();
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_000);
    await assertHealthy(page, info, "chat-multibyte-html");
    expect(writes.filter((w) => w.method() === "POST").length).toBe(1);
    // Cleanup as the sender.
    const enc = encodeURIComponent(`*${MARKER}*`);
    const r = await restAs(api, helper, "delete", `messages?content=like.${enc}&sender_id=eq.${helper.user.id}&select=id`);
    expect(r.ok(), `cleanup: ${r.status()} ${await r.text()}`).toBe(true);
    await ctx.close();
  });
});

// ---------------------------------------------------------------------------
// 3. EXPLORE the dialog- and state-gated forms from real seeded records
// ---------------------------------------------------------------------------

interface Explore {
  name: string;
  as: Account | null;
  /** Resolved inside the test: fixtures and sessions exist only after beforeAll. */
  url: () => string;
  /** Skip reason when the seeded state this route needs is missing. */
  needs?: () => string | null;
}

const JOB_FIXTURES: Array<[keyof Omit<Fixtures, "goneJobId">, Account]> = [
  ["openJob", "helper"],
  ["openJob", "poster"],
  ["jobWithPendingApplicant", "poster"],
  ["inProgressJob", "poster"],
  ["inProgressJob", "helper"],
  ["disputedJob", "poster"],
  ["disputedJob", "helper"],
  ["completedJob", "poster"],
  ["completedJob", "helper"],
];
const PROFILE_TABS = ["profile", "security", "credentials", "notifications", "saved_helpers", "earnings", "gift_card", "pay_it_forward", "legal", "support", "pets", "str_settings", "auto_tip"];

const EXPLORE: Explore[] = [
  { name: "my-posts", url: () => "/my-posts", as: "poster" },
  { name: "my-jobs", url: () => "/my-jobs", as: "helper" },
  { name: "messages-poster", url: () => "/messages", as: "poster" },
  { name: "messages-helper", url: () => "/messages", as: "helper" },
  { name: "dashboard-helper", url: () => "/dashboard", as: "helper" },
  ...JOB_FIXTURES.map(([k, as]): Explore => ({
    name: `${k}-${as}`,
    as,
    url: () => `/jobs/${(fx[k] as { id: string } | null)?.id ?? ""}`,
    needs: () => (fx[k] ? null : `GAP: no seeded ${k} between the two accounts`),
  })),
  { name: "user-helper", url: () => `/user/${sessions.get("helper")!.user.id}`, as: "poster" },
  { name: "user-poster", url: () => `/user/${sessions.get("poster")!.user.id}`, as: "helper" },
  ...PROFILE_TABS.map((t): Explore => ({ name: `profile-${t}`, url: () => `/profile?tab=${t}`, as: "helper" })),
  { name: "admin", url: () => "/admin", as: "admin" },
  ...ADMIN_VIEWS.map((v): Explore => ({ name: `admin-${v}`, url: () => `/admin?view=${v}`, as: "admin" })),
];

test.describe("explore dialog-gated forms from real records", () => {
  test.describe.configure({ timeout: 10 * 60_000 });

  test("post-job: every later step's fields (budget, logistics, address, checkout), never paying", async ({ browser }, info) => {
    const { ctx, page } = await open(browser, { url: "/post-job", as: "poster", prepare: async (p) => {
      const fresh = p.getByRole("button", { name: /start fresh/i });
      if (await fresh.isVisible().catch(() => false)) await fresh.click();
    } });
    const blocked = await writeFirewall(ctx);
    const hints = inventoryHints();
    const credited = new Set<string>();
    const problems: string[] = [];
    const seen = new Set<string>();
    let swept = 0;
    const sweepHere = async (trail: string) => {
      const baseline = await baselineOf(page);
      const fields = page.locator(TEXTLIKE).filter({ visible: true });
      const n = await fields.count();
      for (let i = 0; i < n; i++) {
        const f = fields.nth(i);
        if (!(await f.isEditable().catch(() => false))) continue;
        const sig = await fieldSignature(f).catch(() => [] as string[]);
        const key = sig.slice(0, 3).join("|") + `#${trail}`;
        if (seen.has(key)) continue;
        seen.add(key);
        swept++;
        for (const [file, hs] of hints) if (hs.some((h) => sig.includes(h))) credited.add(file);
        const r = await sweepField(page, f, `post-job › ${trail} › ${sig[0] ?? `field ${i}`}`, { baseline, shoot: (nm) => shoot(page, info, nm) });
        problems.push(...r.problems);
      }
    };
    for (let step = 0; step < 8; step++) {
      await sweepHere(`step ${step}`);
      await shoot(page, info, `post-job-step-${step}`);
      // Minimum valid data so Continue enables: title, description, category, price, city.
      const title = page.getByRole("textbox", { name: /title|what do you need/i }).first();
      if (await title.isVisible().catch(() => false)) await title.fill(`${MARKER} explore`).catch(() => {});
      const desc = page.getByRole("textbox", { name: /describe|description|details/i }).first();
      if (await desc.isVisible().catch(() => false)) await desc.fill("Messy-input explore. Never posted.").catch(() => {});
      const cat = page.getByRole("button", { name: /cleaning|handyman|moving|yard|pet|errand/i }).filter({ visible: true }).first();
      if (await cat.isVisible().catch(() => false)) await cat.click().catch(() => {});
      const price = page.getByRole("spinbutton").filter({ visible: true }).first();
      if (await price.isVisible().catch(() => false)) await price.fill("40").catch(() => {});
      const city = page.getByRole("combobox", { name: /city|where/i }).or(page.getByPlaceholder(/city/i)).first();
      if (await city.isVisible().catch(() => false)) {
        await city.fill("Baton Rouge").catch(() => {});
        await page.getByRole("option").first().click({ timeout: 3_000 }).catch(() => {});
      }
      const pay = page.getByRole("button", { name: /^(pay|checkout|continue to payment|review & pay|post job)/i }).filter({ visible: true }).last();
      const next = page.getByRole("button", { name: /^(continue|next)$/i }).filter({ visible: true }).last();
      if ((await pay.count()) && !(await next.count())) {
        info.annotations.push({ type: "note", description: `stopped at the pay step after ${step} continues (never pressed)` });
        break;
      }
      if (!(await next.count()) || !(await next.isEnabled().catch(() => false))) {
        info.annotations.push({ type: "note", description: `step ${step}: Continue absent or disabled — required fields this driver does not know` });
        break;
      }
      await next.click();
      await page.waitForTimeout(600);
    }
    writeFileSync(join(CREDITS, "post-job-steps.json"), JSON.stringify({ credited: [...credited], fieldsSwept: swept }, null, 1));
    info.annotations.push({ type: "fields", description: `${swept} swept; credited ${[...credited].join(", ")}` }, { type: "firewall", description: blocked.join(", ") || "none" });
    await ctx.close();
    expect(problems, problems.join("\n")).toEqual([]);
  });

  for (const ex of EXPLORE) {
    test(`explore: ${ex.name}`, async ({ browser }, info) => {
      const why = ex.needs?.();
      test.skip(!!why, why ?? "");
      const url = ex.url();
      const hints = inventoryHints();
      const credited = new Set<string>();
      const problems: string[] = [];
      const { ctx, page } = await open(browser, { url, as: ex.as });
      const blocked = await writeFirewall(ctx);
      const wsEsc = JSON.stringify(WS).slice(1, -1);
      const load = async () => {
        await page.goto(url);
        await settle(page, 400);
      };
      const seen = new Set<string>();
      let fieldsSwept = 0;
      let shots = 0;

      const sweepNewFields = async (trail: string) => {
        const baseline = await baselineOf(page);
        const fields = page.locator(TEXTLIKE).filter({ visible: true });
        const n = await fields.count();
        for (let i = 0; i < n; i++) {
          const f = fields.nth(i);
          if (!(await f.isEditable().catch(() => false))) continue;
          const sig = await fieldSignature(f).catch(() => [] as string[]);
          const key = `${sig.slice(0, 3).join("|")}#${i}`;
          if (seen.has(key)) continue;
          seen.add(key);
          fieldsSwept++;
          for (const [file, hs] of hints) if (hs.some((h) => sig.includes(h))) credited.add(file);
          const r = await sweepField(page, f, `${ex.name} › ${trail} › ${sig[0] ?? `field ${i}`}`, {
            baseline,
            leave: WS,
            shoot: (nm) => (shots++ < 6 ? shoot(page, info, nm) : Promise.resolve("")),
          });
          problems.push(...r.problems);
        }
      };

      const pressables = async (scope: Locator) => {
        const names: string[] = [];
        for (const b of await scope.locator('button, [role="button"], [role="menuitem"]').filter({ visible: true }).all()) {
          const t = ((await b.getAttribute("aria-label").catch(() => null)) || (await b.innerText().catch(() => ""))).trim().replace(/\s+/g, " ");
          if (t && t.length < 60 && !SKIP_BUTTON.test(t) && !NEVER_PRESS.test(t) && !names.includes(t)) names.push(t);
        }
        return names.slice(0, 45);
      };
      const press = async (scope: Locator, name: string) => {
        const b = scope.locator('button, [role="button"], [role="menuitem"]').filter({ visible: true }).filter({ hasText: name }).first();
        const byLabel = scope.locator(`[aria-label="${name.replace(/"/g, '\\"')}"]`).filter({ visible: true }).first();
        const target = (await b.count()) ? b : byLabel;
        if (!(await target.isEnabled().catch(() => false))) return false;
        return target.click({ timeout: 2_000 }).then(() => true).catch(() => false);
      };
      const overlay = () => page.locator('[role="dialog"], [role="alertdialog"], [role="menu"]').filter({ visible: true }).last();
      const reset = async () => {
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(150);
        if (await overlay().count()) await page.keyboard.press("Escape").catch(() => {});
        if (!page.url().includes(url.split("?")[0]) || (await overlay().count())) await load();
      };
      // `baseline` is taken BEFORE the press: a loading state the press itself
      // introduced and never resolves is a finding; one already on screen
      // (the job map's own 15s watchdog) is not.
      const checkAfterPress = async (trail: string, baseline: Baseline) => {
        const before = blocked.length;
        await page.waitForTimeout(350);
        await sweepNewFields(trail);
        // A firewalled write shows the app's own failure copy; that is the firewall, not a defect.
        const allow = blocked.length > before ? ["generic failure copy", "section/data load failure"] : [];
        const p = await health(page, `${ex.name} › ${trail}`, { layout: true, allow, settleMs: 0, baseline });
        if (p.length) {
          problems.push(...p);
          if (shots++ < 6) await shoot(page, info, `FAIL-${ex.name}-${trail}`);
        }
      };

      await load();
      const base = await health(page, `${ex.name} on load`, { layout: true });
      expect(base, `${ex.name} broken before any input`).toEqual([]);
      await sweepNewFields("page");

      for (const top of await pressables(page.locator("body"))) {
        const beforeTop = await baselineOf(page);
        if (!(await press(page.locator("body"), top))) continue;
        await checkAfterPress(top, beforeTop);
        if (await overlay().count()) {
          for (const inner of await pressables(overlay())) {
            if (!(await overlay().count())) break;
            const before = page.url();
            const beforeInner = await baselineOf(page);
            if (!(await press(overlay(), inner))) continue;
            await checkAfterPress(`${top} › ${inner}`, beforeInner);
            if (page.url() !== before) break;
          }
        }
        await reset();
      }
      const stored = blocked.filter((b) => b.includes(wsEsc));
      if (stored.length) problems.push(`${ex.name}: a whitespace-only value reached a write (refused by the firewall): ${[...new Set(stored.map((s) => s.split(" ").slice(0, 2).join(" ")))].join(", ")}`);

      writeFileSync(join(CREDITS, `${ex.name}.json`), JSON.stringify({ credited: [...credited], fieldsSwept }, null, 1));
      await shoot(page, info, `sample-${ex.name}`);
      info.annotations.push(
        { type: "fields", description: `${fieldsSwept} swept; credited ${[...credited].join(", ")}` },
        { type: "firewall", description: blocked.map((b) => b.split(" ").slice(0, 2).join(" ")).join(", ") || "none" },
      );
      await ctx.close();
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Coverage: inventory − URL sweep − explore credits − stated gaps must be empty
// ---------------------------------------------------------------------------

test("coverage: every inventory file was swept, explored, or has a stated gap", async () => {
  const files = readdirSync(CREDITS);
  const inventory = inventoryFiles();
  const covered = new Set(FORMS.flatMap((f) => f.covers));
  for (const f of files) for (const c of JSON.parse(readFileSync(join(CREDITS, f), "utf8")).credited as string[]) covered.add(c);
  const unaccounted = inventory.filter((f) => !covered.has(f) && !GAPS[f]);
  const staleGaps = Object.keys(GAPS).filter((f) => covered.has(f) && !GAPS[f].startsWith("false positive"));
  console.log(`[messy-input prod coverage] ${covered.size} exercised, ${Object.keys(GAPS).length} gaps, ${inventory.length} inventory, ${files.length} explore credit files`);
  expect(unaccounted, `no sweep, no explore credit and no stated gap:\n${unaccounted.join("\n")}`).toEqual([]);
  expect(staleGaps, "listed as a gap but actually exercised — remove the gap").toEqual([]);
});
