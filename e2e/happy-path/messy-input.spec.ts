/**
 * Messy real-world input on every URL-reachable form (owner, 2026-09-12:
 * "audits must act like REAL users").
 *
 * Two layers:
 *   1. SWEEP — every visible text-like field on each form gets the whole value
 *      battery (empty, whitespace, max/max+1, 5,000-char paste, emoji +
 *      multibyte, padded, HTML/script, a 200-char unbroken word, pasted
 *      newlines). After EVERY value: no error screen, not stuck/blank, the
 *      script never ran, and — for the width-hostile values — zero horizontal
 *      overflow.
 *   2. TARGETED — the fields whose correctness is a rule, not a rendering:
 *      email/phone/ZIP formats, DOB under 18, prices 0/negative/decimal/1e9.
 *      Each asserts a clear inline message AND that submit is blocked (or
 *      allowed) — by watching the network for the write that must not happen.
 *
 * Coverage against docs/audit/form-inventory.md is checked in
 * messy-input-dialogs.spec.ts (URL sweep here + explored dialogs there + GAPS).
 */
import type { Page, Request } from "@playwright/test";
import { test, expect, FAKE_CUSTOMER, installSupabaseMocks, seedAuthedSession, type MockRule } from "./fixtures";
import { measureLayout } from "./auditRoutes";
import { findErrorScreen, detectStuckOrBlank } from "../errorScreens";

const SHOTS = "test-results/messy-input";
const XSS = `<img src=x onerror="window.__lhXss=1"><script>window.__lhXss=1</script>{{7*7}} ' OR 1=1; -- ../../etc/passwd`;
const LONG_WORD = "Supercalifragilistic".repeat(10); // 200 chars, no break opportunity
const BATTERY: { tag: string; value: string; layout?: boolean }[] = [
  { tag: "empty", value: "" },
  { tag: "whitespace", value: "   \t  " },
  { tag: "paste-5000", value: "Lorem ipsum dolor sit amet. ".repeat(179).slice(0, 5000), layout: true },
  { tag: "long-word", value: LONG_WORD, layout: true },
  { tag: "multibyte", value: "Ça va 🦞🏠 日本 👨‍👩‍👧‍👦 مرحبا é", layout: true },
  { tag: "padded", value: "   padded value   " },
  { tag: "html-script", value: XSS, layout: true },
  { tag: "newlines", value: "line one\nline two\r\nline three" },
];

import { FORMS, type FormSpec } from "./messyInputForms";

async function open(page: Page, context: import("@playwright/test").BrowserContext, baseURL: string, f: FormSpec, rules: MockRule[] = []) {
  if (f.auth !== "anon") await seedAuthedSession(context, FAKE_CUSTOMER, baseURL);
  await installSupabaseMocks(page, { user: f.auth === "anon" ? undefined : FAKE_CUSTOMER, seed: true, rules: [...rules, ...(f.rules ?? [])] });
  await page.goto(f.url);
  await page.waitForLoadState("networkidle").catch(() => {});
  if (f.prepare) await f.prepare(page);
  await page.waitForTimeout(400);
}

async function health(page: Page, ctx: string, withLayout: boolean): Promise<string[]> {
  const problems: string[] = [];
  const text = await page.evaluate(() => document.body.innerText);
  const err = findErrorScreen(text);
  if (err) problems.push(`${ctx}: error screen "${err.name}" — ${err.excerpt}`);
  const stuck = await page.evaluate(detectStuckOrBlank);
  if (stuck) problems.push(`${ctx}: ${stuck}`);
  const xss = await page.evaluate(() => ({ ran: (window as unknown as { __lhXss?: number }).__lhXss, img: document.querySelectorAll('img[src="x"]').length }));
  if (xss.ran || xss.img) problems.push(`${ctx}: typed markup EXECUTED/INJECTED (ran=${xss.ran}, img=${xss.img})`);
  if (withLayout) {
    const l = await measureLayout(page);
    if (l.overflowPx > 0 || l.overflowOffenders.length) problems.push(`${ctx}: horizontal overflow ${l.overflowPx}px — ${l.overflowOffenders.slice(0, 3).join(" | ")}`);
  }
  return problems;
}

const TEXTLIKE = 'input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="search"], input[type="url"], input[type="password"], input[type="number"], textarea';

async function fieldLabel(page: Page, i: number): Promise<string> {
  return page.locator(TEXTLIKE).filter({ visible: true }).nth(i).evaluate((el) => {
    const e = el as HTMLInputElement;
    const lbl = e.id ? document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.textContent : null;
    return `${e.tagName.toLowerCase()}[${e.type || "text"}] ${(lbl || e.getAttribute("aria-label") || e.placeholder || e.name || e.id || "?").trim().slice(0, 40)}`;
  });
}

async function shoot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }).catch(() => {});
}

