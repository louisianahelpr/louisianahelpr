/**
 * F284 (owner 11-11 ~2:10 PM): a poster may report a Helpr no-show only from 30 minutes after the start time.
 *
 * Server: report_helper_no_show's GUARD 2 (20261111202421) refuses a timed job until start + 30 minutes and names
 * that time in its hint; a job with no start time keeps its day's end. PGlite proof:
 * src/test/pglite/noShowOpensAfter30Minutes.pglite.mjs (12 PASS; 6 FAIL with NEW_MIGRATION=skip).
 * Client: the sheet (NoShowDialog) says "You can report a no-show from 9:30 AM." and keeps Confirm off until then,
 * from the same instant (src/lib/noShowOpens.ts).
 *
 * @mutate supabase/migrations/20261111213317_no_show_reported_at_marker.sql | ELSE interval '30 minutes' END; | ELSE interval '0 minutes' END;
 * @mutate src/lib/noShowOpens.ts | export const NO_SHOW_WAIT_MINUTES = 30; | export const NO_SHOW_WAIT_MINUTES = 0;
 * @mutate src/components/job-card/NoShowDialog.tsx | disabled={reporting \|\| !open} | disabled={reporting}
 * @mutate src/components/job-card/NoShowDialog.tsx | {waitLine && <p data-testid="no-show-opens-line"> | {false && <p data-testid="no-show-opens-line">
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { NO_SHOW_WAIT_MINUTES, noShowOpensAt, noShowOpensLine, noShowReportOpen } from "@/lib/noShowOpens";
// F272: the sheet asks the server for the refund; not under test here.
vi.mock("@/lib/posterCancelQuote", () => ({ fetchPosterCancelQuote: async () => null }));
import { NoShowDialog } from "@/components/job-card/NoShowDialog";

const ROOT = resolve(__dirname, "../..");
const defs = effectiveDefs(join(ROOT, "supabase", "migrations"));
const body = (fn: string) => blankSqlComments(defs.get(fn)?.stmt ?? "").replace(/\s+/g, " ");

// 2037-11-12 is a Thursday; Louisiana is CST (UTC-6). Far-future on purpose: a present-era job day ages (jobDayFixtureTimezone).
const central = (h: number, m = 0, s = 0, day = 12) => new Date(Date.UTC(2037, 10, day, h + 6, m, s));

describe("F284: a no-show report opens 30 minutes after the start", () => {
  it("the server's newest report_helper_no_show refuses a timed job until start + 30 minutes", () => {
    expect(defs.size).toBeGreaterThan(100);
    expect(defs.get("report_helper_no_show")?.file).toBe("20261111213317_no_show_reported_at_marker.sql");
    const b = body("report_helper_no_show");
    expect(b).toContain("v_opens_at := v_starts_at + CASE WHEN v_start_time IS NULL THEN interval '0 minutes' ELSE interval '30 minutes' END;");
    expect(b).toContain("IF v_starts_at IS NULL OR now() < v_opens_at THEN RAISE EXCEPTION 'job_not_started'");
    expect(b).toContain("'You can report a no-show from '");
  });

  it("the app's wait is the server's 30 minutes", () => {
    const b = body("report_helper_no_show");
    expect(b).toContain(`interval '${NO_SHOW_WAIT_MINUTES} minutes'`);
    expect(NO_SHOW_WAIT_MINUTES).toBe(30);
  });

  it("opens at 9:30 AM for a 9:00 AM job, at the day's end for a job with no time", () => {
    expect(noShowOpensAt("2037-11-12", "09:00:00")?.toISOString()).toBe(central(9, 30).toISOString());
    expect(noShowReportOpen("2037-11-12", "09:00:00", central(9))).toBe(false);
    expect(noShowReportOpen("2037-11-12", "09:00:00", central(9, 29, 59))).toBe(false);
    expect(noShowReportOpen("2037-11-12", "09:00:00", central(9, 30))).toBe(true);
    expect(noShowOpensAt("2037-11-12", null)?.toISOString()).toBe(central(0, 0, 0, 13).toISOString());
    expect(noShowOpensAt(null, "09:00")).toBeNull();
  });

  it("says when it opens, in the server hint's words", () => {
    expect(noShowOpensLine("2037-11-12", "09:00:00", central(9, 5))).toBe("You can report a no-show from 9:30 AM.");
    expect(noShowOpensLine("2037-11-12", "13:45:00", central(14))).toBe("You can report a no-show from 2:15 PM.");
    expect(noShowOpensLine("2037-11-12", "09:00:00", central(20, 0, 0, 11))).toBe("You can report a no-show from Thu, Nov 12 at 9:30 AM.");
    expect(noShowOpensLine("2037-11-12", null, central(10))).toMatch(/once the day is over/);
  });
});

describe("F284: the sheet keeps Confirm off until the report opens", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  const job = { id: "j1", date_needed: "2037-11-12", start_time: "09:00:00" };
  const confirm = () => screen.getByRole("button", { name: /Confirm No-Show/ });

  it("at 9:10 AM: says it opens at 9:30 AM and Confirm is off", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(central(9, 10));
    render(<NoShowDialog jobId="j1" job={job} onClose={() => {}} onConfirm={() => {}} reporting={false} />);
    expect(screen.getByTestId("no-show-opens-line").textContent).toBe("You can report a no-show from 9:30 AM.");
    expect(confirm()).toBeDisabled();
  });

  it("at 9:30 AM: no wait line and Confirm is on", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(central(9, 30));
    render(<NoShowDialog jobId="j1" job={job} onClose={() => {}} onConfirm={() => {}} reporting={false} />);
    expect(screen.queryByTestId("no-show-opens-line")).toBeNull();
    expect(confirm()).not.toBeDisabled();
  });
});
