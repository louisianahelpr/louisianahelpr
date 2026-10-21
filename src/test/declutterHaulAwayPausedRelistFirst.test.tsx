/**
 * Q2261 (owner, 2026-10-21, binding): a PAUSED Declutter listing must be
 * relisted before a haul-away can take it. The server keeps refusing one, and
 * the screen says so. This guard pins both halves:
 *
 *   1. The server still takes only 'live' or 'ended': the NEWEST effective
 *      definitions of declutter_link_haul_away (refuses anything else with
 *      haul_away_not_unsold) and declutter_haul_away_state (lists only those),
 *      read through effectiveDefs (any dollar-quote tag, later rewrites
 *      applied), comments blanked with blankSqlComments, never name 'paused'.
 *      Accepting 'paused' there is a new owner decision, not a fix.
 *   2. The seller is told: under each paused listing on My listings, on the
 *      "Haul it away" card when the seller has paused items, and in the words
 *      for haul_away_not_unsold (a seller who paused an item after opening
 *      Post a Job gets that refusal) — each says to relist first.
 *
 * @mutate src/components/declutter/DeclutterHaulAway.tsx |     if (itemStatus !== "paused") return null; |     if (true) return null;
 * @mutate src/components/declutter/DeclutterHaulAway.tsx |       {pausedCount > 0 && ( |       {false && (
 * @mutate src/lib/declutter/haulAwayErrors.ts |  If it's paused, relist it first.", | ",
 * @mutate supabase/migrations/20261017070827_declutter_haul_away.sql |     ELSIF v_item.status <> 'ended' THEN |     ELSIF v_item.status NOT IN ('ended', 'paused') THEN
 * @mutate supabase/migrations/20261017070827_declutter_haul_away.sql | i.status IN ('live', 'ended') | i.status IN ('live', 'ended', 'paused')
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HaulAwayCard, HaulAwayItemLine } from "@/components/declutter/DeclutterHaulAway";
import { HAUL_AWAY_ERROR_COPY, rpcErrorMessage } from "@/lib/declutter/haulAwayErrors";
import type { HaulAwayRow } from "@/lib/declutter/haulAwayParam";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const MIGRATIONS = join(REPO, "supabase", "migrations");

const row = (over: Partial<HaulAwayRow> = {}): HaulAwayRow => ({
  item_id: "i1",
  title: "Oak rocking chair",
  description: "",
  delivery_size: "large",
  item_status: "live",
  state: "eligible",
  eligible_at: null,
  job_id: null,
  pickup_group: "g",
  photo_paths: [],
  job_hold: null,
  ...over,
});
const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

/** Every listing status the app knows (src/lib/declutter/api.ts DeclutterStatus). */
function declutterStatuses(): string[] {
  const src = readFileSync(join(REPO, "src/lib/declutter/api.ts"), "utf8");
  const m = src.match(/export type DeclutterStatus =([\s\S]*?);/);
  return m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : [];
}

describe("Q2261: a paused listing is relisted before a haul-away (server half)", () => {
  const defs = effectiveDefs(MIGRATIONS);
  const body = (fn: string): string => {
    const d = defs.get(fn);
    if (!d) throw new Error(`${fn} has no live definition in supabase/migrations`);
    return blankSqlComments(d.stmt);
  };

  it("reads real definitions, and 'paused' is a status the app knows", () => {
    expect(defs.size).toBeGreaterThan(500);
    const statuses = declutterStatuses();
    expect(statuses.length).toBeGreaterThan(8);
    expect(statuses).toContain("paused");
  });

  it("declutter_link_haul_away takes only 'live' or 'ended' and refuses the rest with haul_away_not_unsold", () => {
    const link = body("declutter_link_haul_away");
    expect(link).toMatch(
      /IF\s+v_item\.status\s*=\s*'live'\s+THEN[\s\S]*?ELSIF\s+v_item\.status\s*<>\s*'ended'\s+THEN\s*RAISE\s+EXCEPTION\s+'haul_away_not_unsold'/i,
    );
    expect(link).not.toMatch(/'paused'/);
  });

  it("declutter_haul_away_state lists only the seller's 'live' and 'ended' items", () => {
    const state = body("declutter_haul_away_state");
    expect(state).toMatch(/i\.status\s+IN\s*\(\s*'live'\s*,\s*'ended'\s*\)/i);
    expect(state).not.toMatch(/'paused'/);
  });
});

describe("Q2261: the seller is told to relist first (screen half)", () => {
  it("a paused listing (it has no haul-away row) says to relist it first", () => {
    wrap(<HaulAwayItemLine row={undefined} itemStatus="paused" />);
    expect(screen.getByText("Paused items can't be hauled away. Relist it first to add it to a haul-away.")).toBeTruthy();
  });

  it("no other status without a row gets that line", () => {
    const others = declutterStatuses().filter((s) => s !== "paused");
    expect(others.length).toBeGreaterThan(7);
    for (const s of others) {
      const { container, unmount } = wrap(<HaulAwayItemLine row={undefined} itemStatus={s} />);
      expect(container.textContent).toBe("");
      unmount();
    }
  });

  it("the Haul it away card says paused items were left out, only when there are some", () => {
    const { unmount } = wrap(<HaulAwayCard group={[row()]} pausedCount={2} />);
    expect(screen.getByText("Paused items can't be hauled away. Relist an item first to add it.")).toBeTruthy();
    unmount();
    wrap(<HaulAwayCard group={[row()]} />);
    expect(screen.queryByText(/Paused items/)).toBeNull();
  });

  it("the haul_away_not_unsold refusal says to relist a paused item first", () => {
    expect(HAUL_AWAY_ERROR_COPY.haul_away_not_unsold).toMatch(/relist it first/i);
    expect(rpcErrorMessage("declutter_link_haul_away", { message: "haul_away_not_unsold" })).toMatch(/If it's paused, relist it first\./);
  });
});
