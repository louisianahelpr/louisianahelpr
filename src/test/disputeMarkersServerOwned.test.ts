import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script, no type declarations
import * as contract from "../../scripts/audit/write-contract.mjs";

/**
 * DISPUTE MARKERS ARE SERVER-OWNED (20260915033734_dispute_markers_server_owned).
 *
 * The class: a client `.from("jobs").update(...)` that writes a dispute marker
 * directly. DisputeDialog.tsx's RPC-not-deployed fallback did exactly that
 * (status 'disputed' + disputed_at + disputed_by), which is the table door the
 * money review found: a poster could freeze a completed job's payout without
 * the admin queue ever seeing it. The database now refuses such a write from
 * any non-admin session (probe: scripts/probes/dispute-table-door.probe.mjs).
 * This guard keeps the client from shipping one again, because on prod it can
 * only fail.
 *
 * Inventory: every jobs write in src/, read off the AST by the write-contract
 * extractor (the same one writeContract.test.ts uses). The one client write
 * the trigger allows is the assigned Helpr's dispute response
 * (dispute_status 'helper_responded'). Admin screens are exempt, as they are
 * in the trigger.
 */

type Write = {
  kind: string;
  target: string;
  file: string;
  line: number;
  payload: { keys: Record<string, unknown[] | null>; open: boolean } | null;
};

// Shown able to fail on the LIVE inventory, not only the synthetic cases: turn
// the one allowed client dispute write into a de-escalation and the AST-derived
// scan reds.
// @mutate src/pages/jobs/appliedJobCard/DisputedSection.tsx | dispute_status: "helper_responded" | dispute_status: "open"

/** Columns no client may write, whatever the value. */
const MARKERS = ["disputed_at", "disputed_by", "dispute_deadline", "dispute_resolved_at"] as const;

/**
 * Open payloads (computed keys or a variable patch) the extractor cannot read.
 * Each was read by hand; the guard fails if one appears or disappears.
 */
const OPEN_JOB_WRITES: Record<string, string> = {
  "src/components/JobConfirmation.tsx": "`{ [field]: now }` where field is poster_confirmed_at | helper_dayof_confirmed_at",
  "src/components/JobTracking.tsx": "stampJob(patch): { status: 'in_progress' } and { helper_on_the_way_at }",
  "src/pages/post-job/useJobSubmit.ts": "job INSERT payloads; on INSERT trg_dispute_markers_server_owned clears every marker for a client",
};

const isAdmin = (file: string) => file.startsWith("src/components/admin/");

function violations(writes: Write[]): string[] {
  const out: string[] = [];
  for (const w of writes) {
    if (w.target !== "jobs" || w.kind === "rpc" || w.kind === "delete" || isAdmin(w.file)) continue;
    const at = `${w.file}:${w.line}`;
    const keys = w.payload?.keys ?? {};
    for (const m of MARKERS) if (m in keys) out.push(`${at} writes jobs.${m}`);
    if ("status" in keys) {
      const v = keys.status;
      if (v === null) out.push(`${at} writes jobs.status with a value the guard cannot read`);
      else if (v.includes("disputed")) out.push(`${at} writes jobs.status = 'disputed'`);
    }
    if ("dispute_status" in keys) {
      const v = keys.dispute_status;
      if (v === null || v.some((x) => x !== "helper_responded")) out.push(`${at} writes jobs.dispute_status other than 'helper_responded'`);
    }
  }
  return out;
}

const { writes } = contract.extractWrites() as { writes: Write[] };
const jobWrites = writes.filter((w) => w.target === "jobs" && w.kind !== "rpc" && w.kind !== "delete");

describe("dispute markers are server-owned: no client write to jobs sets one", () => {
  it("inventories the jobs writes", () => {
    // Floor: an extractor regression that finds nothing must not pass vacuously.
    expect(jobWrites.length).toBeGreaterThan(10);
    expect(jobWrites.some((w) => w.file === "src/pages/jobs/appliedJobCard/DisputedSection.tsx")).toBe(true);
  });

  it("no non-admin jobs write touches a dispute marker", () => {
    expect(violations(jobWrites)).toEqual([]);
  });

  it("every open (unreadable) jobs write was read by hand, and the list is exact", () => {
    const open = [...new Set(jobWrites.filter((w) => w.payload?.open && !isAdmin(w.file)).map((w) => w.file))].sort();
    expect(open).toEqual(Object.keys(OPEN_JOB_WRITES).sort());
  });

  it("the guard's columns are the trigger's columns", () => {
    const dir = "supabase/migrations";
    const file = readdirSync(dir).filter((f) => f.endsWith("_dispute_markers_server_owned.sql")).sort().pop();
    expect(file).toBeTruthy();
    const sql = readFileSync(join(dir, file!), "utf8");
    const of = sql.match(/BEFORE INSERT OR UPDATE OF ([a-z_, ]+)\n/)?.[1].split(",").map((s) => s.trim()).sort();
    expect(of).toEqual([...MARKERS, "status", "dispute_status"].sort());
  });

  describe("the guard can fail", () => {
    it("on the original bug: DisputeDialog's direct-write fallback", () => {
      const original: Write = {
        kind: "update", target: "jobs", file: "src/components/DisputeDialog.tsx", line: 175,
        payload: { keys: { status: null, dispute_reason: null, dispute_evidence_urls: null, disputed_at: null, disputed_by: null }, open: false },
      };
      expect(violations([original])).toEqual([
        "src/components/DisputeDialog.tsx:175 writes jobs.disputed_at",
        "src/components/DisputeDialog.tsx:175 writes jobs.disputed_by",
        "src/components/DisputeDialog.tsx:175 writes jobs.status with a value the guard cannot read",
      ]);
    });

    it("on a literal status 'disputed', a de-escalation, and a pushed deadline", () => {
      const w = (keys: Record<string, unknown[] | null>): Write => ({ kind: "update", target: "jobs", file: "src/x.tsx", line: 1, payload: { keys, open: false } });
      expect(violations([w({ status: ["disputed"] })])).toHaveLength(1);
      expect(violations([w({ dispute_status: ["open"] })])).toHaveLength(1);
      expect(violations([w({ dispute_deadline: null })])).toHaveLength(1);
      // ...and it does not fire on the one allowed write, or on an admin screen.
      expect(violations([w({ dispute_helper_response: null, dispute_status: ["helper_responded"] })])).toEqual([]);
      expect(violations([{ ...w({ status: null, dispute_resolved_at: null }), file: "src/components/admin/AdminDisputes.tsx" }])).toEqual([]);
    });
  });
});
