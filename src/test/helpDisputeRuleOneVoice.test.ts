/**
 * Owner UI audit 2026-11-09, Help center:
 *  F036 (HIGH) the dispute answer said "Once a job is marked done, it's final" while the next answers give the
 *       poster APPROVAL_WINDOW_HOURS after it is marked done to approve or ask for a change. A job is final only
 *       when the poster approves it (status `completed` is set on release; open_dispute_as refuses it). Every
 *       Help answer that states finality says it in the one DONE_IS_FINAL sentence.
 *  F037 the answer sent people to "My Jobs" / "My Posts"; the Jobs tabs are JOBS_TABS (Posted, Working).
 *  F038 "When do I get paid?" named the approval twice in one run-on sentence and added "Every payout goes on the
 *       standard schedule.": the answer says the approval once, in short sentences.
 *  F039 an answer said "enforced by the database": no back-end words in member Help copy.
 *
 * Inventory: every FAQ answer (FAQ_SECTIONS) and the JOBS_TABS labels read from JobsSection.tsx.
 *
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts | ${DONE_IS_FINAL} | Once a job is marked done, it's final and can't be disputed.
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts | Jobs > Working for a job | My Jobs for a job
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts | or on Declutter.` | or on Declutter. Every payout goes on the standard schedule.`
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts | Only Helprs who meet your choice can apply. | Only Helprs who meet what you set can apply — it's enforced by the database.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DONE_IS_FINAL, FAQ_SECTIONS } from "@/pages/info/helpCenter/helpCenterContent";

const ROOT = resolve(__dirname, "../..");
const answers = FAQ_SECTIONS.flatMap((s) => s.items.map((i) => ({ q: i.q, a: i.a })));
const jobsSection = readFileSync(resolve(ROOT, "src/pages/jobs/JobsSection.tsx"), "utf8");
const tabsBlock = jobsSection.match(/export const JOBS_TABS = \[([\s\S]*?)\] as const/)?.[1] ?? "";
const TAB_LABELS = [...tabsBlock.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);

describe("Help states one dispute/finality rule (F036)", () => {
  it("reads a real inventory", () => {
    expect(answers.length).toBeGreaterThan(20);
    expect(TAB_LABELS.length).toBeGreaterThan(1);
  });

  it("the rule names the approval, not the Helpr marking it done", () => {
    expect(DONE_IS_FINAL).toMatch(/approves it/);
    expect(DONE_IS_FINAL).not.toMatch(/marked done/);
  });

  it("every answer that says a job is final says it with DONE_IS_FINAL, and the dispute answer says it", () => {
    const finality = answers.filter((x) => /\bit's final\b|\bis final\b|can't be disputed/i.test(x.a) && !/sale is final/i.test(x.a));
    expect(finality.length).toBeGreaterThan(0);
    for (const x of finality) expect(x.a, x.q).toContain(DONE_IS_FINAL);
    const dispute = answers.find((x) => x.q === "What if there's a dispute?");
    expect(dispute?.a).toContain(DONE_IS_FINAL);
  });

  it("no answer calls a job final once it is only marked done", () => {
    const bad = answers.filter((x) => /marked done[^.]*\bfinal\b/i.test(x.a));
    expect(bad.map((x) => x.q)).toEqual([]);
  });
});

describe("Help names the real Jobs tabs (F037)", () => {
  it("no old list names", () => {
    expect(answers.filter((x) => /\bMy (Jobs|Posts)\b/.test(x.a)).map((x) => x.q)).toEqual([]);
  });

  it("every Jobs > <tab> is a JOBS_TABS label", () => {
    const named = answers.flatMap((x) => [...x.a.matchAll(/\bJobs > (\w+)/g)].map((m) => m[1]));
    expect(named.length).toBeGreaterThan(1);
    for (const n of named) expect(TAB_LABELS).toContain(n);
  });
});

describe("When do I get paid? says it once (F038)", () => {
  it("one mention of the approval, no 'standard schedule' filler, short sentences", () => {
    const a = answers.find((x) => x.q === "When do I get paid?")?.a ?? "";
    expect(a).not.toBe("");
    expect(a.match(/approve/gi)?.length).toBe(1);
    expect(a).not.toMatch(/standard schedule/i);
    for (const sentence of a.split(/(?<=\.)\s+/)) expect(sentence.length, sentence).toBeLessThan(140);
  });
});

describe("Help has no back-end words (F039)", () => {
  it("no database / server / RPC talk in an answer", () => {
    const bad = answers.filter((x) => /\bdatabase\b|\bRPC\b|\bserver[- ]side\b|\benforced by\b/i.test(x.a));
    expect(bad.map((x) => x.q)).toEqual([]);
  });
});
