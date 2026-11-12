/**
 * F260q: Home's to-do adds "· by <day>" only when the status line's detail does not already name its day, and it knows
 * that by CODE (JobStatusLine.detailSaysWhen, set where the line is made), never by reading English day names off the
 * words (the old `/ by (Mon|Tue|...)/` test missed every Spanish line and "answer due Mon"). Inventory: the three poster
 * lines that carry their own day (unnamed offer out "answer due", named offer "has until", named confirm "to confirm
 * by"); a line without one gets no flag.
 *
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   if (!Number.isFinite(at) \|\| at < now \|\| line.detailSaysWhen) return task; |   if (!Number.isFinite(at) \|\| at < now) return task;
 * @mutate src/components/job-card/jobStatusLine.ts |     ...(saysWhen ? { detailSaysWhen: true as const } : {}), |
 * @mutate src/components/job-card/jobStatusLine.ts | (!!offerBy \|\| !!detailBy \|\| | (!!offerBy \|\|
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { posterStatusLine } from "@/components/job-card/jobStatusLine";
import { withTodoBy } from "@/pages/home/homeDashboard/needsYouTodos";
import type { Job } from "@/components/job-card/activityConstants";

// Sat Nov 7 2054, 4:00 PM in Louisiana (CST); the job is Sun Nov 8 at 10:00 AM (confirm window open).
const NOW = new Date("2054-11-07T22:00:00Z");
const job = (over: Record<string, unknown> = {}): Job => ({
  id: "j1", title: "Haul off an old couch", status: "accepted", payment_status: "escrow", helper_id: "h", customer_id: "p",
  date_needed: "2054-11-08", start_time: "10:00", helper_confirmed_at: "2054-10-01T00:00:00Z", poster_confirmed_at: "2054-11-07T20:00:00Z",
  helper_dayof_confirmed_at: null, ...over,
}) as unknown as Job;
const ahead = { source: "confirm_deadline" as const, at: "2054-11-08T14:00:00Z", consequenceText: "", expiredText: "" };

describe("F260q: Home's to-do knows by code when a line already says its day", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => vi.useRealTimers());
  afterEach(() => __resetLangForTests());

  it("a line with no day of its own carries no flag, and the to-do adds the by", () => {
    const plain = posterStatusLine(job(), 0, NOW, undefined, false, null);
    expect(plain.detailSaysWhen).toBeUndefined();
    expect(withTodoBy(plain.detail, { ...plain, deadline: ahead }, NOW.getTime())).toBe("Booked: they accepted · by Sun 8:00 AM");
  });

  it("Spanish: the named confirm line says its day once, never a second '· antes del'", async () => {
    setLang("es");
    await ensureLangLoaded();
    const named = posterStatusLine(job(), 0, NOW, undefined, false, "Yusef Smith");
    expect(named.detailSaysWhen).toBe(true);
    const task = withTodoBy(named.detail, { ...named, deadline: ahead }, NOW.getTime());
    expect(task).toBe(named.detail);
    expect(task.match(/antes del/g)).toHaveLength(1);
  });

  it("an expired listing's line never carries the flag", () => {
    const expired = posterStatusLine(job({ status: "cancelled", helper_id: null, cancellation_reason: "expired" }), 0, NOW, undefined, false, null);
    expect(expired.detailSaysWhen).toBeUndefined();
  });
});
