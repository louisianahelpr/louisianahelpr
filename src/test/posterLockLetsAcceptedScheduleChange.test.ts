/**
 * A booked job's date / time change the Helpr asked for can be ACCEPTED by the
 * poster (owner decision Q407 (8)), while the Q423 poster lock
 * (20260925231810) still refuses every other poster write of the schedule.
 *
 * The collision (review 2026-09-25): respond_job_schedule_change's UPDATE runs
 * with auth.uid() = the accepting poster, and enforce_poster_jobs_money_lock's
 * locked_when_booked raised 42501, so every poster-accepted change failed.
 * 20260925233954 lets date_needed / start_time through locked_when_booked only
 * under the transaction-local app.schedule_change_rpc flag.
 *
 * Pinned here, on the definitions the database holds (effectiveDefs):
 *   - the carve-out sits inside the locked_when_booked loop only;
 *   - the flag's only setter is respond_job_schedule_change, which sets it
 *     after its party / expiry checks and resets it right after its UPDATE;
 *   - no function passes a caller-chosen name to set_config, so no client
 *     request can raise the flag itself (PostgREST exposes only public
 *     functions and runs one statement per request).
 * Executable proof: src/test/pglite/jobScheduleChange.pglite.mjs (231810 alone
 * RED; with the carve-out the poster's accept lands, a bare PATCH and a flag
 * set in an earlier statement are refused by the poster lock itself) and
 * src/test/pglite/posterFeeInputsLocked.pglite.mjs with NEW_MIGRATION_FILE =
 * 231810 + 233954 (every Q423 case still holds).
 *
 * @mutate supabase/migrations/20260925233954_poster_lock_lets_accepted_schedule_change.sql |         IF current_setting('app.schedule_change_rpc', true) = '1' THEN\n          CONTINUE;\n        END IF;\n        RAISE EXCEPTION |         RAISE EXCEPTION
 * @mutate supabase/migrations/20260925165200_job_schedule_change_requests.sql |     PERFORM set_config('app.schedule_change_rpc', '0', true);\n    v_status := 'accepted'; |     v_status := 'accepted';
 * @mutate supabase/migrations/20260925233954_poster_lock_lets_accepted_schedule_change.sql |   IF public.is_server_context()\n     OR auth.uid() IS DISTINCT FROM OLD.customer_id THEN | IF public.is_server_context() OR current_setting('app.schedule_change_rpc', true) = '1'\n     OR auth.uid() IS DISTINCT FROM OLD.customer_id THEN
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const body = (n: string) => blankSqlComments(DEFS.get(n)?.stmt ?? "");
const FLAG_ON = /set_config\('app\.schedule_change_rpc',\s*'1',\s*true\)/;

describe("the poster lock lets an accepted schedule change through, and nothing else (Q407 8 x Q423)", () => {
  it("the carve-out is inside locked_when_booked only", () => {
    const lock = body("enforce_poster_jobs_money_lock");
    expect(DEFS.get("enforce_poster_jobs_money_lock")?.file).toBe("20260925233954_poster_lock_lets_accepted_schedule_change.sql");
    const booked = lock.indexOf("IF changed_col = ANY (locked_when_booked) THEN");
    expect(booked).toBeGreaterThan(-1);
    const flags = [...lock.matchAll(/current_setting\('app\.schedule_change_rpc', true\) = '1'/g)].map((m) => m.index!);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toBeGreaterThan(booked);
    expect(lock.slice(flags[0], flags[0] + 80)).toMatch(/THEN\s+CONTINUE;/);
    // locked_always and locked_when_funded never see the flag.
    expect(lock.slice(0, booked)).not.toMatch(/schedule_change_rpc/);
  });

  it("only respond_job_schedule_change raises the flag, after its checks, and lowers it after its one UPDATE", () => {
    const setters = [...DEFS.entries()].filter(([, d]) => FLAG_ON.test(blankSqlComments(d.stmt))).map(([n]) => n);
    expect(setters).toEqual(["respond_job_schedule_change"]);
    const rpc = body("respond_job_schedule_change");
    const on = rpc.search(FLAG_ON);
    expect(rpc.indexOf("RAISE EXCEPTION 'not_authorized'")).toBeLessThan(on);
    expect(rpc.indexOf("IF v_req.status <> 'pending' THEN")).toBeLessThan(on);
    const upd = rpc.indexOf("UPDATE public.jobs", on);
    const off = rpc.indexOf("set_config('app.schedule_change_rpc', '0', true)", on);
    expect(upd).toBeGreaterThan(on);
    expect(off).toBeGreaterThan(upd);
    expect(rpc.slice(upd, off)).not.toMatch(/UPDATE public\.jobs[\s\S]*UPDATE public\.jobs/);
  });

  it("no function hands a caller-chosen setting name to set_config", () => {
    expect(DEFS.size).toBeGreaterThan(300);
    const dynamic = [...DEFS.entries()]
      .filter(([, d]) => /set_config\s*\(\s*[^'\s]/i.test(blankSqlComments(d.stmt)))
      .map(([n]) => n);
    expect(dynamic).toEqual([]);
  });
});
