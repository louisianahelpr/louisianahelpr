import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  dynamicJobsWriterReasons,
  jobsTriggers,
  newestFunctions,
  parseArgs,
  sqlArrayLiteral,
} from "../../scripts/lib/jobsWriteSurface.mjs";

/**
 * EVERY CLIENT-WRITABLE MONEY / STATE-MACHINE COLUMN ON public.jobs HAS A
 * TRANSITION GUARD.
 *
 * The bug this class came from (round-5 money review, 2026-09-14): a Helpr
 * could PATCH jobs.dispute_status straight from the browser. The column was on
 * the Helpr's allow-list (enforce_helper_jobs_column_whitelist), the RLS policy
 * "Helpers can update their assigned jobs" matched, and nothing constrained the
 * VALUE. So escalated -> open put an admin-only dispute back in front of the
 * 72h auto-resolve sweep, which pays the Helpr in full. Proven on prod inside a
 * rolled-back transaction. The poster had the same door on the other side
 * ("Customers can update their own jobs" has no WITH CHECK, and the poster lock
 * is a deny-list that never listed the dispute columns): a PATCH of disputed_at
 * on a payout_pending job stalled the payout.
 *
 * A column lock asks "may this seat touch the column". A money column also needs
 * "to what, from what". This test enumerates every jobs column from the app's
 * own schema (types.ts), keeps the money / state-machine ones, works out which
 * ones each client seat can write through the LIVE lock lists (read out of the
 * newest migration, not retyped), and fails for any that no transition guard
 * covers for that seat.
 *
 * It also fails on the one shape that would make the dispute guard's trust
 * unsound: a client-callable SECURITY DEFINER function writing jobs from a
 * caller-supplied column list or JSON patch (the guard trusts every statement
 * not running as anon/authenticated). The live half of that check is
 * scripts/check-jobs-dynamic-writers.mjs, run nightly in db-drift-detect.
 */

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");

const FILES = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(resolve(MIGRATIONS, name), "utf8") }));

type Fn = { name: string; body: string; file: string; secdef: boolean; returnsTrigger: boolean; clientCallable: boolean; args: { name: string; type: string }[] };

