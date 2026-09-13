import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, assertHealthy, newUserContext } from "./fixtures";
import type { Session } from "./fixtures";
import { filteredOut, rotationFor, scenarioTitle } from "./scenarios";

/**
 * Journey — a field with a trailing icon still shows its value.
 *
 * Complete Profile grew a valid ✓ inside ZIP and the name fields (48b0d9b23)
 * with `pr-10`: 12px more than the 16px icon at right-3 needs. At ≤430 the
 * ZIP column was a third of the row (85px), so the padding left 29px for
 * five digits and the value read "705"; a long last name simply ran off with
 * no ellipsis (coordinator, prod, 2026-09-12). Signup step 2 carries the
 * identical fields.
 *
 * The CLASS, checked over the screen's OWN inventory — every <input> with an
 * absolutely-positioned sibling on its trailing side:
 *   1. the value never runs under the icon (padding ≥ the icon's coverage);
 *   2. the padding is not padded past the icon (≤ coverage + 8px), which is
 *      what starves a narrow field;
 *   3. a short fixed-length field (maxLength ≤ 10) fits its longest value;
 *   4. a value that does overflow ellipsizes instead of being cut mid-glyph.
 * Measured with the field's own font, so a type-scale change moves the number.
 */

const rotation = rotationFor(4);

type Row = { id: string; coverage: number; padR: number; contentW: number; maxW: number | null; overflows: boolean; ellipsis: boolean; width: number };

async function trailingIconRows(page: Page): Promise<Row[]> {
  return page.evaluate(() => {
    const out: Row[] = [];
    for (const input of Array.from(document.querySelectorAll("input"))) {
      if (input.type === "file" || input.type === "checkbox" || input.type === "radio") continue;
      const wrap = input.parentElement;
      if (!wrap) continue;
      const ir = input.getBoundingClientRect();
      if (ir.width < 2) continue;
      const icon = Array.from(wrap.children).find((c) => {
        if (c === input) return false;
        const cs = getComputedStyle(c);
        if (cs.position !== "absolute" || cs.display === "none") return false;
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.left > ir.left + ir.width / 2;
      });
      if (!icon) continue;
      const cr = icon.getBoundingClientRect();
      const cs = getComputedStyle(input);
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const padR = parseFloat(cs.paddingRight);
      const contentW = ir.width - parseFloat(cs.paddingLeft) - padR;
      const max = input.maxLength > 0 && input.maxLength <= 10 ? input.maxLength : null;
      out.push({
        id: input.id || input.name || input.placeholder || "?",
        coverage: Math.round(ir.right - cr.left),
        padR,
        contentW: Math.round(contentW),
        maxW: max ? Math.round(ctx.measureText("0".repeat(max)).width) : null,
        overflows: ctx.measureText(input.value).width > contentW,
        ellipsis: cs.textOverflow === "ellipsis",
        width: Math.round(ir.width),
      });
    }
    return out;
  });
}

function judge(rows: Row[], where: string): string[] {
  const bad: string[] = [];
  for (const r of rows) {
    const tag = `${where} #${r.id} (${r.width}px wide, icon covers ${r.coverage}px, padding-right ${r.padR}px)`;
    if (r.padR < r.coverage) bad.push(`${tag}: value runs under the icon`);
    if (r.padR > r.coverage + 8) bad.push(`${tag}: padded ${r.padR - r.coverage}px past the icon — starves the field`);
    if (r.maxW !== null && r.contentW < r.maxW) bad.push(`${tag}: ${r.contentW}px of room for a ${r.maxW}px value`);
    if (r.overflows && !r.ellipsis) bad.push(`${tag}: value overflows with no ellipsis`);
  }
  return bad;
}

const guestTitle = scenarioTitle({ journey: "trailing-icon", persona: "new", state: "approved", rotation, outcome: "smooth" });
test(guestTitle, async ({ browser, journey }) => {
  test.skip(filteredOut(guestTitle), "SCENARIO pins another scenario");
  const ctx = await newUserContext(browser, null, { rotation });
  const page = journey.track("guest", await ctx.newPage());
  await test.step("signup step 2: every ✓-bearing field shows its value", async () => {
    await page.goto("/signup");
    await page.locator("#email").fill(`trailing-icon-${Date.now()}@example.com`);
    await page.locator("#password").fill("Ti!journey12345");
    for (const id of ["#policies", "#age-confirm"]) await page.locator(id).click();
    await page.getByRole("button", { name: /continue/i }).first().click();
    await expect(page.locator("#firstName")).toBeVisible({ timeout: 30_000 });
    await page.locator("#firstName").fill("Marguerite");
    await page.locator("#lastName").fill("Thibodeaux-Broussard");
    await page.locator("#phone").fill("5045550199");
    await page.locator("#location").fill("Lafayette, LA");
    await page.locator("#zipCode").fill("70528");
    await page.locator("#zipCode").blur();
    await page.waitForTimeout(600);
    const rows = await trailingIconRows(page);
    expect(rows.length, "signup step 2 has ✓ icons on its fields; none were found").toBeGreaterThan(0);
    await page.locator("#zipCode").scrollIntoViewIfNeeded();
    await journey.milestone(page, "signup-step2-fields");
    expect(judge(rows, "/signup")).toEqual([]);
    await assertHealthy(page, "signup step 2");
  });
  await ctx.close();
});

/** The incomplete-profile seed account, minted locally (service role in .env); CI has no secret for it yet. */
function incompleteSession(): Session | null {
  if (!existsSync(join(process.cwd(), ".env"))) return null;
  const out = execFileSync("node", ["scripts/test-signin-link.mjs", "incomplete-e2e", "--session", "--json"], { encoding: "utf8", maxBuffer: 1 << 24 });
  const raw = JSON.parse(out) as { value: string };
  return JSON.parse(raw.value) as Session;
}

const incompleteTitle = scenarioTitle({ journey: "trailing-icon", persona: "new", state: "pending", rotation, outcome: "smooth" });
test(incompleteTitle, async ({ browser, journey }) => {
  test.skip(filteredOut(incompleteTitle), "SCENARIO pins another scenario");
  const session = incompleteSession();
  test.skip(!session, "needs .env (service role) to mint the incomplete-e2e account");
  const ctx = await newUserContext(browser, session, { rotation });
  const page = journey.track("incomplete", await ctx.newPage());
  await test.step("/complete-profile: every ✓-bearing field shows its value", async () => {
    await page.goto("/complete-profile");
    await expect(page.locator("#lastName")).toBeVisible({ timeout: 60_000 });
    await page.locator("#firstName").fill("Marguerite");
    await page.locator("#lastName").fill("Thibodeaux-Broussard");
    await page.locator("#zipCode").fill("70528");
    await page.locator("#zipCode").blur();
    await page.waitForTimeout(600);
    const rows = await trailingIconRows(page);
    expect(rows.length, "/complete-profile has ✓ icons on its fields; none were found").toBeGreaterThan(0);
    await page.locator("#zipCode").scrollIntoViewIfNeeded();
    await journey.milestone(page, "complete-profile-fields");
    expect(judge(rows, "/complete-profile")).toEqual([]);
    await assertHealthy(page, "/complete-profile");
  });
  await ctx.close();
});
