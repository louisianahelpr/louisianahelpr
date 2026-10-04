/**
 * THE COLLAPSED STATUS LINE NAMES THE NEXT STEP AND SHOWS EVERY CLOCK
 * (owner, 2026-10-01).
 *
 * Two classes, each checked against an inventory read from source:
 *
 * 1. COPY THAT TOLD THE READER NOTHING never comes back. "Day passed — mark it
 *    done or cancel" offered one sentence for six different overdue states;
 *    "This job didn't happen" hid a cancellation's reason; "They asked for a
 *    fix" hid the revision note. Each is banned across non-test `src/`.
 *
 * 2. EVERY TRACKED DEADLINE IS VISIBLE, collapsed AND expanded, on BOTH tabs.
 *    The inventory is every `jobs` column the client can read whose name ends
 *    in `deadline` or `expires_at` (`JOB_READABLE_COLUMN_LIST`), plus the
 *    derived auto-complete clock, minus two named exemptions. A new deadline
 *    column added to the jobs table lands in this inventory on the next types
 *    regen and fails here until a countdown shows it.
 */
// @mutate src/components/job-card/jobStatusLine.ts | return columnDeadline("revision_deadline", job.revision_deadline, "left for their fix", "Fix deadline passed"); | return null;
// @mutate src/components/job-card/JobStatusStrip.tsx | {line.deadline && ( | {false && line.deadline && (
// @mutate src/pages/posts/postedJobCard/steps/OpenStep.tsx | posterDeadline("offer_out", job) | null
// @mutate src/components/job-card/offerClock.ts |   const hardDeadline = job?.response_deadline ?? job?.direct_offer_expires_at ?? null; |   const hardDeadline = job?.response_deadline ?? null;
// @mutate src/components/job-card/jobStatusLine.ts | overdue_no_show: { detail: | overdue_no_show: { detail: "Day passed — mark it done or cancel", x:
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { JOB_READABLE_COLUMN_LIST } from "@/lib/jobColumns";
import {
  HELPER_WAIT,
  HELPER_WAIT_IDS,
  POSTER_WAIT,
  POSTER_WAIT_IDS,
  helperDeadline,
  posterDeadline,
  type DeadlineSource,
  type JobStatusLine,
  type StatusDeadline,
} from "@/components/job-card/jobStatusLine";
import { JobStatusStrip } from "@/components/job-card/JobStatusStrip";
import type { Job } from "@/components/job-card/activityConstants";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const isTest = (p: string) => /(\/test\/|\.test\.tsx?$|\.spec\.tsx?$)/.test(p);
const SOURCE = walk(SRC).filter((p) => !isTest(p));

/* ── 1. Old copy ─────────────────────────────────────────────────────────── */

const RETIRED_COPY = [
  "Day passed — mark it done or cancel",
  "This job didn't happen",
  "They asked for a fix",
];

describe("retired status-line copy", () => {
  it("scans a real source tree", () => {
    expect(SOURCE.length).toBeGreaterThan(100);
  });

  it.each(RETIRED_COPY)("%s appears in no non-test source", (phrase) => {
    const hits = SOURCE.filter((p) => blankComments(readFileSync(p, "utf8")).includes(phrase)).map((p) =>
      relative(ROOT, p),
    );
    expect(hits).toEqual([]);
  });

  it("no copy-table row is shared by more than one overdue state", () => {
    for (const table of [POSTER_WAIT, HELPER_WAIT] as Record<string, { detail: string }>[]) {
      const overdue = Object.entries(table).filter(([id]) => id.startsWith("overdue"));
      expect(overdue.length).toBeGreaterThan(2);
      const details = overdue.map(([, c]) => c.detail);
      expect(new Set(details).size).toBe(details.length);
    }
  });
});

/* ── 2. Deadlines ────────────────────────────────────────────────────────── */

/**
 * Columns that match the name pattern but are not a tracker step's clock.
 * Two-way: each must still exist in the inventory, so a renamed column cannot
 * leave a dead exemption behind.
 */
// @two-way src/test/statusLineCopyAndDeadlines.test.tsx:every exemption names a real column
const EXEMPT: Record<string, string> = {
  boost_expires_at: "a paid promotion's end, shown in OpenStep's boost banner; not a step of the job",
  expires_at: "the listing's own expiry, shown on every card by JobCardMetaRow (useExpiryClock)",
};

const COLUMN_DEADLINES = (JOB_READABLE_COLUMN_LIST as readonly string[]).filter((c) =>
  /(^|_)(deadline|expires_at)$/.test(c),
);
const INVENTORY = [...COLUMN_DEADLINES.filter((c) => !(c in EXEMPT)), "auto_complete"];

describe("the deadline inventory", () => {
  it("is read from the readable jobs columns, not typed here", () => {
    expect(COLUMN_DEADLINES.length).toBeGreaterThan(6);
    expect(INVENTORY.length).toBeGreaterThan(5);
  });

  it("every exemption names a real column", () => {
    for (const c of Object.keys(EXEMPT)) expect(COLUMN_DEADLINES).toContain(c);
  });
});

const HOUR = 3_600_000;
const later = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const earlier = (h: number) => new Date(Date.now() - h * HOUR).toISOString();

