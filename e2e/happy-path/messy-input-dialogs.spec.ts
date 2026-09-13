/**
 * Messy input on the DIALOG- and STATE-gated forms: the dispute, cancel,
 * review, report, decline, chat composer, admin dialogs, later post-job steps.
 * These are where real users type the most, and no URL reaches them.
 *
 * Instead of a hand-written click path per dialog (which rots the day a label
 * changes), each seeded route is EXPLORED: press every safe visible button, and
 * whenever that reveals a text field that was not there before, run the messy
 * battery on it, then Escape / return and press the next button. Two levels
 * deep, so "Manage → Cancel job → reason" is reached.
 *
 * Attribution to the inventory is derived, not claimed: each field's id,
 * placeholder, aria-label and name (and those of its dialog) are matched
 * against the literal hints scripts/form-inventory.mjs extracted from each
 * source file. The final test unions those credits with the URL sweep in
 * messy-input.spec.ts and fails on any inventory file with neither a credit nor
 * a stated gap.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Page, Locator } from "@playwright/test";
import { test, expect, FAKE_CUSTOMER, FAKE_HELPER, installSupabaseMocks, seedAuthedSession, mockTable, type FakeUser, type MockRule } from "./fixtures";
import { ADMIN_VIEWS, measureLayout } from "./auditRoutes";
import { findErrorScreen, detectStuckOrBlank } from "../errorScreens";
import { FORMS, GAPS } from "./messyInputForms";

const OUT = "test-results/messy-input";
const CREDITS = join(OUT, "credits");
const WS = "   \t  ";
const VALUES = [
  { tag: "whitespace", value: WS, layout: false },
  { tag: "paste-5000", value: "Lorem ipsum dolor sit amet. ".repeat(179).slice(0, 5000), layout: true },
  { tag: "long-word", value: "Supercalifragilistic".repeat(10), layout: true },
  { tag: "multibyte", value: "Ça va 🦞🏠 日本 👨‍👩‍👧‍👦 مرحبا", layout: true },
  { tag: "html-script", value: `<img src=x onerror="window.__lhXss=1"><script>window.__lhXss=1</script>{{7*7}}`, layout: true },
  { tag: "newlines", value: "a\nb\r\nc", layout: false },
  { tag: "number-junk", value: "-1", layout: false },
  { tag: "number-huge", value: "1e9", layout: false },
];
const TEXTLIKE = 'input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="search"], input[type="url"], input[type="password"], input[type="number"], textarea, [contenteditable="true"]';
const SKIP_BUTTON = /sign ?out|log ?out|switch account|back to|^close$|^×$|dismiss|skip|not now|toggle theme|dark mode|light mode|menu/i;

const JOB = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;
const admin: MockRule[] = [mockTable("user_roles", [{ role: "admin" }])];

interface Explore { name: string; url: string; user?: FakeUser; rules?: MockRule[]; prepare?: (p: Page) => Promise<void> }
const EXPLORE: Explore[] = [
  { name: "my-posts", url: "/my-posts", user: FAKE_CUSTOMER },
  { name: "my-jobs", url: "/my-jobs", user: FAKE_HELPER },
  { name: "messages-customer", url: "/messages", user: FAKE_CUSTOMER },
  { name: "messages-helper", url: "/messages", user: FAKE_HELPER },
  ...[1, 2, 3, 4, 5, 6, 7].flatMap((n) => [
    { name: `job-${n}-customer`, url: `/jobs/${JOB(n)}`, user: FAKE_CUSTOMER },
    { name: `job-${n}-helper`, url: `/jobs/${JOB(n)}`, user: FAKE_HELPER },
  ]),
  { name: "dashboard-helper", url: "/dashboard", user: FAKE_HELPER },
  { name: "user-helper", url: `/user/${FAKE_HELPER.id}`, user: FAKE_CUSTOMER },
  { name: "user-customer", url: `/user/${FAKE_CUSTOMER.id}`, user: FAKE_HELPER },
  ...["profile", "security", "credentials", "notifications", "saved_helpers", "earnings", "gift_card", "pay_it_forward", "legal", "support", "pets", "str_settings"].map((t) => ({
    name: `profile-${t}`, url: `/profile?tab=${t}`, user: FAKE_CUSTOMER,
  })),
  { name: "post-job", url: "/post-job", user: FAKE_CUSTOMER },
  { name: "reset-password", url: "/reset-password" },
  { name: "signup", url: "/signup" },
  { name: "admin", url: "/admin", user: FAKE_CUSTOMER, rules: admin },
  ...ADMIN_VIEWS.map((v) => ({ name: `admin-${v}`, url: `/admin?view=${v}`, user: FAKE_CUSTOMER, rules: admin })),
];

function inventoryHints(): Map<string, string[]> {
  const md = readFileSync(join(process.cwd(), "docs/audit/form-inventory.md"), "utf8");
  const m = new Map<string, string[]>();
  for (const row of md.matchAll(/^\| `(src\/[^`]+)` \|[^|]*\|[^|]*\|[^|]*\| (.*) \|$/gm)) {
    m.set(row[1], row[2].split(" · ").map((s) => s.replace(/\\\|/g, "|").trim()).filter((s) => s.length > 2));
  }
  return m;
}

async function fieldSignature(field: Locator): Promise<string[]> {
  return field.evaluate((el) => {
    const out: string[] = [];
    const take = (e: Element | null) => {
      if (!e) return;
      for (const a of ["id", "placeholder", "aria-label", "name"]) { const v = e.getAttribute(a); if (v) out.push(v); }
    };
    take(el);
    const lbl = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    if (lbl?.textContent) out.push(lbl.textContent.trim());
    let p = el.parentElement;
    for (let i = 0; p && i < 6; i++, p = p.parentElement) take(p);
    return out;
  });
}

async function health(page: Page, ctx: string, layout: boolean): Promise<string[]> {
  const out: string[] = [];
  const text = await page.evaluate(() => document.body.innerText).catch(() => "");
  const err = findErrorScreen(text);
  if (err) out.push(`${ctx}: error screen "${err.name}" — ${err.excerpt}`);
  const stuck = await page.evaluate(detectStuckOrBlank).catch(() => null);
  if (stuck) out.push(`${ctx}: ${stuck}`);
  const xss = await page.evaluate(() => ((window as unknown as { __lhXss?: number }).__lhXss ?? 0) + document.querySelectorAll('img[src="x"]').length).catch(() => 0);
  if (xss) out.push(`${ctx}: typed markup executed or was injected into the DOM`);
  if (layout) {
    const l = await measureLayout(page).catch(() => null);
    if (l && (l.overflowPx > 0 || l.overflowOffenders.length)) out.push(`${ctx}: horizontal overflow ${l.overflowPx}px — ${l.overflowOffenders.slice(0, 2).join(" | ")}`);
  }
  return out;
}

test.describe("messy input — dialog and state-gated forms", () => {
  test.describe.configure({ mode: "parallel" });
  mkdirSync(CREDITS, { recursive: true });

  for (const ex of EXPLORE) {
    test(`explore: ${ex.name}`, async ({ page, context, baseURL }) => {
      test.setTimeout(420_000);
      const hints = inventoryHints();
      const credited = new Set<string>();
      const problems: string[] = [];
      const storedWhitespace: string[] = [];
      page.on("request", (r) => {
        if (r.method() === "GET" || !r.url().includes("supabase.co")) return;
        const body = r.postData() ?? "";
        if (body.includes(JSON.stringify(WS).slice(1, -1))) storedWhitespace.push(`${r.method()} ${new URL(r.url()).pathname}`);
      });
      if (ex.user) await seedAuthedSession(context, ex.user, baseURL ?? "");
      await installSupabaseMocks(page, { user: ex.user, seed: true, rules: ex.rules });

      const load = async () => {
        await page.goto(ex.url);
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(500);
        if (ex.prepare) await ex.prepare(page);
      };
      await load();
      const seen = new Set<string>();
      let fieldsSwept = 0;
      let shots = 0;

      const sweepNewFields = async (trail: string) => {
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
          const type = await f.evaluate((e) => (e as HTMLInputElement).type ?? "text").catch(() => "text");
          const maxLen = await f.evaluate((e) => (e as HTMLInputElement).maxLength ?? -1).catch(() => -1);
          for (const v of VALUES) {
            if (type === "number" ? !v.tag.startsWith("number") : v.tag.startsWith("number")) continue;
            const ctx = `${ex.name} › ${trail} › ${sig[0] ?? "field"} › ${v.tag}`;
            if (!(await f.fill(v.value, { timeout: 2000 }).then(() => true).catch(() => false))) break;
            await page.waitForTimeout(50);
            const got = await f.inputValue().catch(() => null);
            if (maxLen > 0 && got && got.length > maxLen) problems.push(`${ctx}: ${got.length} chars in a maxLength ${maxLen} field`);
            const p = await health(page, ctx, v.layout);
            if (p.length) {
              problems.push(...p);
              if (shots++ < 6) await page.screenshot({ path: `${OUT}/FAIL-dialog-${ex.name}-${shots}.png` }).catch(() => {});
            }
          }
          // Whitespace in every field, then press the dialog's own primary action:
          // a write carrying the raw whitespace means it was stored, not rejected.
          await f.fill(WS).catch(() => {});
        }
        return n;
      };

      await sweepNewFields("page");

      const buttonsHere = async (scope: Locator) => {
        const bs = scope.getByRole("button").filter({ visible: true });
        const names: string[] = [];
        for (const b of await bs.all()) {
          const t = ((await b.getAttribute("aria-label").catch(() => null)) || (await b.innerText().catch(() => ""))).trim().replace(/\s+/g, " ");
          if (t && t.length < 60 && !SKIP_BUTTON.test(t) && !names.includes(t)) names.push(t);
        }
        return names.slice(0, 45);
      };

      const press = async (scope: Locator, name: string) => {
        const b = scope.getByRole("button", { name, exact: true }).filter({ visible: true }).first();
        if (!(await b.isEnabled().catch(() => false))) return false;
        return b.click({ timeout: 2000 }).then(() => true).catch(() => false);
      };
      const dialog = () => page.locator('[role="dialog"], [role="alertdialog"]').filter({ visible: true }).last();
      const reset = async () => {
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(150);
        if (await dialog().count()) await page.keyboard.press("Escape").catch(() => {});
        if (!page.url().includes(ex.url.split("?")[0]) || (await dialog().count())) await load();
      };

      for (const top of await buttonsHere(page.locator("body"))) {
        if (!(await press(page.locator("body"), top))) continue;
        await page.waitForTimeout(350);
        await sweepNewFields(top);
        if (await dialog().count()) {
          for (const inner of await buttonsHere(dialog())) {
            if (!(await dialog().count())) break;
            const before = page.url();
            if (!(await press(dialog(), inner))) continue;
            await page.waitForTimeout(350);
            await sweepNewFields(`${top} › ${inner}`);
            if (page.url() !== before) break;
          }
        }
        await reset();
      }
      if (storedWhitespace.length) problems.push(`${ex.name}: whitespace-only field value sent in a write: ${[...new Set(storedWhitespace)].join(", ")}`);

      writeFileSync(join(CREDITS, `${ex.name}.json`), JSON.stringify({ credited: [...credited], fieldsSwept }, null, 1));
      await page.screenshot({ path: `${OUT}/sample-dialog-${ex.name}.png` }).catch(() => {});
      test.info().annotations.push({ type: "fields", description: `${fieldsSwept} swept; credited ${[...credited].join(", ")}` });
      expect.soft(problems, problems.join("\n")).toEqual([]);
    });
  }
});

test("coverage: inventory − URL sweep − explored dialogs − stated gaps is empty", async () => {
  test.setTimeout(3_600_000);
  // Explore tests run in parallel workers; wait for all of their credit files.
  const t0 = Date.now();
  while (readdirSync(CREDITS).length < EXPLORE.length && Date.now() - t0 < 3_500_000) await new Promise((r) => setTimeout(r, 5000));
  expect(readdirSync(CREDITS).length, "every explore test must write its credits").toBe(EXPLORE.length);
  const md = readFileSync(join(process.cwd(), "docs/audit/form-inventory.md"), "utf8");
  const inventory = [...md.matchAll(/^\| `(src\/[^`]+)`/gm)].map((m) => m[1]);
  const covered = new Set(FORMS.flatMap((f) => f.covers));
  for (const f of readdirSync(CREDITS)) for (const c of JSON.parse(readFileSync(join(CREDITS, f), "utf8")).credited) covered.add(c);
  const unaccounted = inventory.filter((f) => !covered.has(f) && !GAPS[f]);
  const staleGaps = Object.keys(GAPS).filter((f) => covered.has(f) && !GAPS[f].startsWith("false positive"));
  console.log(`[messy-input coverage] ${covered.size} exercised, ${Object.keys(GAPS).length} gaps, ${inventory.length} inventory`);
  expect(unaccounted, `no sweep and no stated gap:\n${unaccounted.join("\n")}`).toEqual([]);
  expect(staleGaps, "listed as a gap but actually exercised — remove the gap").toEqual([]);
});
