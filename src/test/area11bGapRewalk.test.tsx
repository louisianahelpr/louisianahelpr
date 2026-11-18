/**
 * Area 11b gap re-walk (design audit 11-18, ~/.lh-shots/design-audit-areas/11b-gap-rewalk/FINDINGS.md).
 * One guard per finding fixed here; each @mutate line puts the old state back and must turn its test red.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import { sponsorPage } from "@/content/sponsorPage";
import { enNewMember } from "@/lib/i18n/enNewMember";
import { esNewMember } from "@/lib/i18n/esNewMember";
import { placeName } from "@/pages/admin/preview/previewParts";

const code = (p: string) => blankComments(readFileSync(p, "utf8"));

describe("Area 11b gap re-walk", () => {
  // @mutate src/components/sponsor/ClaimSection.tsx | <p className="lh25-thanks-body" data-testid="sponsor-thanks-days-note">{C.thankYou.daysNote}</p> | <a href="data:text/calendar;charset=utf-8,">Add to calendar</a>
  // @mutate src/content/sponsorPage.ts | yourDays: "Your requested day(s):", | yourDays: "Your day(s):",
  it("M10: the sponsor thank-you calls the picked day a request, says when it is final, and offers no Add to calendar", () => {
    const src = code("src/components/sponsor/ClaimSection.tsx");
    expect(src).not.toMatch(/text\/calendar|addToCalendar|buildIcs\(/);
    expect(src).toContain("C.thankYou.daysNote");
    expect(sponsorPage.thankYou.yourDays).toMatch(/requested/i);
    expect(sponsorPage.thankYou.daysNote).toMatch(/confirm your final day before December 1/);
    expect("addToCalendar" in sponsorPage.thankYou).toBe(false);
  });

  // @mutate src/components/ResponseDeadlineDialog.tsx | { value: "24", label: "24 hours (recommended)" }, | { value: "24", label: "24 hours" },
  // @mutate src/components/ResponseDeadlineDialog.tsx | <p className="font-sans text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }} data-offer-deadline-line=""> | <p className="font-sans text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }} data-offer-deadline-line="">
  // @mutate src/components/ResponseDeadlineDialog.tsx | .replace(/\s*\(recommended\)$/, ""); | ;
  it("M9: the hire sheet marks 24 hours as recommended and its key rules are 13px, not 11px", () => {
    const src = code("src/components/ResponseDeadlineDialog.tsx");
    expect(src).toContain('{ value: "24", label: "24 hours (recommended)" }');
    // The server default is untouched: 24 is still the preselected value when it fits.
    expect(src).toContain('options.some((o) => o.value === "24") ? "24"');
    const tags = [...src.matchAll(/<p className="([^"]*)"[^>]*data-offer-(deadline-line|no-strike)=""/g)];
    expect(tags.length).toBe(2);
    // The line under the picker never repeats the tag ("within 24 hours (recommended)").
    expect(src).toMatch(/selectedLabel =[\s\S]{0,120}\.replace\(\/\\s\*\\\(recommended\\\)\$\/, ""\)/);
    for (const [, cls] of tags) expect(cls).toContain("text-ds-13");
  });

  // @mutate src/components/firstRun/FirstRun.tsx | {t("firstRun.title")} | What brings you to Helpr?
  // @mutate src/components/firstRun/FirstRun.tsx | {t(`firstRun.${o.id}.title`)} | {o.title}
  it("M1: the first-run picker reads its words through t(), with Spanish for each", () => {
    const src = code("src/components/firstRun/FirstRun.tsx");
    const keys = Object.keys(enNewMember).filter((k) => k.startsWith("firstRun."));
    expect(keys.length).toBeGreaterThan(10);
    for (const k of keys) {
      expect((esNewMember as Record<string, string>)[k], k).toBeTruthy();
      expect((esNewMember as Record<string, string>)[k], k).not.toBe((enNewMember as Record<string, string>)[k]);
    }
    for (const k of ["firstRun.title", "firstRun.lede", "firstRun.note", "firstRun.continue", "firstRun.skip"]) expect(src).toContain(`t("${k}")`);
    expect(src).toContain("t(`firstRun.${o.id}.title`)");
    expect(src).toContain("t(`firstRun.${o.id}.sub`)");
    expect(src).not.toMatch(/>\s*What brings you to Helpr\?\s*</);
    expect(src).not.toMatch(/>\s*Continue\s*</);
  });

  // @mutate src/components/firstRun/FirstRun.tsx | className="shrink-0 w-[18px] h-[18px] rounded-[5px] flex items-center justify-center" | className="shrink-0 w-[18px] h-[18px] rounded-full flex items-center justify-center"
  it("L1: 'Pick any' marks are square checkboxes, not radio circles", () => {
    const src = code("src/components/firstRun/FirstRun.tsx");
    const m = src.match(/data-first-run-check=""\s*className="([^"]*)"/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toContain("rounded-full");
    expect(m![1]).toMatch(/rounded-\[\d+px\]/);
  });

  // @mutate src/pages/admin/preview/previewParts.tsx | if (path === "/posts" && q.get("applicants")) return "the applicants for this job"; | if (path === "/posts" && q.get("applicants")) return h;
  // @mutate src/pages/admin/preview/previewParts.tsx | sayWouldHave(`open ${placeName(a.getAttribute("href"))}`); | sayWouldHave(`open ${a.getAttribute("href")}`);
  it("L3: preview notes name the screen, never a raw address", () => {
    expect(placeName("/posts?highlight=abc&applicants=1")).toBe("the applicants for this job");
    expect(placeName("/jobs?tab=working&job=abc&open=1")).toBe("this job in your working list");
    expect(placeName("/messages?chat=1")).toBe("Messages");
    expect(placeName("/some/unknown?x=1")).toBe("another screen");
    for (const h of ["/posts?highlight=a&applicants=1", "/jobs/abc", "/x/y?z=1", "https://example.com/a"]) expect(placeName(h)).not.toMatch(/[/?=&]/);
    expect(code("src/pages/admin/preview/previewParts.tsx")).toContain('sayWouldHave(`open ${placeName(a.getAttribute("href"))}`)');
  });

  // @mutate src/components/PayoutSetupForm.tsx | primaryLabel={resetting ? "Resetting…" : "Reset and start over"} | primaryLabel={resetting ? "Resetting…" : "Reset & Start Fresh"}
  it("L13: the payout reset sheet is sentence case and says 'setup', not 'onboarding'", () => {
    const src = code("src/components/PayoutSetupForm.tsx");
    expect(src).toContain('"Reset and start over"');
    expect(src).not.toContain("Reset & Start Fresh");
    const desc = src.match(/title="Reset your payout account\?"\s*description="([^"]*)"/);
    expect(desc).not.toBeNull();
    expect(desc![1]).not.toMatch(/onboarding|Stripe/i);
  });

  // @mutate src/components/jobDone/JobDoneSummary.tsx |       <Fragment key="review">{children}</Fragment>\n | 
  // @mutate src/components/reviewPanel/ReviewForm.tsx |           </ReviewQuestionCard>\n          </JobDoneSummary> |           </ReviewQuestionCard>
  it("M4: the review sheet asks for the rating before it offers 'Book again'", () => {
    const summary = code("src/components/jobDone/JobDoneSummary.tsx");
    const slot = summary.indexOf('<Fragment key="review">{children}</Fragment>\n      {side === "poster"');
    const rebook = summary.indexOf('data-testid="book-again"');
    expect(slot).toBeGreaterThan(0);
    expect(rebook).toBeGreaterThan(slot);
    for (const f of ["src/components/reviewPanel/ReviewForm.tsx", "src/components/CompletionPrompts.tsx"]) {
      const s = code(f);
      const open = s.indexOf("<JobDoneSummary");
      const card = s.indexOf("<ReviewQuestionCard", open);
      const close = s.indexOf("</JobDoneSummary>", open);
      expect(open, f).toBeGreaterThan(0);
      expect(card, f).toBeGreaterThan(open);
      expect(close, f).toBeGreaterThan(card);
    }
  });
});
