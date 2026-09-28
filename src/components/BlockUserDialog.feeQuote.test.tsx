/**
 * Q236(c) (owner, 2026-09-27): NO cancellation fee on an offer the Helpr never
 * accepted. The server already prices on commitment (block_user_and_settle,
 * poster_cancel_job: helper_id AND helper_confirmed_at, verified live
 * 2026-09-27). The block dialog's quote priced any ASSIGNED Helpr, so blocking
 * the Helpr on a chosen-but-not-accepted job promised a cancellation fee the
 * server never charges. This pins the quote to the server's rule.
 */
// @mutate src/components/BlockUserDialog.tsx | helper_confirmed_at: r.helper_confirmed_at ?? null, | helper_confirmed_at: r.helper_id,
// @mutate src/components/BlockUserDialog.tsx | start_time: r.start_time ?? null, | start_time: null,
// @mutate src/components/BlockUserDialog.tsx | estimatedFee > 0 ? ( | estimatedFee >= 0 ? (
// @mutate supabase/functions/_shared/crewShares.ts | const pct = cancellationFeePercent(committed, hoursUntilStart); | const pct = cancellationFeePercent(true, hoursUntilStart);
// @mutate src/components/BlockUserDialog.tsx | .is("helper_completed_at", null); | ;
// @mutate src/components/CancellationDialog.tsx | sharedCancellationFeePercent(hasHelper, hoursUntilJob) | sharedCancellationFeePercent(false, hoursUntilJob)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankNonCode } from "@/test/helpers/blankNonCode";

const rows: Array<Record<string, unknown>> = [];
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/userBlocks", () => ({ blockUser: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { id: "poster-1" } } })) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        or: vi.fn(() => ({
          // Awaitable as is (all rows) AND narrowable by .is(col, null), so
          // dropping the server's helper_completed_at filter is visible.
          in: vi.fn(() => ({
            then: (res: (v: unknown) => unknown) => res({ data: rows, error: null }),
            is: vi.fn((col: string, val: null) =>
              Promise.resolve({ data: rows.filter((r) => (r[col] ?? null) === val), error: null }),
            ),
          })),
        })),
      })),
    })),
  },
}));

import { BlockUserDialog } from "./BlockUserDialog";

// "Now" is pinned to 2026-09-27 12:00Z (07:00 Chicago). A job dated 09-26
// started yesterday: the 50% top tier for a committed Helpr.
function job(overrides: Record<string, unknown>) {
  return {
    id: "job-1",
    budget: 100,
    date_needed: "2026-09-26",
    start_time: null,
    customer_id: "poster-1",
    helper_id: "helper-1",
    helper_confirmed_at: null,
    ...overrides,
  };
}
function open() {
  render(<BlockUserDialog open onClose={vi.fn()} blockedUserId="helper-1" blockedUserName="Marie" />);
}
const liText = async (re: RegExp) =>
  (await screen.findByText((_, el) => el?.tagName === "LI" && re.test(el.textContent ?? ""))).textContent ?? "";

beforeEach(() => {
  rows.length = 0;
  vi.useFakeTimers({ now: new Date("2026-09-27T12:00:00Z"), toFake: ["Date"] });
});
afterEach(() => vi.useRealTimers());

describe("BlockUserDialog fee quote follows commitment (Q236 c)", () => {
  it("quotes NO fee when the Helpr was chosen but never accepted", async () => {
    rows.push(job({ helper_confirmed_at: null }));
    open();
    const text = await liText(/will be cancelled/);
    expect(text).toMatch(/no\s+cancellation fee applies/);
    expect(text).not.toMatch(/in cancellation fees will be/);
  });

  it("control: quotes the late fee once the Helpr accepted", async () => {
    rows.push(job({ helper_confirmed_at: "2026-09-20T12:00:00Z" }));
    open();
    expect(await liText(/will be cancelled/)).toMatch(/about \$50 in cancellation fees will be/);
  });

  it("leaves out work the Helpr already finished, as block_user_and_settle does", async () => {
    // The finished job is committed and late (would be $50); the server's
    // `helper_completed_at IS NULL` never cancels it, so neither does the quote.
    rows.push(job({ id: "job-done", helper_confirmed_at: "2026-09-20T12:00:00Z", helper_completed_at: "2026-09-26T20:00:00Z" }));
    rows.push(job({ id: "job-open", helper_confirmed_at: null }));
    open();
    const text = await liText(/will be cancelled/);
    expect(text).toMatch(/no\s+cancellation fee applies/);
    expect(text).not.toMatch(/\$50/);
  });

  it("prices on the job's START, not midnight of its day", async () => {
    // A committed job on 09-28 at 12:00 Chicago starts 29h out (free);
    // midnight of 09-28 is 17h out (25% = $25).
    rows.push(job({ date_needed: "2026-09-28", start_time: "12:00:00", helper_confirmed_at: "2026-09-20T12:00:00Z" }));
    open();
    const text = await liText(/will be cancelled/);
    expect(text).toMatch(/no\s+cancellation fee applies/);
    expect(text).not.toMatch(/\$25\b/);
  });
});

// The CLASS: a fee quote that decides "committed" by itself. Every call of the
// ladder (under any import alias) in app or edge code must pass a computed
// commitment, never a literal — `cancellationFeePercent(true, hours)` is how
// the block dialog priced an unaccepted offer. The call-site count is EXACT
// (two-way): a new quoting site has to be looked at and this number moved.
describe("fee ladder callers never hard-code commitment (Q236 c)", () => {
  const EXPECTED_CALL_SITES = 4;
  const roots = ["src", "supabase/functions"];
  function walk(dir: string, out: string[]) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "test") continue;
        walk(p, out);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  }
  const FILES = roots.flatMap((r) => walk(r, []));
  const calls: { file: string; arg: string }[] = [];
  for (const file of FILES) {
    const code = blankNonCode(readFileSync(file, "utf8"));
    const names = new Set<string>();
    if (/\bfunction\s+cancellationFeePercent\s*\(/.test(code)) names.add("cancellationFeePercent");
    const raw = readFileSync(file, "utf8");
    if (!/_shared\/cancellationFee|\.\/cancellationFee/.test(raw) && names.size === 0) continue;
    for (const m of code.matchAll(/\bcancellationFeePercent\b(?:\s+as\s+(\w+))?/g)) names.add(m[1] ?? "cancellationFeePercent");
    for (const n of names) {
      for (const m of code.matchAll(new RegExp(`(?<![\\w.])${n}\\s*\\(([^,)]*)`, "g"))) {
        const before = code.slice(Math.max(0, m.index! - 9), m.index);
        if (/function\s*$/.test(before)) continue;
        calls.push({ file, arg: m[1].trim() });
      }
    }
  }

  it("no call passes a boolean literal as the commitment", () => {
    // Floor: 2026-09-27 this walk read well over 1000 app + edge source files.
    expect(FILES.length).toBeGreaterThan(1000);
    expect(calls.filter((c) => /^(true|false)$/.test(c.arg))).toEqual([]);
  });

  it(`finds exactly ${EXPECTED_CALL_SITES} ladder call sites`, () => {
    expect(calls.length, JSON.stringify(calls)).toBe(EXPECTED_CALL_SITES);
  });
});
