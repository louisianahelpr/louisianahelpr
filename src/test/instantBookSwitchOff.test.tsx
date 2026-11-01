/**
 * INSTANT BOOK IS OFF FOR EVERYONE (owner order 11-01, through the lead: "jobs can be hours away"; she will revisit).
 *
 * The switch 'instant_book' is created OFF (20261101164117). Server: booking a Helpr, the poster's candidate list and
 * setting a floor refuse first thing (require_feature). Client: the Book now panel, the Helpr's booking card (page
 * and Working card), the Instant book settings tab and its Jobs settings row all draw nothing while it is off. The
 * decline, the reads and the refund sweeps keep running so nothing in flight is stranded.
 *
 * @mutate supabase/migrations/20261101164117_instant_book_switch_off.sql | ('instant_book', 'off', | ('instant_book', 'testers',
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | {instantBookOn && isPoster && !job.is_group_job && job.status === "open" && <InstantBookPanel | {isPoster && !job.is_group_job && job.status === "open" && <InstantBookPanel
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |   const instantUntil = instantBookOn ? bookedUntil : null; |   const instantUntil = bookedUntil;
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx |   if (!instantBookOn) return <GenericOfferedActions {...props} />; |   if (false) return <GenericOfferedActions {...props} />;
 * @mutate src/pages/profile/ProfileTabPanels.tsx |       {tab === "instant_book" && instantBookOn && ( |       {tab === "instant_book" && (
 * @mutate src/pages/jobs/JobsSettings.tsx | items: g.items.filter((i) => instantBookOn \|\| i.key !== "instant-book") | items: g.items
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "@/test/helpers/blankNonCode";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";

const flags = vi.hoisted(() => ({ on: false }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => k === "instant_book" && flags.on }));
import JobsSettings from "@/pages/jobs/JobsSettings";

const REPO = resolve(__dirname, "../..");
afterEach(cleanup);
vi.mock("@/integrations/supabase/client", async () => (await import("@/test/helpers/emptySupabaseClient")).emptySupabaseModule());
const wrap = (n: ReactNode) => <QueryClientProvider client={new QueryClient()}><MemoryRouter>{n}</MemoryRouter></QueryClientProvider>;
const MIG = join(REPO, "supabase", "migrations");
const read = (f: string) => blankComments(readFileSync(join(REPO, f), "utf8"));

describe("instant book is off (owner 11-01)", () => {
  it("the switch is created OFF, never on, and the client registry lists it", () => {
    const sql = blankSqlComments(readFileSync(join(MIG, "20261101164117_instant_book_switch_off.sql"), "utf8"));
    expect(sql).toMatch(/INSERT INTO public\.feature_switches \(key, audience, description\) VALUES \('instant_book', 'off',/);
    expect(read("src/config/featureSwitches.ts")).toContain('"instant_book",');
  });

  it("booking, the candidate list and setting a floor refuse first thing; the decline and the sweeps do not", () => {
    const defs = effectiveDefs(MIG);
    expect(defs.size).toBeGreaterThan(100);
    for (const fn of ["rpc_instant_book", "instant_book_candidates", "rpc_set_instant_book_floor"]) {
      const body = blankSqlComments(defs.get(fn)!.stmt);
      const begin = body.indexOf("\nBEGIN\n");
      expect(begin, fn).toBeGreaterThan(0);
      // The first statement after BEGIN.
      expect(body.slice(begin + 7).trimStart().startsWith("PERFORM public.require_feature('instant_book');"), fn).toBe(true);
    }
    for (const fn of ["rpc_instant_book_decline", "rpc_my_instant_bookings", "instant_book_refund_finished", "instant_book_captured_not_hired"]) {
      expect(blankSqlComments(defs.get(fn)!.stmt), fn).not.toContain("require_feature('instant_book')");
    }
  });

  it("every screen that offers it reads the switch", () => {
    const page = read("src/pages/jobs/jobPage/JobPage.tsx");
    expect(page).toContain('const instantBookOn = useFeature("instant_book");');
    expect(page).toContain("{instantBookOn && isPoster && !job.is_group_job && job.status === \"open\" && <InstantBookPanel");
    expect(page).toContain("const instantUntil = instantBookOn ? bookedUntil : null;");
    // Every booking card on the page hangs on instantUntil, which is null while off.
    expect((page.match(/<InstantBookingCard\b[^>]*>/g) ?? []).length).toBeGreaterThan(0);
    for (const m of page.match(/\{[^{}\n]*<InstantBookingCard\b/g) ?? []) expect(m).toContain("instantUntil");
    const offered = read("src/pages/jobs/appliedJobCard/OfferedActions.tsx");
    expect(offered).toContain('const instantBookOn = useFeature("instant_book");\n  if (!instantBookOn) return <GenericOfferedActions {...props} />;');
    expect(read("src/pages/profile/ProfileTabPanels.tsx")).toContain('{tab === "instant_book" && instantBookOn && (');
    expect(read("src/pages/jobs/JobsSettings.tsx")).toContain('items: g.items.filter((i) => instantBookOn || i.key !== "instant-book")');
  });

  it("rendered: Jobs settings has no Instant book row while off, and has it when on", () => {
    flags.on = false;
    const { unmount } = render(wrap(<JobsSettings />));
    expect(screen.getByText("Availability")).toBeTruthy();
    expect(screen.queryByText(/Let people book you now/)).toBeNull();
    unmount();
    flags.on = true;
    render(wrap(<JobsSettings />));
    expect(screen.getByText(/Let people book you now/)).toBeTruthy();
  });
});