/** A job with every clock set, so each state's deadline has something to read. */
function clockedJob(over: Partial<Record<string, unknown>> = {}): Job {
  const job: Record<string, unknown> = {
    id: "job-1",
    title: "Clocks",
    status: "in_progress",
    customer_id: "poster-1",
    helper_id: "helper-1",
    helper_completed_at: earlier(1),
    dispute_status: "open",
  };
  for (const c of COLUMN_DEADLINES) job[c] = later(24);
  return { ...job, ...over } as unknown as Job;
}
// `response_deadline` outranks `direct_offer_expires_at` on an offer (the `??`
// OfferedActions reads), so the second fixture lets the older column show.
const FIXTURES = [clockedJob(), clockedJob({ response_deadline: null })];

type Side = "poster" | "helper";
const collapsed: Record<Side, Map<DeadlineSource, Set<string>>> = { poster: new Map(), helper: new Map() };
const lines: { side: Side; id: string; deadline: StatusDeadline }[] = [];
for (const job of FIXTURES) {
  for (const id of POSTER_WAIT_IDS) {
    const d = posterDeadline(id, job);
    if (!d) continue;
    if (!collapsed.poster.has(d.source)) collapsed.poster.set(d.source, new Set());
    collapsed.poster.get(d.source)!.add(id);
    lines.push({ side: "poster", id, deadline: d });
  }
  for (const id of HELPER_WAIT_IDS) {
    const d = helperDeadline(id, job);
    if (!d) continue;
    if (!collapsed.helper.has(d.source)) collapsed.helper.set(d.source, new Set());
    collapsed.helper.get(d.source)!.add(id);
    lines.push({ side: "helper", id, deadline: d });
  }
}

describe("every deadline shows on the collapsed line, on both tabs", () => {
  it("states with a clock exist", () => {
    expect(lines.length).toBeGreaterThan(21);
  });

  it.each(INVENTORY)("%s has a collapsed countdown for the poster AND the Helpr", (source) => {
    expect([...(collapsed.poster.get(source as DeadlineSource) ?? [])]).not.toEqual([]);
    expect([...(collapsed.helper.get(source as DeadlineSource) ?? [])]).not.toEqual([]);
  });

  it("every deadline a state returns is in the inventory (no clock outside it)", () => {
    for (const { deadline } of lines) expect(INVENTORY).toContain(deadline.source);
  });

  it("the strip renders each state's clock", () => {
    for (const { side, id, deadline } of lines) {
      const line: JobStatusLine = { id, eyebrow: "Waiting", detail: "x", tone: "them", deadline } as JobStatusLine;
      const { container, unmount } = render(<JobStatusStrip line={line} />);
      const clock = container.querySelector("[data-deadline-countdown]");
      expect(clock, `${side}:${id} (${deadline.source})`).not.toBeNull();
      unmount();
    }
  });

  it("a state whose expanded step shows a clock shows it collapsed too", () => {
    // ScheduledStep shows the confirm window whenever helper_confirmed_at is
    // unset, including past the day.
    expect(posterDeadline("overdue_unconfirmed", clockedJob())?.source).toBe("response_deadline");
  });

  it("states without a clock render none (null-safe on an ownerless job)", () => {
    const ownerless = clockedJob({ customer_id: null, helper_id: null, dispute_status: "escalated" });
    expect(posterDeadline("dispute", ownerless)).toBeNull();
    expect(posterDeadline("cancelled", ownerless)).toBeNull();
    expect(helperDeadline("submitted", clockedJob({ helper_completed_at: null }))).toBeNull();
  });
});

/* ── Expanded trackers ───────────────────────────────────────────────────── */

const POSTER_TREE = join(SRC, "pages", "posts");
const HELPER_TREE = join(SRC, "pages", "jobs");

/**
 * Shared readers of a deadline column: a file calling one reads the column
 * through it. offerClock() is the offer card's clock, shared with the Activity
 * buckets (owner, 2026-10-03); the test below proves it still reads both.
 */
const VIA_READERS: Partial<Record<DeadlineSource, string[]>> = {
  response_deadline: ["offerClock("],
  direct_offer_expires_at: ["offerClock("],
};

it("offerClock() still reads the two columns it stands in for", () => {
  const code = blankComments(readFileSync(join(SRC, "components", "job-card", "offerClock.ts"), "utf8"));
  expect(code).toContain("job?.response_deadline ?? job?.direct_offer_expires_at");
});

/**
 * A file shows a clock when it renders `<DeadlineCountdown` AND reads the
 * source: by column name, by `AUTO_COMPLETE_HOURS`, through a shared reader
 * (VIA_READERS), or through posterDeadline/helperDeadline for a state the
 * collapsed map says carries it.
 */
function expandedShows(tree: string, side: Side, source: DeadlineSource): string[] {
  const viaIds = [...(collapsed[side].get(source) ?? [])].map(
    (id) => `${side === "poster" ? "posterDeadline" : "helperDeadline"}("${id}"`,
  );
  const needles = [source === "auto_complete" ? "AUTO_COMPLETE_HOURS" : source, ...(VIA_READERS[source] ?? []), ...viaIds];
  return walk(tree)
    .filter((p) => !isTest(p))
    .filter((p) => {
      const code = blankComments(readFileSync(p, "utf8"));
      return code.includes("<DeadlineCountdown") && needles.some((n) => code.includes(n));
    })
    .map((p) => relative(ROOT, p));
}

describe("every deadline shows in the expanded tracker, on both tabs", () => {
  it.each(INVENTORY)("%s", (source) => {
    expect(expandedShows(POSTER_TREE, "poster", source as DeadlineSource), "Posts").not.toEqual([]);
    expect(expandedShows(HELPER_TREE, "helper", source as DeadlineSource), "Jobs").not.toEqual([]);
  });
});
