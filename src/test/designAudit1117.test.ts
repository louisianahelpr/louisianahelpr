/**
 * Design audit 11-17 (~/.lh-shots/design-audit-1117/FINDINGS.md): small layout fixes, read from source (comments
 * blanked). One block per finding; the render-level checks live beside their components.
 *
 * @mutate src/pages/info/HelpCenter.tsx | <span className="block font-sans text-ds-13 text-muted-foreground" data-help-topic-count=""> | <span className="font-sans text-ds-13 text-muted-foreground" data-help-topic-count="">{"· "}
 * @mutate src/components/Footer.tsx | <div className="page-measure max-w-6xl pt-6 md:pt-8 pb-2"> | <div className="page-measure pt-6 md:pt-8 pb-2">
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | const FIELD_LABEL = "block text-ds-13 font-semibold text-foreground/80"; | const FIELD_LABEL = "block text-ds-15 font-semibold";
 * @mutate src/components/messages/DeclutterOrderTalkInbox.tsx | <span className="ml-auto shrink-0 text-ds-11 | {!row.open && <span data-order-talk-ended="">x</span>}<span className="ml-auto shrink-0 text-ds-11
 * @mutate src/components/dashboard/jobDetailDialog/JobDetailTitleRow.tsx | <div className="font-sans text-ds-15 leading-relaxed text-foreground" data-job-description=""> | <div className="font-sans text-ds-12 leading-relaxed" data-job-description="">
 * @mutate src/components/dashboard/jobDetailDialog/JobStatTiles.tsx | <div key="stat-tiles" className="flex flex-col gap-1" data-job-deadline-line=""> | <div key="stat-tiles" className="grid grid-cols-2 auto-rows-fr gap-2" data-job-deadline-line="">
 * @mutate src/components/job-card/MineJobFace.tsx | <div className="order-1 min-w-0 md:order-none md:flex-1" data-mine-face-col=""> | <div className="order-1 min-w-0 md:order-none md:flex-1">
 * @mutate src/components/ui/Notice.tsx | "border-[hsl(var(--burnt-sienna)/0.3)] bg-[hsl(var(--burnt-sienna)/0.06)] text-foreground" | "border-amber-300 bg-amber-50 text-amber-950"
 * @mutate src/components/declutter/SellerPayoutPrompt.tsx | <Notice tone="warn" icon={AlertTriangle} title={t("dpo.promptTitle" | <Notice tone="warn" title={t("dpo.promptTitle"
 * @mutate src/components/declutter/DeclutterHomeView.tsx | <StrikeCount userId={user.id} full={view === "selling"} /> | <StrikeCount userId={user.id} />
 * @mutate src/pages/jobs/JobsSection.tsx | const fab = desktop \|\| tab === "working" ? null | const fab = desktop ? null
 * @mutate src/components/declutter/SellOneScreen.tsx | <div className="w-full max-w-xl space-y-6" data-sell-one-screen=""> | <div className="mx-auto w-full max-w-xl space-y-6" data-sell-one-screen="">
 * @mutate src/components/declutter/SellMeetupSpots.tsx | <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setDraft({ name: "" | <Button type="button" variant="outline" className="rounded-full" onClick={() => setDraft({ name: ""
 * @mutate src/components/profile/ProfileEditForm.tsx | <p data-skill-group-head="" className="text-ds-13 font-medium text-muted-foreground"> | <p data-skill-group-head="" className="text-ds-11 font-semibold uppercase tracking-[0.08em] text-muted-foreground">
 * @mutate src/pages/home/HomeDashboard.tsx | <h2 className="text-ds-13 font-bold uppercase tracking-[0.06em] text-muted-foreground">{t("home.yourSections")}</h2> | <h2 className="text-ds-15 font-semibold text-foreground">{t("home.yourSections")}</h2>
 * @mutate src/components/messages/chatView/SystemEventRow.tsx | {at ? label.replace(/\.$/, "") : label} | {label}
 * @mutate src/components/declutter/DeclutterItemRows.tsx | noPhotoTags | aboveFold={false}
 * @mutate src/components/dashboard/jobDetailDialog/JobDetailBadgeRow.tsx | className={`w-3.5 h-3.5 shrink-0 ${railIsCrowded ? "max-[399px]:hidden" : ""}`} | className="w-3.5 h-3.5 shrink-0"
 * @mutate src/pages/helprs/FindHelprs.tsx | <Button type="submit" variant="outline" size="md"> | <Button type="submit" variant="outline">
 * @mutate src/components/landing/LiveJobsSection.tsx | line-clamp-2 break-words lg:min-h-[2lh]" | line-clamp-2 break-words"
 * @mutate src/components/auth/PasswordRuleList.tsx | className={`inline-flex items-center gap-1 text-ds-13 | className={`inline-flex items-center gap-1 text-ds-11
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const src = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

describe("design audit 11-17", () => {
  it("#14: the Help topic's question count is its own line, with no leading dot", () => {
    const s = src("src/pages/info/HelpCenter.tsx");
    const at = s.indexOf('data-help-topic-count=""');
    expect(at).toBeGreaterThan(0);
    const tag = s.slice(s.lastIndexOf("<span", at), s.indexOf("</span>", at));
    expect(tag).toMatch(/className="block /);
    expect(tag).not.toContain("·");
  });

  it("#16: the footer's column is the 72rem content column on every page", () => {
    const s = src("src/components/Footer.tsx");
    expect(s).toContain('<div className="page-measure max-w-6xl pt-6 md:pt-8 pb-2">');
    expect(s).not.toMatch(/landing \? " max-w-6xl"/);
  });

  it("#10: the Wanted sheet's labels are the shared 13 px semibold, the photo label included", () => {
    const w = src("src/components/declutter/DeclutterWantedViews.tsx");
    expect(w).toContain('const FIELD_LABEL = "block text-ds-13 font-semibold text-foreground/80";');
    // Area 06b M3: the first ("I'm looking for") is screen-reader only, so three painted labels share the size.
    expect((w.match(/className=\{FIELD_LABEL\}/g) ?? []).length).toBeGreaterThan(2);
    expect(w).not.toMatch(/text-ds-15 font-semibold" htmlFor=/);
    expect(src("src/components/declutter/DeclutterProblemPhotos.tsx")).toContain('<p className="text-ds-13 font-semibold text-foreground/80" data-photos-label={fieldLabel ? "field" : undefined}>{t("dsl.photos.label"');
  });

  it("#6: a Declutter thread's Ended pill sits on the second line, never the title line", () => {
    const s = src("src/components/messages/DeclutterOrderTalkInbox.tsx");
    const title = s.indexOf("title={orderTalkRowTitle(row)}");
    const line = s.indexOf('data-order-talk-line=""');
    const ended = s.indexOf('data-order-talk-ended=""');
    expect(title).toBeGreaterThan(0);
    expect(ended).toBeGreaterThan(line);
    expect(s.indexOf("data-order-talk-ended")).toBe(ended);
  });

  it("#11: the job sheet's description is 15 px, the row's values 14 px from sm, and Closes is one meta line", () => {
    const row = src("src/components/dashboard/jobDetailDialog/JobDetailTitleRow.tsx");
    expect(row).toContain('<div className="font-sans text-ds-15 leading-relaxed text-foreground" data-job-description="">');
    const tiles = src("src/components/dashboard/jobDetailDialog/JobStatTiles.tsx");
    expect(tiles).toContain("text-ds-12 sm:text-ds-14");
    expect(tiles).toContain('<div key="stat-tiles" className="flex flex-col gap-1" data-job-deadline-line="">');
    expect(tiles).not.toMatch(/col-span-2/);
  });

  it("#12: from 768px the Working card's thumb no longer sets the title row's height", () => {
    expect(src("src/components/job-card/MineJobFace.tsx")).toContain('data-mine-face-col=""');
    const css = readFileSync(resolve(ROOT, "src/index.css"), "utf8");
    const block = css.slice(css.indexOf("DESIGN AUDIT 11-17 #12"));
    expect(block).toMatch(/\[data-mine-face-col\] \[data-mine-face-thumb\] \{ position: absolute; left: 0; top: 0; \}/);
    expect(block).toMatch(/\[data-mine-face-col\] \[data-mine-face-open\] \{ padding-left: 3\.5rem; \}/);
    expect(block).toMatch(/\[data-mine-face-col\] \{ position: relative; min-height: 2\.75rem; \}/);
  });

  it("#2/#3: the shared warning Notice is terracotta, never amber", () => {
    const n = src("src/components/ui/Notice.tsx");
    expect(n).toContain('"border-[hsl(var(--burnt-sienna)/0.3)] bg-[hsl(var(--burnt-sienna)/0.06)] text-foreground"');
    expect(n).not.toMatch(/amber-/);
  });

  it("#2: the full strikes card is on Selling only (one line elsewhere)", () => {
    const h = src("src/components/declutter/DeclutterHomeView.tsx");
    expect(h).toContain('<StrikeCount userId={user.id} full={view === "selling"} />');
    expect(h).toContain("top={<StrikeCount userId={user.id} full={false} />}");
    expect((h.match(/<StrikeCount /g) ?? []).length).toBe(2);
  });

  it("#3: the Declutter payout prompt wears the payout row's icon and trailing action", () => {
    const p = src("src/components/declutter/SellerPayoutPrompt.tsx");
    expect(p).toMatch(/<Notice tone="warn" icon=\{AlertTriangle\} title=\{t\("dpo\.promptTitle"/);
    expect(p).toContain('data-payout-prompt-action=""');
    expect(p).not.toMatch(/className="underline font-semibold">(?:Set up payouts|\{t\("dpo\.setUp"\)\})/);
  });

  it("#5: the Working tab draws no Post a job pill", () => {
    expect(src("src/pages/jobs/JobsSection.tsx")).toContain('const fab = desktop || tab === "working" ? null : <SectionCreateFab section="jobs"');
  });

  it("#7: the Sell column lines up with its left-aligned title (no mx-auto)", () => {
    for (const f of ["src/components/declutter/SellOneScreen.tsx", "src/components/declutter/DeclutterSellView.tsx", "src/components/declutter/DeclutterSellChooser.tsx"]) {
      const s = src(f);
      expect(s, f).toMatch(/<div className="w-full max-w-xl space-y-\d/);
      expect(s, f).not.toContain("mx-auto w-full max-w-xl");
    }
  });

  it("#8: Declutter settings' Pickup places and Meet spots share one card header and the default outline size", () => {
    const pp = src("src/components/declutter/SellPorchPlaces.tsx");
    const ms = src("src/components/declutter/SellMeetupSpots.tsx");
    expect(pp).toContain('<h2 className="text-base font-semibold text-foreground" data-porch-places-title="">');
    expect(ms).toMatch(/<h2 id="meet-spots-title" className="text-base font-semibold text-foreground">/);
    expect(pp).toMatch(/<Button type="button" variant="outline" size="sm" className="rounded-full" disabled=\{usualRead\.isLoading\}/);
    expect(ms).toMatch(/<Button type="button" variant="outline" size="sm" className="rounded-full" onClick=\{\(\) => setDraft\(\{ name: ""/);
    expect(pp).toContain('<section className="rounded-[20px] border border-border bg-card p-4" aria-label={t("lp.pp.title")} data-porch-places-card="">');
  });

  it("#9: Edit profile keeps eyebrows for card headers only; the skill groups are sentence-case sub-labels", () => {
    const f = src("src/components/profile/ProfileEditForm.tsx");
    const at = f.indexOf('data-skill-group-head=""');
    expect(at).toBeGreaterThan(0);
    expect(f.slice(at, f.indexOf(">", at))).not.toMatch(/uppercase/);
    expect(src("src/components/profile/profileEditForm/TrustMarksCard.tsx")).not.toMatch(/state: "Done"/);
  });

  it("#27: Home's Your sections heading is the same eyebrow as GroupSection's", () => {
    const eyebrow = /<h2 className="(text-ds-13 font-bold uppercase tracking-\[0\.06em\] text-muted-foreground)">/.exec(src("src/components/sections/StatusBoxes.tsx"))?.[1];
    expect(eyebrow).toBeTruthy();
    expect(src("src/pages/home/HomeDashboard.tsx")).toContain(`<h2 className="${eyebrow}">{t("home.yourSections")}</h2>`);
  });

  it("#29: the machine-made lines are plain sentences", () => {
    expect(src("src/components/messages/chatView/SystemEventRow.tsx")).toContain('{at ? label.replace(/\\.$/, "") : label}');
    const avail = src("src/components/profile/AvailabilityTab.tsx");
    expect(avail).not.toMatch(/· signal/);
    expect(avail).toContain("Turn on for ${FALLBACK_HOURS} more hours.");
    expect(src("src/components/job-card/jobStatusLine.ts")).not.toMatch(/No-Show\?"/);
  });

  it("#30: sign-up rules are 13px with a check on each; Log in and the policy links have a 44px hit area", () => {
    const rules = src("src/components/auth/PasswordRuleList.tsx");
    expect(rules).toContain("inline-flex items-center gap-1 text-ds-13");
    expect(rules).not.toMatch(/rounded-full border border-current/);
    const step1 = src("src/pages/auth/signup/SignupStep1.tsx");
    expect((step1.match(/className="tap-44 font-semibold underline text-primary"/g) ?? []).length).toBe(3);
    expect(step1).toContain('<Link to="/login" className="tap-44 font-semibold');
  });

  it("#31: Find a Helpr's Search button is the input's 48px; New is a chip, not an empty star", () => {
    const f = src("src/pages/helprs/FindHelprs.tsx");
    expect(f).toContain('<Button type="submit" variant="outline" size="md">');
    expect(f).toContain('data-helpr-new=""');
  });

  it("#32: the landing's open-job titles keep two lines' room from lg, so the prices line up", () => {
    const l = src("src/components/landing/LiveJobsSection.tsx");
    expect(l).toContain("line-clamp-2 break-words lg:min-h-[2lh]");
    expect(l).toContain("lg:justify-start");
  });

  it("#34: on a crowded phone rail the category glyph steps aside with its word", () => {
    expect(src("src/components/dashboard/jobDetailDialog/JobDetailBadgeRow.tsx")).toContain('${railIsCrowded ? "max-[399px]:hidden" : ""}');
  });

  it("#35: the item page's carousel cards wear no photo tags", () => {
    expect(src("src/components/declutter/DeclutterItemRows.tsx")).toMatch(/<ItemCard[\s\S]*?noPhotoTags[\s\S]*?\/>/);
    expect(src("src/components/declutter/DeclutterItemCard.tsx")).toContain("{!noPhotoTags && photoTag && ("); // 11-20 #11: the one photo tag (photoTagOf)
  });
});
