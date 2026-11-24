/**
 * Area 11b gap re-walk (design audit 11-18, ~/.lh-shots/design-audit-areas/11b-gap-rewalk/FINDINGS.md).
 * One guard per finding fixed here; each @mutate line puts the old state back and must turn its test red.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import { sponsorPage } from "@/content/sponsorPage";
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

  // @mutate src/components/jobDone/JobDoneSummary.tsx | <div className="rounded-ds-lg px-4 py-3" style={{ background: DONE_TINT }} data-job-done-paid=""> | <div className="rounded-ds-lg px-4 py-3" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }} data-job-done-paid="">
  // @mutate src/components/reviewPanel/ReviewForm.tsx |                 <AddPhotoTile\n | <button\n
  it("L7: the Job done paid box is olive, and the review sheet's Add photo is the shared tile", () => {
    const summary = code("src/components/jobDone/JobDoneSummary.tsx");
    const box = summary.match(/<div className="rounded-ds-lg px-4 py-3" style=\{\{ background: ([A-Z_]+|"[^"]*") \}\} data-job-done-paid="">/);
    expect(box).not.toBeNull();
    expect(box![1]).toBe("DONE_TINT");
    expect(summary).toMatch(/const DONE_TINT = "hsl\(var\(--bark\) \/ 0\.08\)"/);
    const form = code("src/components/reviewPanel/ReviewForm.tsx");
    expect(form).toContain("<AddPhotoTile");
    expect(form).not.toMatch(/text-ds-9[^"]*"[^>]*>\s*\{photoFiles\.length === 0 \? "Add photo"/);
  });
});
