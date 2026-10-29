/**
 * A2-C42 (audit 2026-10-29, aa9-rh-*): the Leave series and Give up dates dialogs told the Helpr "another Helpr
 * on it can pick them up" on a one-Helpr series, where nobody else is on it. The sentence now follows the
 * series terms (series_split_ok): only a split series has other Helprs to pick the dates up.
 *
 * @mutate src/components/series/EndSeriesControl.tsx | ${endSentence(splitOk ? "another Helpr on it can pick them up, or the person who posted it can offer them to someone new" : | ${endSentence(true ? "another Helpr on it can pick them up, or the person who posted it can offer them to someone new" :
 * @mutate src/components/series/JobSeriesCardControls.tsx | mode="leave" splitOk={!!job.series_split_ok} /> | mode="leave" />
 * @mutate src/components/series/SeriesDatesPanel.tsx | description={`They go back to the series: ${endSentence(splitOk ? | description={`They go back to the series: ${endSentence(true ?
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(async () => ({ data: null, error: null })) } }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { EndSeriesControl } from "./EndSeriesControl";

function leave(splitOk?: boolean) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EndSeriesControl jobId="j1" jobTitle="Mow weekly" userId="h1" mode="leave" splitOk={splitOk} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Leave series" }));
  return screen.getByRole("alertdialog").textContent ?? "";
}

describe("Leaving a series names who can pick the dates up (A2-C42)", () => {
  it("a one-Helpr series: only the person who posted it", () => {
    const text = leave(false);
    expect(text).toContain("the person who posted it can offer them to someone new");
    expect(text).not.toMatch(/another Helpr/);
  });

  it("the inventory is real: a split series does have other Helprs", () => {
    expect(leave(true)).toContain("another Helpr on it can pick them up");
  });

  it("the Helpr card passes the series terms, and the Give up dialog follows them too", () => {
    const read = (f: string) => blankComments(readFileSync(resolve(__dirname, "../../..", f), "utf8"));
    expect(read("src/components/series/JobSeriesCardControls.tsx")).toMatch(/mode="leave" splitOk=\{!!job\.series_split_ok\}/);
    expect(read("src/components/series/SeriesDatesPanel.tsx")).toMatch(/They go back to the series: \$\{endSentence\(splitOk \?/);
  });
});
