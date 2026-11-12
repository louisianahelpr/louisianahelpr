/**
 * F260q: the "any time that day" and crew "It's time" lines (anyTimeThatDay.ts TODAY_ANY_TIME_LINE / CREW_TODAY_LINE)
 * read in the member's language on the job card (cl.todayAnyTime / cl.crewToday, by code) and in the tracker
 * (jl.todayAnyTime). The English constants stay the English: each key's English equals its constant word for word.
 *
 * @mutate src/components/job-card/jobStatusLine.ts | ? inLang("cl.todayAnyTime", TODAY_ANY_TIME_LINE) : | ? TODAY_ANY_TIME_LINE :
 * @mutate src/components/job-card/jobStatusLine.ts | ? inLang("cl.crewToday", CREW_TODAY_LINE) : | ? CREW_TODAY_LINE :
 * @mutate src/components/tracker/jobProgressState.ts | (started ? t("jl.todayAnyTime") : t("jl.tapLeave")) | (started ? "Today, any time — tap I'm on my way when you leave" : t("jl.tapLeave"))
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { jobProgress, type ProgressJob } from "@/components/tracker/jobProgressState";
import { helperStatusLine } from "@/components/job-card/jobStatusLine";
import { CREW_TODAY_LINE, TODAY_ANY_TIME_LINE } from "@/lib/anyTimeThatDay";
import { enCardLines } from "@/lib/i18n/enCardLines";
import { esCardLines } from "@/lib/i18n/esCardLines";
import { enJobLines } from "@/lib/i18n/enJobLines";
import { esJobLines } from "@/lib/i18n/esJobLines";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";

const DAY = "2026-11-10";
const AT_3AM = new Date("2026-11-10T09:00:00Z");
const T = "2026-11-09T18:00:00Z";
const confirmed = {
  id: "j1", status: "in_progress", customer_id: "p", helper_id: "h", helper_confirmed_at: T, helper_dayof_confirmed_at: T, poster_confirmed_at: T,
  payment_status: "escrow", date_needed: DAY, start_time: null, is_group_job: false,
} as unknown as Job;
const crew = { ...confirmed, is_group_job: true, helper_id: null, status: "accepted", start_time: "02:00" } as unknown as Job;
const app = (job: Job) => ({ id: "a", job, job_id: "j1", helper_id: "h", status: "accepted", closed_reason: null, posterName: "Lexi" }) as unknown as AppliedApp;

describe("F260q: the any-time and crew lines follow the member's language", () => {
  afterEach(() => { vi.useRealTimers(); __resetLangForTests(); });

  it("each key's English is its constant, and each has its Spanish", () => {
    expect(enCardLines["cl.todayAnyTime"]).toBe(TODAY_ANY_TIME_LINE);
    expect(enJobLines["jl.todayAnyTime"]).toBe(TODAY_ANY_TIME_LINE);
    expect(enCardLines["cl.crewToday"]).toBe(CREW_TODAY_LINE);
    expect(esCardLines["cl.todayAnyTime"]).toBe(esJobLines["jl.todayAnyTime"]);
    expect(esCardLines["cl.crewToday"]).not.toBe(CREW_TODAY_LINE);
  });

  it("English: the constants", () => {
    vi.useFakeTimers(); vi.setSystemTime(AT_3AM);
    expect(helperStatusLine(app(confirmed)).detail).toBe(TODAY_ANY_TIME_LINE);
    expect(helperStatusLine(app(crew)).detail).toBe(CREW_TODAY_LINE);
  });

  it("Spanish: the card's line, the crew line and the tracker's line", async () => {
    setLang("es");
    await ensureLangLoaded();
    vi.useFakeTimers(); vi.setSystemTime(AT_3AM);
    expect(helperStatusLine(app(confirmed)).detail).toBe(esCardLines["cl.todayAnyTime"]);
    expect(helperStatusLine(app(crew)).detail).toBe(esCardLines["cl.crewToday"]);
    const helpr = jobProgress(confirmed as unknown as ProgressJob, { viewer: "helpr", otherFirst: "Lexi", threadHelprId: "h", now: AT_3AM }).next;
    expect(helpr).toBe(esJobLines["jl.todayAnyTime"]);
  });
});
