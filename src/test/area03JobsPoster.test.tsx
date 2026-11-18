/**
 * Design audit Area 03 (Jobs, poster side, 11-18): H3, Jobs > Posted in Spanish (chips, the All chip, the group headings,
 * "See all N" and the card's buttons were English under Español); H4, the poster's job page buttons and money lines;
 * M12, the applicants list's empty words. English stays word for word.
 *
 * @mutate src/components/job-card/embeddedActivity.tsx |             allLabel={t("jp.all")}\n |
 * @mutate src/components/job-card/embeddedActivity.tsx | tab === "posted" ? postedGroupWords(t) : WORKING_CHIP_LABEL | tab === "posted" ? POSTED_GROUP_LABEL : WORKING_CHIP_LABEL
 * @mutate src/components/job-card/ActivityBucketGroups.tsx | {all ? t("jp.showLess") : t("jp.seeAll", { n: list.length })} | {all ? "Show less" : `See all ${list.length}`}
 * @mutate src/lib/i18n/es.ts |   ...esJobPoster,\n |
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
});
