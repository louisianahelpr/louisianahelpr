/**
 * CLASS GUARD, owner 2026-11-27 (polish audit 11-27 #1, HIGH): "after fees" comes off every job price. The Browse rows
 * lost it first (src/test/jobRowsPriceAlone1127.test.tsx); the audit found it on 7 more screens: the guest job sheet
 * and fact table ("You'd earn after fees"), the job page, Working/Applied cards, the apply sheet, the chat's job card,
 * Search rows, the "Application sent" sentence and the filter sheet's price note ("Cards show what you would take
 * home"). The price stands alone, one line; the guest sheet labels the row "Pay"; the filter note says "Filter by what
 * the job pays." The shared note component (AfterFeesNote) is gone, so no screen can bring it back by reuse.
 *
 * Inventory from source: every non-test .ts/.tsx/.mjs under src/ (comments blanked) and index.html.
 *
 * @mutate src/components/dashboard/GuestJobPreview.tsx |   if (net != null) facts.push({ label: "Pay", |   if (net != null) facts.push({ label: "You'd earn after fees",
 * @mutate src/lib/i18n/enJobsHelpr.ts |   "jh.f.priceHint": "Filter by what the job pays.", |   "jh.f.priceHint": "The price set on the job. Cards show what you would take home.",
 * @mutate src/components/messages/chatView/DealCard.tsx | ${formatPriceFloor(net)}</p> | ${formatPriceFloor(net)}</p><span>after fees</span>
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");

describe('no job price says "after fees" (owner 2026-11-27, polish audit #1)', () => {
  it("no source file draws the words or the old note", () => {
    const files = walkSource([resolve(ROOT, "src")], [".ts", ".tsx", ".mjs"])
      .map((f) => relative(ROOT, f))
      .filter((f) => !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"));
    // Floor: the walk read the app, not an empty folder.
    expect(files.length).toBeGreaterThan(1000);
    const hits = files.filter((f) => /after fees|AfterFeesNote/i.test(blankComments(readFileSync(resolve(ROOT, f), "utf8"))));
    expect(hits).toEqual([]);
    const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
    expect(html.length).toBeGreaterThan(1000);
    expect(html).not.toMatch(/after fees/i);
  });

  it("the shared note component is gone", () => {
    expect(existsSync(resolve(ROOT, "src/components/job/AfterFeesNote.tsx"))).toBe(false);
  });

  it('the guest sheet labels the row "Pay"; the filter sheet says what the filter does', () => {
    const sheet = blankComments(readFileSync(resolve(ROOT, "src/components/dashboard/GuestJobPreview.tsx"), "utf8"));
    expect(sheet).toContain('facts.push({ label: "Pay", value:');
    const helpr = readFileSync(resolve(ROOT, "src/lib/i18n/enJobsHelpr.ts"), "utf8");
    expect(helpr).toContain('"jh.f.priceHint": "Filter by what the job pays.",');
  });
});
