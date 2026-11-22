/**
 * Deep audit 11-22 #40: "You have 1 of 3 strikes." sat above Browse on every visit, was announced by screen readers
 * each time, and gave no reason, no consequence and no link. Now:
 *  - Browse, Free, Wanted and Deliver show nothing under 3 strikes (`pausedOnly`); Buying and Selling keep it.
 *  - The one line is not a live region and has a "Why?" that opens each strike's reason, the day it goes away and
 *    what happens at 3; the full card lists the reasons too.
 *  - Every reason the database allows has words, read from the NEWEST declutter_strikes_reason_check in the
 *    migrations (exact both ways), in English and Spanish.
 *
 * @mutate src/components/declutter/DeclutterTabHeads.tsx |   if (pausedOnly && n < 3) return null; |   void pausedOnly;
 * @mutate src/components/declutter/DeclutterHomeView.tsx | top={<StrikeCount userId={user.id} full={false} pausedOnly />} | top={<StrikeCount userId={user.id} full={false} />}
 * @mutate src/components/declutter/DeclutterTabHeads.tsx |         {why && <div id={whyId}><StrikeReasons userId={userId} /> |         {false && <div id={whyId}><StrikeReasons userId={userId} />
 * @mutate src/lib/declutter/strikeReasons.ts |   "fake_offer", "false_report", |   "fake_offer",
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const state = vi.hoisted(() => ({ n: 1, reasons: [{ reason: "missed_checkout", expires_at: "2027-11-02T12:00:00Z" }] }));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<object>()),
  fetchMyActiveStrikes: async () => state.n,
  fetchMyActiveStrikeReasons: async () => state.reasons,
}));

import { StrikeCount } from "@/components/declutter/DeclutterTabHeads";
import { STRIKE_REASONS } from "@/lib/declutter/strikeReasons";
import { enDeclSell } from "@/lib/i18n/enDeclSell";
import { esDeclSell } from "@/lib/i18n/esDeclSell";

const enDict = enDeclSell as Record<string, string>;
const esDict = esDeclSell as Record<string, string>;

const REPO = resolve(__dirname, "..", "..");
const show = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

/** The reasons the newest declutter_strikes_reason_check allows (any dollar tag; comments blanked). */
function allowedReasons(): string[] {
  const dir = resolve(REPO, "supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files.reverse()) {
    const sql = blankSqlComments(readFileSync(resolve(dir, f), "utf8"));
    const all = [...sql.matchAll(/declutter_strikes_reason_check\s+CHECK\s*\(\s*reason\s+IN\s*\(([^)]*)\)/gi)];
    if (all.length) return [...all[all.length - 1][1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  }
  return [];
}

beforeEach(() => {
  state.n = 1;
  state.reasons = [{ reason: "missed_checkout", expires_at: "2027-11-02T12:00:00Z" }];
});

describe("#40: strikes say why, and only where they come from", () => {
  it("every reason the database allows has its own words, in English and Spanish", () => {
    const allowed = allowedReasons();
    expect(allowed.length).toBeGreaterThan(7);
    expect([...STRIKE_REASONS].sort()).toEqual([...allowed].sort());
    for (const r of allowed) {
      expect(enDict[`dsl.strike.r.${r}`], r).toBeTruthy();
      expect(esDict[`dsl.strike.r.${r}`], r).toBeTruthy();
      expect(enDict[`dsl.strike.r.${r}`]).not.toBe(enDict["dsl.strike.r.other"]);
    }
  });

  it("Browse, Free, Wanted and Deliver show nothing under 3 strikes; the full card shows at 3", async () => {
    const r = show(<StrikeCount userId="u1" full={false} pausedOnly />);
    await new Promise((res) => setTimeout(res, 20));
    expect(screen.queryByText(/of 3 strikes/)).toBeNull();
    r.unmount();
    state.n = 3;
    show(<StrikeCount userId="u1" full={false} pausedOnly />);
    expect(await screen.findByText(/Declutter is paused for you/)).toBeInTheDocument();
    const home = blankComments(readFileSync(resolve(REPO, "src/components/declutter/DeclutterHomeView.tsx"), "utf8"));
    expect(home).toContain("top={<StrikeCount userId={user.id} full={false} pausedOnly />}");
    expect(home).toContain('pausedOnly={view !== "selling" && view !== "buying"}');
  });

  it("the one line is not announced, and Why? opens the reason, the day it goes away and what happens at 3", async () => {
    const { container } = show(<StrikeCount userId="u1" full={false} />);
    expect(await screen.findByText("You have 1 of 3 strikes.")).toBeInTheDocument();
    expect(container.querySelector('[role="status"], [aria-live]')).toBeNull();
    expect(screen.queryByText(/didn't pay in time/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Why?" }));
    expect(await screen.findByText(/You didn't pay in time for an item you were buying\. Goes away Nov 2, 2027\./)).toBeInTheDocument();
    expect(screen.getByText(/At 3 strikes you can't buy or sell on Declutter/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide" })).toHaveAttribute("aria-expanded", "true");
  });

  it("the full card on Selling lists the reasons too", async () => {
    show(<StrikeCount userId="u1" />);
    expect(await screen.findByText(/You didn't pay in time for an item you were buying\./)).toBeInTheDocument();
  });
});