/** The inventory: jobs columns straight out of the generated schema types. */
function jobsColumns(): string[] {
  const types = readFileSync(resolve(ROOT, "src/integrations/supabase/types.ts"), "utf8");
  const start = types.search(/\n {6}jobs: \{\n {8}Row: \{/);
  expect(start, "could not find the jobs Row type in types.ts").toBeGreaterThan(-1);
  const rowBody = types.slice(start).match(/Row: \{([\s\S]*?)\n {8}\}/);
  expect(rowBody, "could not delimit jobs.Row").toBeTruthy();
  return [...rowBody![1].matchAll(/^ {10}([a-z_0-9]+):/gm)].map((m) => m[1]);
}

/**
 * Money and state-machine columns: the ones a payout, refund, dispute or
 * completion decision reads. By NAME, so a column added tomorrow is inventoried
 * without anyone remembering this file.
 */
const STATE_COLUMN = [
  /^status$/,
  /^payment_status$/,
  /^dispute_status$/,
  /^disputed_(at|by)$/,
  /^dispute_(resolved_at|deadline)$/,
  /^has_active_dispute$/,
  /^payout_/,
  /(^|_)completed_at$/,
  /^cancelled_(at|by)$/,
  /^cancellation_fee/,
  /^late_cancellation$/,
  /^stripe_/,
  /(^|_)fee(_amount|_percent)?$/,
  /_amount$/,
  /_percent$/,
  /^sales_tax_rate$/,
  /^budget$/,
  /^helper_id$/,
  /^customer_id$/,
];

type Seat = "helper" | "poster" | "offered";

/**
 * The guards. A column is covered for a seat when one of these functions is
 * attached to a jobs trigger, its newest body names the column, and it applies
 * to that seat. `seats` is a claim about the function, so each entry says why.
 */
const TRANSITION_GUARDS: { fn: string; seats: Seat[]; columns: string[]; why: string }[] = [
  {
    fn: "enforce_job_status_transition",
    seats: ["helper", "poster", "offered"],
    columns: ["status"],
    why: "the status matrix, for every non-admin caller",
  },
  {
    fn: "enforce_cancellation_requires_rpc",
    seats: ["helper", "poster", "offered"],
    columns: ["status", "cancelled_by", "cancelled_at", "late_cancellation", "cancellation_fee", "cancellation_fee_status"],
    why: "cancellation only through the cancel RPCs, for every non-admin caller",
  },
  {
    fn: "enforce_helper_completion_gates",
    seats: ["helper"],
    columns: ["helper_completed_at"],
    why: "proof photos + minimum work time before a Helpr can mark done",
  },
  {
    fn: "enforce_helper_jobs_column_whitelist",
    seats: ["helper"],
    columns: ["helper_id"],
    why: "a Helpr may only clear helper_id, never re-point it",
  },
  {
    fn: "enforce_poster_jobs_money_lock",
    seats: ["poster"],
    columns: ["customer_id"],
    why: "a poster may not reassign customer_id (explicit NEW.customer_id check)",
  },
  {
    fn: "stamp_job_completed_at",
    seats: ["helper", "poster", "offered"],
    columns: ["completed_at"],
    why: "a client's completed_at is overwritten with the database clock (or NULL); only a server write is honoured",
  },
  {
    fn: "enforce_dispute_markers_server_owned",
    seats: ["helper", "poster", "offered"],
    columns: ["status", "dispute_status", "disputed_at", "disputed_by", "dispute_resolved_at", "dispute_deadline"],
    why: "the dispute state machine is written only by the dispute RPCs / service / admin; the one direct client move is the Helpr's open -> helper_responded",
  },
];

function lockLists() {
  const fns = newestFunctions(FILES) as Map<string, Fn>;
  const get = (name: string) => {
    const f = fns.get(name);
    expect(f, `no migration defines public.${name}; the seat model below is blind`).toBeTruthy();
    return f!.body;
  };
  const list = (body: string, v: string, fn: string) => {
    const l = sqlArrayLiteral(body, v);
    expect(l, `${fn} no longer has a ${v} array — it was restructured; re-read it before trusting this test`).toBeTruthy();
    return l as string[];
  };
  const helperBody = get("enforce_helper_jobs_column_whitelist");
  const posterBody = get("enforce_poster_jobs_money_lock");
  const escBody = get("prevent_job_field_escalation");
  return {
    fns,
    helperAllowed: list(helperBody, "allowed", "enforce_helper_jobs_column_whitelist"),
    posterLocked: [
      ...list(posterBody, "locked_always", "enforce_poster_jobs_money_lock"),
      ...list(posterBody, "locked_when_funded", "enforce_poster_jobs_money_lock"),
      ...list(escBody, "locked_everyone", "prevent_job_field_escalation"),
    ],
    offeredLocked: [
      ...list(escBody, "poster_locked_always", "prevent_job_field_escalation"),
      ...list(escBody, "poster_locked_when_funded", "prevent_job_field_escalation"),
      ...list(escBody, "locked_everyone", "prevent_job_field_escalation"),
    ],
  };
}

/** (seat, column) pairs a client can write with no transition guard. */
export function unguardedStateWrites(
  files = FILES,
  guards = TRANSITION_GUARDS,
): string[] {
  const fns = newestFunctions(files) as Map<string, Fn>;
  const attached = new Set(jobsTriggers(files).values());
  const { helperAllowed, posterLocked, offeredLocked } = lockLists();
  const state = jobsColumns().filter((c) => STATE_COLUMN.some((re) => re.test(c)));
  const writable: Record<Seat, string[]> = {
    helper: state.filter((c) => helperAllowed.includes(c)),
    poster: state.filter((c) => !posterLocked.includes(c)),
    offered: state.filter((c) => !offeredLocked.includes(c)),
  };
  const out: string[] = [];
  for (const seat of Object.keys(writable) as Seat[]) {
    for (const col of writable[seat]) {
      const covered = guards.some((g) => {
        if (!g.seats.includes(seat) || !g.columns.includes(col)) return false;
        const f = fns.get(g.fn);
        if (!f || !attached.has(g.fn)) return false;
        return new RegExp(`\\bNEW\\.${col}\\b|'${col}'`).test(f.body);
      });
      if (!covered) out.push(`${seat}:${col}`);
    }
  }
  return out;
}

describe("jobs money / state-machine columns: every client-writable one has a transition guard", () => {
  it("the inventory is real (the parse saw the columns the bug was about)", () => {
    const cols = jobsColumns();
    for (const c of ["status", "payment_status", "dispute_status", "disputed_at", "disputed_by", "payout_scheduled_at"]) {
      expect(cols, `types.ts jobs.Row has no ${c}; the inventory parse is broken, not the schema`).toContain(c);
    }
    const { helperAllowed } = lockLists();
    expect(helperAllowed, "the Helpr allow-list parse lost `status`").toContain("status");
  });

  /**
   * KNOWN OPEN, and a RATCHET: the unguarded set must EQUAL this list. A new
   * unguarded pair fails; closing one of these fails too, until it is deleted
   * here. Each is tracked in docs/OPEN.md ("jobs state-column guard: known open
   * pairs"). None moves money to the writer; each is a poster/offered-seat
   * write that can stall or mislabel the Helpr's side.
   */
  const KNOWN_OPEN = [
    // Poster clears helper_completed_at on an in_progress escrow job:
    // auto-release-payment (poster_completed_at OR helper_completed_at <= cutoff)
    // never sees it, so the Helpr's 24h auto-release is defeated.
    "poster:helper_completed_at",
    // Offered Helpr (pending direct offer, job still open): no escrow release
    // reads it on an open job. Same column, same fix.
    "offered:helper_completed_at",
    // Written only by create-payment (service). A poster clearing it steers
    // auto-release-payment's undelivered-revision sweep (revision_completed_at IS NULL).
    "poster:revision_completed_at",
    "offered:revision_completed_at",
    // Checkout lock. Locked once set (locked_when_funded keys on it); a poster
    // can stamp it once on an unpaid job, which blocks their own checkout and delete.
    "poster:stripe_session_id",
  ].sort();

  it("no (seat, column) pair is writable without a guard (beyond the tracked ratchet)", () => {
    const open = unguardedStateWrites().sort();
    expect(
      open,
      `These money / state-machine columns can be written by a client seat with nothing constraining the value:\n  ${open.join("\n  ")}\n` +
        "Either lock the column for that seat, or add a BEFORE UPDATE trigger that only admits the legitimate " +
        "transitions and register it in TRANSITION_GUARDS with the seats it really applies to. If you CLOSED one, " +
        "delete it from KNOWN_OPEN (and tick its docs/OPEN.md line).",
    ).toEqual(KNOWN_OPEN);
  });

  it("can fail: the dispute guard's trigger dropped", () => {
    const dropped = [
      ...FILES,
      { name: "99999999999999_fake_drop.sql", sql: "DROP TRIGGER IF EXISTS trg_dispute_markers_server_owned ON public.jobs;" },
    ];
    const open = unguardedStateWrites(dropped);
    expect(open).toEqual(expect.arrayContaining(["helper:dispute_status", "poster:disputed_at", "poster:dispute_status"]));
  });

  it("can fail: the guard stops naming a column (a narrowed copy of the function)", () => {
    const fns = newestFunctions(FILES) as Map<string, Fn>;
    const g = fns.get("enforce_dispute_markers_server_owned");
    expect(g, "enforce_dispute_markers_server_owned is not defined by any migration").toBeTruthy();
    const narrowed = g!.body.replace(/\bNEW\.disputed_by\b/g, "NEW.updated_at").replace(/'disputed_by'/g, "'updated_at'");
    const broken = [
      ...FILES,
      { name: "99999999999999_fake_narrow.sql", sql: `CREATE OR REPLACE FUNCTION public.enforce_dispute_markers_server_owned() RETURNS trigger LANGUAGE plpgsql AS $function$${narrowed}$function$;` },
    ];
    expect(unguardedStateWrites(broken)).toEqual(expect.arrayContaining(["helper:disputed_by", "poster:disputed_by"]));
  });

  it("the guard trusts server paths by ROLE, and admits exactly one direct client move", () => {
    const g = (newestFunctions(FILES) as Map<string, Fn>).get("enforce_dispute_markers_server_owned")!;
    expect(g.secdef, "the guard must be SECURITY INVOKER: as a definer its current_user is always the owner and it trusts everyone").toBe(false);
    // Role gate: server roles pass, client roles are policed. Either arg order,
    // with or without the ::text cast the shipped guard uses.
    expect(g.body).toMatch(/current_user(?:::text)?\s+NOT\s+IN\s*\(\s*'(?:anon|authenticated)'\s*,\s*'(?:anon|authenticated)'\s*\)/i);
    // The one direct client move: the assigned Helpr answering an OPEN dispute.
    expect(g.body).toMatch(/NEW\.dispute_status\s*=\s*'helper_responded'/);
    expect(g.body).toMatch(/OLD\.dispute_status[\s\S]{0,20}=\s*'open'/); // e.g. COALESCE(OLD.dispute_status, 'open') = 'open'
    expect(g.body).toMatch(/(?:v_uid|auth\.uid\(\))\s*=\s*OLD\.helper_id/);
  });
});

/**
 * THE TRUST THE GUARD RESTS ON. It lets every statement through that does not
 * run as anon/authenticated. A client-callable SECURITY DEFINER function runs
 * as postgres, so if one wrote jobs from a column list or patch the CALLER
 * chose, that caller would be writing guarded columns as postgres.
 */
describe("no client-callable SECURITY DEFINER function writes jobs from caller-supplied columns", () => {
  const offenders = (fns: Map<string, Fn>) =>
    [...fns.values()]
      .filter((f) => f.secdef && f.clientCallable && !f.returnsTrigger)
      .map((f) => ({ name: f.name, file: f.file, reasons: dynamicJobsWriterReasons(f) }))
      .filter((o) => o.reasons.length > 0);

  it("none in the newest migration definitions", () => {
    const fns = newestFunctions(FILES) as Map<string, Fn>;
    const found = offenders(fns);
    expect(found, JSON.stringify(found, null, 2)).toEqual([]);
    // Sanity: the corpus parse saw the dispute RPCs as client-callable definers.
    for (const n of ["rpc_open_dispute", "rpc_escalate_dispute", "rpc_withdraw_dispute", "helper_abort_job"]) {
      const f = fns.get(n);
      expect(f?.secdef && f.clientCallable, `${n} should parse as a client-callable SECURITY DEFINER function`).toBe(true);
    }
  });

  it("can fail on each shape (fake functions)", () => {
    const fake = (name: string, args: string, body: string) => ({
      name: `99999999999999_${name}.sql`,
      sql: `CREATE OR REPLACE FUNCTION public.${name}(${args}) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$\n${body}\n$function$;\nGRANT EXECUTE ON FUNCTION public.${name}(${args.replace(/\s*\w+\s+(\w+(\[\])?)/g, "$1")}) TO authenticated;`,
    });
    const files = [
      ...FILES,
      fake("zz_fake_patch", "p_job_id uuid, p_patch jsonb", "BEGIN UPDATE public.jobs SET status = (p_patch->>'status')::job_status WHERE id = p_job_id; END"),
      fake("zz_fake_dynamic", "p_job_id uuid, p_col text, p_val text", "BEGIN EXECUTE format('UPDATE public.jobs SET %I = $1 WHERE id = $2', p_col) USING p_val, p_job_id; END"),
      fake("zz_fake_populate", "p_job_id uuid, p_row jsonb", "BEGIN UPDATE public.jobs j SET dispute_status = r.dispute_status FROM jsonb_populate_record(NULL::public.jobs, p_row) r WHERE j.id = p_job_id; END"),
    ];
    const names = offenders(newestFunctions(files) as Map<string, Fn>).map((o) => o.name).sort();
    expect(names).toEqual(["zz_fake_dynamic", "zz_fake_patch", "zz_fake_populate"]);
    // And a REVOKEd one is not client-callable, so it is not an offender.
    const revoked = [...files, { name: "99999999999999_zz_revoke.sql", sql: "REVOKE ALL ON FUNCTION public.zz_fake_patch(uuid, jsonb) FROM PUBLIC, anon, authenticated;" }];
    expect(offenders(newestFunctions(revoked) as Map<string, Fn>).map((o) => o.name)).not.toContain("zz_fake_patch");
    expect(parseArgs("a uuid, b jsonb DEFAULT NULL::jsonb")).toEqual([{ name: "a", type: "uuid" }, { name: "b", type: "jsonb" }]);
  });
});
