/**
 * Design audit round 3 (11-18), the Mediums and Lows fixed on design/audit-r3-fixes-1118. Findings and shots:
 * ~/.lh-shots/design-audit-r3/FINDINGS.md. Each sentence fails if its fix is undone.
 *
 * @mutate src/components/profile/earningsTab/EarningsSummaryCard.tsx |       <h2 className="sr-only">Earned</h2> |       <h2 className="font-display font-bold text-ds-17">Earned</h2>
 * @mutate src/components/profile/earningsTab/EarningsSummaryCard.tsx |             <div className="flex items-center gap-1.5 mb-1">\n              <span className="sr-only">Tips</span> |             <div className="flex items-center gap-1.5 mb-1">\n              <Gift className="w-3 h-3 text-primary" />\n              <span className="sr-only">Tips</span>
 * @mutate src/pages/profile/giftCards/WhatIsThis.tsx |     <p className="font-sans text-ds-14 leading-relaxed text-muted-foreground" data-gift-intro=""> |     <p className="rounded-[20px] bg-muted p-5" data-gift-intro="">
 * @mutate src/pages/posts/EditJobDialog.tsx |         <DialogHero title="Edit job" /> |         <DialogHero title={title ? `"${title}"` : "Edit job"} />
 * @mutate src/pages/posts/EditJobDialog.tsx |       <DialogContent keepClose> |       <DialogContent>
 * @mutate src/pages/posts/EditJobDialog.tsx | Leave the start time blank | Leave Start Time blank
 * @mutate src/pages/jobs/jobPage/NoApplicantsYet.tsx |       <h2 id="no-applicants-title" className="text-ds-17 font-semibold text-foreground">{t("jobPage.noApplicants")}</h2> |       <h2 id="no-applicants-title" className="font-display font-moment text-ds-28 font-semibold">{t("jobPage.noApplicants")}</h2>
 * @mutate src/pages/jobs/jobPage/NoApplicantsYet.tsx |       <h3 className="sr-only">{t("jobPage.repliesSooner")}</h3> |       <h3 className="pt-2 text-left text-ds-12 font-semibold uppercase tracking-wide text-muted-foreground">Want replies sooner?</h3>
 * @mutate src/components/profile/DeleteAccountDialog.tsx |     <div className="my-1 grid gap-3" data-delete-lists=""> |     <div className="my-1 grid gap-3 sm:grid-cols-2" data-delete-lists="">
 * @mutate src/components/profile/DeleteAccountDialog.tsx | className="font-semibold text-primary underline underline-offset-2">{t("deleteAccount.breakLink")} | className="font-semibold underline underline-offset-2">{t("deleteAccount.breakLink")}
 * @mutate src/pages/info/legal/LegalChrome.tsx |       <span className="text-ds-15 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }} data-tldr-heading=""> |       <span className="text-ds-13 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }} data-tldr-heading="">
 * @mutate src/components/ReportDialog.tsx | const REPORT_FOOTER_PINNED = "sticky bottom-0 -mx-4 -mb-4 px-4 pb-4 pt-3 bg-background border-t border-border"; | const REPORT_FOOTER_PINNED = "sticky bottom-0 -mx-4 -mb-4 px-4 pb-4 pt-3 bg-card";
 * @mutate src/components/ui/RadioCardList.tsx |             {o.media}\n |
 * @mutate src/components/declutter/DeclutterOfferTrade.tsx | media: <ListingThumb small path={cover.get(c.id)} category={c.category} /> | media: null
 * @mutate src/components/declutter/DeclutterOfferTrade.tsx | <SheetFooter className="sticky bottom-0 -mx-4 -mb-4 grid grid-cols-2 | <SheetFooter className="mt-4 -mx-4 -mb-4
 * @mutate supabase/functions/_shared/email-templates/components.tsx | arcsize="50%" | arcsize="26%"
 * @mutate supabase/functions/_shared/email-templates/components.tsx |         borderRadius: '999px', |         borderRadius: '12px',
 * @mutate supabase/functions/_shared/email-templates/styles.ts | export const linkStyle = {\n  color: brand.bark, | export const linkStyle = {\n  color: brand.burntSienna,
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | town ? <FactRow label={t("jobPage.whereRow")} data-job-town=""> | town ? <FactRow label="Where" data-job-town="">
 * @mutate src/pages/jobs/jobPage/NoApplicantsYet.tsx |         {t("jobPage.tellYou")} |         We'll tell you when someone applies.
 * @mutate src/lib/i18n/es.ts |   "jobPage.noApplicants": "Aún no hay solicitudes",\n |
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const code = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));

describe("design audit round 3 fixes", () => {
  it("#29/#30 Money: no second 'Earned' heading on screen and no lone gift icon over the tips", () => {
    const card = code("src/components/profile/earningsTab/EarningsSummaryCard.tsx");
    expect(card).toMatch(/<h2 className="sr-only">Earned<\/h2>/);
    expect(card).not.toMatch(/<Gift\b/);
    expect(card).not.toMatch(/<TrendingUp\b/);
  });

  it("#34 Gift card: a one-line muted intro, not a grey box", () => {
    const intro = code("src/pages/profile/giftCards/WhatIsThis.tsx");
    expect(intro).toMatch(/<p className="font-sans text-ds-14 leading-relaxed text-muted-foreground" data-gift-intro="">/);
    expect(intro).not.toMatch(/bg-muted p-5/);
  });

  it("#19/#5/#20 Edit job: titled 'Edit job' with its X, sentence-case labels, plain copy", () => {
    const edit = code("src/pages/posts/EditJobDialog.tsx");
    expect(edit).toMatch(/<DialogContent keepClose>\s*<DialogHero title="Edit job" \/>/);
    expect(edit).toMatch(/data-edit-job-name="">\{job\.title\}/);
    expect(edit).not.toMatch(/uppercase tracking-\[0\.06em\]/);
    expect((edit.match(/<Label [^>]*text-ds-14 font-sans font-semibold text-foreground/g) ?? []).length).toBeGreaterThan(8);
    expect(edit).toContain("Leave the start time blank");
  });

  it("#18 No applicants yet: one card with a 17 px title, no uppercase eyebrow", () => {
    const na = code("src/pages/jobs/jobPage/NoApplicantsYet.tsx");
    expect(na).toMatch(/data-no-applicants="" [^>]*rounded-2xl border border-border bg-card p-4 text-left/);
    expect(na).toMatch(/className="text-ds-17 font-semibold text-foreground">\{t\("jobPage\.noApplicants"\)\}/);
    expect(na).not.toMatch(/uppercase/);
    expect(na).not.toMatch(/font-moment/);
  });

  it("#37/#7 Delete account: one-column 14 px lists, olive inline link", () => {
    const del = code("src/components/profile/DeleteAccountDialog.tsx");
    expect(del).toMatch(/<div className="my-1 grid gap-3" data-delete-lists="">/);
    expect((del.match(/text-ds-14 leading-snug/g) ?? []).length).toBe(2);
    expect(del).not.toMatch(/gap-1\.5 text-ds-11 leading-snug/);
    expect(del).toMatch(/font-semibold text-primary underline underline-offset-2">\{t\("deleteAccount\.breakLink"\)\}/);
  });

  it("#48 Legal: the short-version heading is the section-title size, titles semibold", () => {
    expect(code("src/pages/info/legal/LegalChrome.tsx")).toMatch(/className="text-ds-15 font-sans font-semibold"[^>]*data-tldr-heading=""/);
    expect(code("src/components/policy/CollapsedPolicy.tsx")).toMatch(/block font-sans font-semibold text-foreground leading-tight text-ds-15">\s*\{isSearching \? highlight\(title, query\) : title\}/);
  });

  it("#3 Report: the pinned footer is the dialog's own colour with a top hairline", () => {
    expect(code("src/components/ReportDialog.tsx")).toMatch(/REPORT_FOOTER_PINNED = "[^"]*\bbg-background border-t border-border"/);
  });

  it("#10/#2 Offer a trade: each row shows its listing's photo; Cancel + Send sit side by side, pinned", () => {
    expect(code("src/components/ui/RadioCardList.tsx")).toMatch(/\{o\.media\}\s*<span className="flex-1 min-w-0/);
    const trade = code("src/components/declutter/DeclutterOfferTrade.tsx");
    expect(trade).toMatch(/media: <ListingThumb small path=\{cover\.get\(c\.id\)\}/);
    expect(trade).toMatch(/<SheetFooter className="sticky bottom-0 [^"]*\bgrid grid-cols-2\b[^"]*"/);
    expect(code("src/components/declutter/ListingThumb.tsx")).toMatch(/small \? "h-11 w-11 rounded-lg"/);
  });

  it("#50 emails: the CTA is a full pill (VML too) and inline links are olive", () => {
    const comp = code("supabase/functions/_shared/email-templates/components.tsx");
    expect(comp).toContain('arcsize="50%"');
    const cta = comp.slice(comp.indexOf('className="e-cta"'));
    expect(cta).toMatch(/borderRadius: '999px',/);
    const styles = code("supabase/functions/_shared/email-templates/styles.ts");
    expect(styles).toMatch(/export const linkStyle = \{\s*color: brand\.bark,/);
    expect(styles).toMatch(/const button = \{[^}]*borderRadius: '999px'/);
  });

  it("#9 job page in Spanish: the fact rows, the no-applicants card and Edit / Cancel read the dictionary", async () => {
    const { enJobs } = await import("@/lib/i18n/enJobs");
    const { es } = await import("@/lib/i18n/es");
    const keys = ["jobPage.whenRow", "jobPage.whereRow", "jobPage.noApplicants", "jobPage.tellYou", "jobPage.addPhoto", "jobPage.editJob", "jobPage.cancelJob"] as const;
    for (const k of keys) {
      expect(enJobs[k], k).toBeTruthy();
      expect((es as Record<string, string>)[k], k).toBeTruthy();
      expect((es as Record<string, string>)[k]).not.toBe(enJobs[k]);
    }
    const na = code("src/pages/jobs/jobPage/NoApplicantsYet.tsx");
    for (const w of ["No applicants yet", "We'll tell you", "Add a photo", "Change the price", "It's out to Helprs"]) expect(na, w).not.toContain(w);
    const page = code("src/pages/jobs/jobPage/JobPage.tsx");
    expect(page).not.toMatch(/label="(When|Where)"/);
    const actions = code("src/pages/jobs/jobPage/posterPageActions.tsx");
    expect(actions).not.toMatch(/label: "(Edit job|Cancel job)"/);
  });
});