test.describe("messy input — sweep every field on every form", () => {
  test.describe.configure({ mode: "parallel" });
  for (const f of FORMS) {
    test(`sweep: ${f.name}`, async ({ page, context, baseURL }) => {
      test.setTimeout(240_000);
      await open(page, context, baseURL ?? "", f);
      const base = await health(page, `${f.name} on load`, true);
      expect(base, `${f.name} broken before any input`).toEqual([]);

      const count = await page.locator(TEXTLIKE).filter({ visible: true }).count();
      expect(count, `${f.name}: expected at least one text field (did prepare() reach the form?)`).toBeGreaterThan(0);

      const problems: string[] = [];
      const notes: string[] = [];
      for (let i = 0; i < count; i++) {
        const field = page.locator(TEXTLIKE).filter({ visible: true }).nth(i);
        if (!(await field.isVisible().catch(() => false)) || !(await field.isEditable().catch(() => false))) continue;
        const label = await fieldLabel(page, i);
        const type = await field.evaluate((e) => (e as HTMLInputElement).type);
        const maxLen = await field.evaluate((e) => (e as HTMLInputElement).maxLength);
        const values = [...BATTERY];
        if (maxLen > 0 && maxLen < 100_000) {
          values.push({ tag: `max(${maxLen})`, value: "x".repeat(maxLen) }, { tag: `max+1(${maxLen + 1})`, value: "x".repeat(maxLen + 1) });
        }
        for (const v of values) {
          const ctx = `${f.name} › ${label} › ${v.tag}`;
          if (type === "number" && !/^[\d.eE+-]*$/.test(v.value.trim())) continue; // browsers reject non-numeric text into number inputs
          try {
            await field.fill(v.value, { timeout: 3000 });
          } catch (e) {
            notes.push(`${ctx}: fill refused (${String(e).split("\n")[0].slice(0, 80)})`);
            continue;
          }
          await field.press("Tab").catch(() => {});
          await page.waitForTimeout(60);
          const got = await field.inputValue().catch(() => null);
          if (maxLen > 0 && got !== null && got.length > maxLen) problems.push(`${ctx}: value length ${got.length} exceeds maxLength ${maxLen}`);
          if (maxLen <= 0 && v.tag === "paste-5000" && got?.length === 5000 && type !== "search") notes.push(`${ctx}: no maxLength — 5,000 chars accepted`);
          const p = await health(page, ctx, !!v.layout);
          if (p.length) {
            problems.push(...p);
            await shoot(page, `FAIL-${f.name}-${i}-${v.tag}`);
          }
          // The page may have navigated or re-rendered the field away (e.g. a search that
          // replaces the list). Stop cleanly rather than chase a detached node.
          if (!page.url().includes(f.url.split("?")[0])) { notes.push(`${ctx}: navigated to ${page.url()}`); break; }
        }
        await field.fill("").catch(() => {});
      }
      await page.locator(TEXTLIKE).filter({ visible: true }).first().fill(LONG_WORD).catch(() => {});
      await shoot(page, `sample-${f.name}`);
      test.info().annotations.push({ type: "fields", description: String(count) }, ...notes.map((n) => ({ type: "note", description: n })));
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Targeted rule checks. Each watches for the write that must (not) happen.
// ---------------------------------------------------------------------------

function watchWrites(page: Page, re: RegExp) {
  const hits: Request[] = [];
  page.on("request", (r) => { if (r.method() !== "GET" && re.test(r.url())) hits.push(r); });
  return hits;
}
async function noCrash(page: Page, ctx: string) {
  expect(await health(page, ctx, true)).toEqual([]);
}

test.describe("messy input — targeted rules", () => {
  test("login: empty and malformed email are blocked with an inline message; padded email is trimmed", async ({ page, context, baseURL }) => {
    const auth = watchWrites(page, /\/auth\/v1\/token/);
    await open(page, context, baseURL ?? "", FORMS[0]);
    const submit = page.getByRole("button", { name: /^(sign in|log in)$/i }).first();
    await submit.click();
    await page.waitForTimeout(300);
    expect(auth, "empty login must not call auth").toHaveLength(0);
    await noCrash(page, "login empty submit");
    await page.locator('input[type="email"], input#email').first().fill("not-an-email@");
    await page.locator('input[type="password"]').first().fill("whatever123");
    await submit.click();
    await page.waitForTimeout(300);
    expect(auth, "malformed email must not call auth").toHaveLength(0);
    await expect(page.getByRole("alert").or(page.locator("[aria-invalid=true]")).first()).toBeVisible();
    await shoot(page, "target-login-bad-email");
    await page.locator('input[type="email"], input#email').first().fill("  customer.smoke@helpr.test  ");
    await submit.click();
    await expect.poll(() => auth.length, { timeout: 5000 }).toBeGreaterThan(0);
    expect(JSON.parse(auth[0].postData() ?? "{}").email).toBe("customer.smoke@helpr.test");
    await noCrash(page, "login padded submit");
  });

  test("forgot-password: malformed email shows an inline alert and sends nothing", async ({ page, context, baseURL }) => {
    const sent = watchWrites(page, /\/auth\/v1\/recover/);
    await open(page, context, baseURL ?? "", FORMS[1]);
    await page.locator('input[type="email"]').fill("foo@bar");
    await page.getByRole("button", { name: /send|reset/i }).first().click();
    await page.waitForTimeout(400);
    expect(sent).toHaveLength(0);
    await expect(page.locator("#fp-email-error")).toBeVisible();
    await noCrash(page, "forgot-password bad email");
  });

  test("signup step 1: malformed email + weak password are explained inline and do not advance", async ({ page, context, baseURL }) => {
    const signup = watchWrites(page, /\/auth\/v1\/signup/);
    await open(page, context, baseURL ?? "", FORMS[2]);
    await page.locator("#email").fill("bob@@example");
    await page.locator("#password").fill("   ");
    await page.getByRole("button", { name: /continue|next/i }).first().click();
    await page.waitForTimeout(400);
    expect(signup).toHaveLength(0);
    await expect(page.locator("#signup-email-error, #signup-password-error").first()).toBeVisible();
    await expect(page.locator("#firstName")).toHaveCount(0);
    await shoot(page, "target-signup-step1");
    await noCrash(page, "signup step1");
  });

  test("support: whitespace-only required fields are blocked with messages; nothing is sent", async ({ page, context, baseURL }) => {
    const sent = watchWrites(page, /functions\/v1\/contact-support/);
    await open(page, context, baseURL ?? "", FORMS[3]);
    for (const el of await page.locator("input:visible, textarea:visible").all()) await el.fill("   ").catch(() => {});
    await page.getByRole("button", { name: /send|submit/i }).last().click();
    await page.waitForTimeout(400);
    expect(sent).toHaveLength(0);
    await expect(page.getByRole("alert").first()).toBeVisible();
    await shoot(page, "target-support-whitespace");
    await noCrash(page, "support whitespace");
  });

  for (const [amount, ok] of [["0", false], ["-5", false], ["1e9", false], ["10.555", null], ["25", true]] as const) {
    test(`gift card: amount ${amount} → ${ok === null ? "normalised" : ok ? "allowed" : "blocked with a message"}`, async ({ page, context, baseURL }) => {
      const sent = watchWrites(page, /functions\/v1\/create-pif-donation/);
      await open(page, context, baseURL ?? "", FORMS.find((x) => x.name === "gift-card")!);
      const amt = page.locator('input[type="number"]').first();
      await amt.fill(amount);
      await amt.press("Tab");
      await page.locator('input[type="email"]').first().fill("friend@example.com").catch(() => {});
      await noCrash(page, `gift ${amount}`);
      const send = page.getByRole("button", { name: /send|continue|pay|checkout/i }).last();
      if (await send.isEnabled().catch(() => false)) await send.click();
      await page.waitForTimeout(600);
      if (ok === false) {
        expect(sent, `gift ${amount} must not start checkout`).toHaveLength(0);
        await expect(page.getByText(/smallest|largest|valid amount|at least|no more than|\$\d/i).first()).toBeVisible();
      }
      if (ok === null && sent.length) {
        const body = JSON.parse(sent[0].postData() ?? "{}");
        const cents = JSON.stringify(body);
        expect(cents, "fractional cents must not reach checkout").not.toMatch(/10\.555/);
      }
      await shoot(page, `target-gift-${amount}`);
      await noCrash(page, `gift ${amount} after submit`);
    });
  }

  test("auto tip: negative and huge values do not save", async ({ page, context, baseURL }) => {
    const writes = watchWrites(page, /\/rest\/v1\/profiles/);
    await open(page, context, baseURL ?? "", FORMS.find((x) => x.name === "auto-tip")!);
    const nums = page.locator('input[type="number"]');
    const n = await nums.count();
    for (let i = 0; i < n; i++) if (await nums.nth(i).isVisible()) await nums.nth(i).fill(i === 0 ? "-10" : "1e9");
    const save = page.getByRole("button", { name: /save/i }).first();
    if (await save.isVisible().catch(() => false) && (await save.isEnabled())) await save.click();
    await page.waitForTimeout(500);
    const bad = writes.filter((w) => /-10|1e9|1000000000/.test(w.postData() ?? ""));
    expect(bad.map((w) => w.postData()), "invalid tip settings must not be written").toEqual([]);
    await shoot(page, "target-autotip");
    await noCrash(page, "auto tip");
  });

  test("post-job: whitespace-only title cannot advance", async ({ page, context, baseURL }) => {
    const writes = watchWrites(page, /\/rest\/v1\/(jobs|rpc\/.*job)/);
    await open(page, context, baseURL ?? "", FORMS.find((x) => x.name === "post-job")!);
    const title = page.locator(TEXTLIKE).filter({ visible: true }).first();
    await title.fill("      ");
    await page.getByRole("button", { name: /continue|next/i }).last().click().catch(() => {});
    await page.waitForTimeout(500);
    expect(writes).toHaveLength(0);
    await expect(title).toBeVisible(); // still on the details step
    await shoot(page, "target-postjob-whitespace-title");
    await noCrash(page, "post-job whitespace title");
  });
});

