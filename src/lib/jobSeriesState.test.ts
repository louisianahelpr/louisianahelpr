/**
 * Deploy order (money/authz review 2026-09-25, LOW): a push ships the web app
 * and the migrations in parallel, so a jobs column the web app selects in
 * JOB_READABLE_COLUMN_LIST before db-deploy adds it 42703s EVERY list read.
 * The recurring-series columns are therefore read on their own by
 * fetchJobSeriesState, which degrades to "no series state" on a missing column.
 *
 * @mutate src/lib/jobSeriesState.ts |   return code === "42703" \|\| code === "PGRST204" \|\| |   return code === "PGRST204" \|\|
 * @mutate src/lib/jobSeriesState.ts |     if (!isMissingColumnError(error)) { |     if (true) {
 * @mutate src/lib/jobColumns.ts |   "sales_tax_rate", |   "sales_tax_rate", "series_ended_on",
 * @mutate src/hooks/useActivityData.ts |   const seriesState = await fetchJobSeriesState( |   const seriesState = new Map<string, Record<string, string | null>>(); void (
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const inMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => fromMock(t) },
}));
const reportMock = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => reportMock(...a) }));

import { fetchJobSeriesState, isMissingColumnError } from "./jobSeriesState";
import { JOB_READABLE_COLUMN_LIST, JOB_SERIES_STATE_COLUMNS } from "./jobColumns";

beforeEach(() => {
  inMock.mockReset();
  selectMock.mockReset();
  fromMock.mockReset();
  reportMock.mockReset();
  fromMock.mockReturnValue({ select: selectMock });
  selectMock.mockReturnValue({ in: inMock });
});

describe("recurring-series columns are read apart from the main jobs list", () => {
  it("none of them is in JOB_READABLE_COLUMN_LIST (a missing one would fail every list read)", () => {
    expect(JOB_SERIES_STATE_COLUMNS.length).toBeGreaterThan(0);
    const overlap = (JOB_SERIES_STATE_COLUMNS as readonly string[]).filter((c) =>
      (JOB_READABLE_COLUMN_LIST as readonly string[]).includes(c),
    );
    expect(overlap).toEqual([]);
  });

  it("a missing column (db-deploy not landed) is an empty map, not an error or a report", async () => {
    for (const error of [
      { code: "42703", message: 'column jobs.series_ended_on does not exist' },
      { code: "PGRST204", message: "Could not find the 'series_ended_on' column" },
    ]) {
      inMock.mockResolvedValueOnce({ data: null, error });
      const out = await fetchJobSeriesState(["j1"]);
      expect(out.size).toBe(0);
    }
    expect(reportMock).not.toHaveBeenCalled();
    expect(isMissingColumnError({ code: "42501", message: "permission denied" })).toBe(false);
    // Each signal on its own.
    expect(isMissingColumnError({ code: "42703", message: "" })).toBe(true);
    expect(isMissingColumnError({ code: "PGRST204", message: "" })).toBe(true);
    expect(isMissingColumnError({ code: "", message: "column jobs.x does not exist" })).toBe(true);
  });

  it("any other failure is reported, still never throws", async () => {
    inMock.mockResolvedValueOnce({ data: null, error: { code: "08006", message: "connection reset" } });
    const out = await fetchJobSeriesState(["j1"]);
    expect(out.size).toBe(0);
    expect(reportMock).toHaveBeenCalledTimes(1);
  });

  it("returns each row's series state by id, and asks for exactly the series columns", async () => {
    inMock.mockResolvedValueOnce({ data: [{ id: "j1", series_ended_on: "2026-10-01" }], error: null });
    const out = await fetchJobSeriesState(["j1", "j1"]);
    expect(out.get("j1")).toEqual({ series_ended_on: "2026-10-01" });
    expect(selectMock).toHaveBeenCalledWith(["id", ...JOB_SERIES_STATE_COLUMNS].join(", "));
    expect(inMock).toHaveBeenCalledWith("id", ["j1"]);
  });

  it("the poster's Activity read merges the series state from this enrichment", () => {
    const src = readFileSync("src/hooks/useActivityData.ts", "utf8");
    expect(src).toMatch(/const seriesState = await fetchJobSeriesState\(/);
    expect(src).toMatch(/\.\.\.seriesState\.get\(j\.id\)/);
  });
});
