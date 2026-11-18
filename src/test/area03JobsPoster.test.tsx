/**
 * Design audit Area 03 (Jobs, poster side, 11-18): H3, Jobs > Posted in Spanish (chips, the All chip, the group headings,
 * "See all N" and the card's buttons were English under Español); H4, the poster's job page buttons and money lines;
 * M12, the applicants list's empty words. English stays word for word.
 *
 * @mutate src/components/job-card/embeddedActivity.tsx |             allLabel={t("jp.all")}\n |
 * @mutate src/components/job-card/embeddedActivity.tsx | tab === "posted" ? postedGroupWords(t) : WORKING_CHIP_LABEL | tab === "posted" ? POSTED_GROUP_LABEL : WORKING_CHIP_LABEL
 * @mutate src/components/job-card/ActivityBucketGroups.tsx | {all ? t("jp.showLess") : t("jp.seeAll", { n: list.length })} | {all ? "Show less" : `See all ${list.length}`}
 * @mutate src/lib/i18n/es.ts |   ...esJobPoster,\n |
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantsStates.tsx | no Helpr has opened it yet. Share the link or boost it to reach more Helprs.` | no Helpr has opened it yet. Getting it in front of people is the first problem to solve.`
 * @mutate src/lib/i18n/enSuggest.ts | “Something else” and post right now. | “Other” and post right now.
 * @mutate src/components/job-card/ActivityEmptyState.tsx |     : isPosted && !hasSearch && POSTED_EMPTY_TITLE[statusFilter] ? POSTED_EMPTY_TITLE[statusFilter]\n | 
 * @mutate src/components/TipDialog.tsx |       <DialogContent keepClose>\n        <DialogHero moment title={first |       <DialogContent>\n        <DialogHero moment title={first
 */
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enJobPoster } from "@/lib/i18n/enJobPoster";
import { esJobPoster } from "@/lib/i18n/esJobPoster";
import { EmbeddedActivityHeader } from "@/components/job-card/embeddedActivity";
import { ActivityBucketGroups, postedGroupWords } from "@/components/job-card/ActivityBucketGroups";
import { t } from "@/lib/i18n/language";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const code = (f: string) => blankComments(readFileSync(join(process.cwd(), f), "utf8"));

async function spanish() {
  await act(async () => {
    setLang("es");
    await ensureLangLoaded();
  });
}

const counts = { all: 9, needs_you: 5, waiting: 2, scheduled: 1, done: 1, cancelled: 0 };

describe("Area 03: Jobs > Posted and the poster's job page in Spanish", () => {
  afterEach(() => __resetLangForTests());

  it("every English word has its Spanish in es.ts, not left English, with the same blanks", () => {
    const keys = Object.keys(enJobPoster) as (keyof typeof enJobPoster)[];
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) {
      expect(es[k], k).toBe(esJobPoster[k]);
      expect(esJobPoster[k], `${k} still English`).not.toBe(enJobPoster[k]);
      expect([...esJobPoster[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...enJobPoster[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
  });

  it("English: the Posted chips read All · Needs you · Waiting · Upcoming · Done · Cancelled", () => {
    render(<EmbeddedActivityHeader header={<div />} tab="posted" statusFilter="all" counts={counts} onFilter={() => {}} search="" onSearch={() => {}} />);
    const chips = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    for (const w of ["All", "Needs you", "Waiting", "Upcoming", "Done", "Cancelled"]) expect(chips.some((c) => c.startsWith(w)), w).toBe(true);
  });

  it("Español: the Posted chips, the All chip and the group headings are Spanish", async () => {
    await spanish();
    render(<EmbeddedActivityHeader header={<div />} tab="posted" statusFilter="all" counts={counts} onFilter={() => {}} search="" onSearch={() => {}} />);
    const chips = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(chips.length).toBeGreaterThan(4);
    for (const w of ["Todos", "Te toca", "En espera", "Próximos", "Hechos"]) expect(chips.some((c) => c.startsWith(w)), w).toBe(true);
    for (const w of ["All", "Needs you", "Waiting", "Upcoming"]) expect(chips.some((c) => c.startsWith(w)), w).toBe(false);
    expect(postedGroupWords(t).needs_you).toBe("Te toca");
  });

  it("Español: a group with more than its preview says Ver los N", async () => {
    await spanish();
    const items = ["a", "b", "c", "d", "e"];
    render(<ActivityBucketGroups items={items} getKey={(x) => x} bucketOf={() => "needs_you"} renderItem={(x) => <p>{x}</p>} labels={postedGroupWords(t) as never} />);
    expect(screen.getByRole("button", { name: "Ver los 5" })).toBeTruthy();
    expect(screen.queryByText(/See all/)).toBeNull();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("Te toca");
  });

  it("M12 plain empty words; M16 names the real tile; L11 the tip sheet has its X", () => {
    const states = code("src/pages/posts/postedJobs/applicantsPanel/ApplicantsStates.tsx");
    expect(states).not.toMatch(/first problem to solve/);
    expect(states).toMatch(/Share the link or boost it to reach more Helprs\./);
    const suggest = code("src/components/SuggestCategory.tsx");
    expect(suggest).not.toMatch(/&ldquo;Other&rdquo;|Pick \\"Other\\"/);
    // The dialog's body reads the dictionary since design audit r2 (sug.body), so the two places are the toast and enSuggest.
    const suggestWords = suggest + code("src/lib/i18n/enSuggest.ts");
    expect(suggestWords).not.toMatch(/“Other”/);
    expect((suggestWords.match(/Something else/g) ?? []).length).toBeGreaterThan(1);
    expect(code("src/components/TipDialog.tsx")).toMatch(/<DialogContent keepClose>\s*<DialogHero moment title=\{first/);
  });

  it("L13 an empty Posted chip names itself (No upcoming jobs), not 'No jobs in this view'", async () => {
    const { ActivityEmptyState } = await import("@/components/job-card/ActivityEmptyState");
    const { MemoryRouter } = await import("react-router-dom");
    render(
      <MemoryRouter>
        <ActivityEmptyState tab="posted" loadError={false} postedJobsCount={3} appliedAppsCount={0} statusFilter="scheduled" hasSearch={false}
          statusCounts={{ needs_you: 3, scheduled: 0 }} searchMatchCounts={{}} statusLabels={[{ key: "needs_you", label: "Needs you" }, { key: "scheduled", label: "Upcoming" }] as never}
          onRetry={() => {}} onNavigate={() => {}} onSelectStatusFilter={() => {}} onClearSearch={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText("No upcoming jobs")).toBeTruthy();
    expect(screen.queryByText("No jobs in this view")).toBeNull();
  });
});
