// @mutate supabase/migrations/20260923094457_error_logs_client_identity_and_throttle.sql | IF current_user = 'authenticated' THEN\n    NEW.user_id := auth.uid(); | IF current_user = 'authenticated' THEN\n    NULL;
// @mutate supabase/migrations/20260923094457_error_logs_client_identity_and_throttle.sql | NEW.created_at := now();\n\n  v_source | v_source
// @mutate supabase/migrations/20260923100454_error_log_throttle_fingerprint_cap_and_drop_ledger.sql | v_account_cap  CONSTANT int := 60; | v_account_cap  CONSTANT int := 6000;
// @mutate supabase/migrations/20260923100454_error_log_throttle_fingerprint_cap_and_drop_ledger.sql | IF v_n >= v_guest_cap THEN\n        PERFORM | IF false THEN\n        PERFORM
// @mutate supabase/migrations/20260923100454_error_log_throttle_fingerprint_cap_and_drop_ledger.sql | IF coalesce(NEW.tags ->> 'origin', '') <> 'client' THEN\n    RETURN NEW; | IF false THEN\n    RETURN NEW;
// @mutate supabase/migrations/20260923100454_error_log_throttle_fingerprint_cap_and_drop_ledger.sql | EXCEPTION WHEN OTHERS THEN\n    -- The logger must never break the app: on any failure, keep the row.\n    RETURN NEW; | EXCEPTION WHEN division_by_zero THEN\n    RETURN NEW;
// @mutate supabase/migrations/20260923100454_error_log_throttle_fingerprint_cap_and_drop_ledger.sql | CREATE TRIGGER trg_error_logs_01_throttle | CREATE TRIGGER trg_error_logs_000_throttle
// @mutate supabase/migrations/20260923100454_error_log_throttle_fingerprint_cap_and_drop_ledger.sql | v_guest_cap    CONSTANT int := 300; | v_guest_cap    CONSTANT int := 120;
// @mutate supabase/migrations/20260923100454_error_log_throttle_fingerprint_cap_and_drop_ledger.sql | AND e.tags ->> 'guest_fp' = v_fp | AND true
// @mutate supabase/migrations/20260923100454_error_log_throttle_fingerprint_cap_and_drop_ledger.sql | NEW.tags := jsonb_set(NEW.tags, '{guest_fp}', to_jsonb(v_fp), true); | NULL;
// @mutate supabase/migrations/20260923100454_error_log_throttle_fingerprint_cap_and_drop_ledger.sql | PERFORM public.record_error_log_throttle_drop('guest');\n | 
// @mutate supabase/migrations/20260923105333_throttle_drops_kind_rename.sql | VALUES (date_trunc('minute', now()), pg_backend_pid(), p_kind | VALUES (date_trunc('minute', now()), 0, p_kind
// @mutate supabase/migrations/20260923100454_error_log_throttle_fingerprint_cap_and_drop_ledger.sql | ALTER TABLE public.error_log_throttle_drops ENABLE ROW LEVEL SECURITY; | 
// @mutate supabase/migrations/20260923215732_cron_http_untagged_close_rule.sql | ELSIF p_source = 'error-log-throttled' THEN | ELSIF p_source = 'error-log-throttled-x' THEN
// @mutate supabase/migrations/20260923215732_cron_http_untagged_close_rule.sql | IF v_min < p_since THEN RETURN NULL; END IF; | 
// @mutate supabase/migrations/20260923105333_throttle_drops_kind_rename.sql | jsonb_build_object('source', 'error-log-throttled', 'area', 'observability') | jsonb_build_object('source', 'error-log-throttle', 'area', 'observability')
// @mutate supabase/migrations/20260923100454_error_log_throttle_fingerprint_cap_and_drop_ledger.sql | PERFORM cron.schedule('error-log-throttle-check', '*/5 * * * *', | PERFORM cron.schedule('error-log-throttle-check', '0 3 * * *',
// @mutate supabase/migrations/20260923105333_throttle_drops_kind_rename.sql | ON CONFLICT (minute, backend_pid, drop_kind) | ON CONFLICT (minute, backend_pid, kind)
// @mutate supabase/migrations/20260923105333_throttle_drops_kind_rename.sql | GROUP BY d.drop_kind) k; | GROUP BY d.kind) k;
// @mutate supabase/migrations/20260923105333_throttle_drops_kind_rename.sql | CHECK (drop_kind IN ('guest', 'guest_fp', 'account')) | CHECK (drop_kind IN ('guest', 'guest_fp'))
// @mutate src/integrations/supabase/types.ts | backend_pid: number\n          drop_kind: string\n          dropped: number | backend_pid: number\n          kind: string\n          dropped: number
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Q106 + Q98 (docs/OPEN.md): the public.error_logs CLIENT insert path.
 *
 * Q106: a signed-in session must not be able to log a row as a guest
 *   (user_id NULL): that moved its error screens onto the guest repeat cap (20,
 *   not 5) and spent the shared guest budget. stamp_error_log_origin (BEFORE
 *   INSERT, sorts first) must set NEW.user_id := auth.uid() for role
 *   authenticated, on the client branch (after the server early return).
 * Q98: client-origin rows must be throttled per account / guest bucket per
 *   minute by a BEFORE INSERT trigger that runs AFTER the origin stamp, drops
 *   the row (RETURN NULL) rather than raising, swallows its own failures, and
 *   never touches server rows. The window reads created_at, so the stamp must
 *   also re-stamp a client's created_at.
 *
 * Reads the NEWEST definition across all migrations (any dollar-quote tag,
 * SQL comments stripped) and the latest CREATE/DROP of each error_logs
 * trigger. Behaviour: src/test/pglite/userErrorScreenRepeatCap.pglite.mjs
 * (green; NEW_MIGRATION=skip-q106 -> 8 FAILED; NEW_MIGRATION=skip-q113 -> 8
 * FAILED; MUTATE=no-stamp -> 6 FAILED, incl. the RLS other-uid case refused).
 *
 * Q113: one anonymous caller must not be able to fill the shared guest bucket
 *   (a per-fingerprint guest sub-cap under a raised global cap), and every drop
 *   must be counted (error_log_throttle_drops, bounded + never raising) and
 *   reach the ops ledger when sustained (check_error_log_throttle -> source
 *   'error-log-throttled' -> ops_alert_condition closes only on a clean minute).
 */

const MIG = join(__dirname, "..", "..", "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = new Map(files.map((f) => [f, readFileSync(join(MIG, f), "utf8")]));
const stripSqlComments = (s: string) => s.replace(/--[^\n]*/g, "");
const ws = (s: string) => s.replace(/\s+/g, " ").trim();

type Def = { file: string; header: string; body: string };
function newestFunction(name: string): Def | null {
  let found: Def | null = null;
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
  for (const file of files) {
    const sql = stripSqlComments(sqlOf.get(file)!);
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index!);
      const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
      if (!tag) continue;
      const open = tag.index! + tag[0].length;
      const close = rest.indexOf(tag[1], open);
      found = { file, header: ws(rest.slice(0, tag.index!)), body: ws(rest.slice(open, close)) };
    }
  }
  return found;
}

/** Latest state of each trigger ON public.error_logs: timing + function, or null if dropped. */
function errorLogTriggers(): Map<string, { timing: string; fn: string } | null> {
  const out = new Map<string, { timing: string; fn: string } | null>();
  const re = /(CREATE|DROP)\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?(\w+)\s+([\s\S]*?);/gi;
  for (const file of files) {
    for (const m of stripSqlComments(sqlOf.get(file)!).matchAll(re)) {
      const [, verb, name, rest] = m;
      if (!/\bON\s+(?:public\.)?error_logs\b/i.test(rest)) continue;
      if (verb.toUpperCase() === "DROP") {
        out.set(name, null);
        continue;
      }
      const timing = /\b(BEFORE|AFTER)\b/i.exec(rest)?.[1].toUpperCase() ?? "";
      const fn = /EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?(\w+)\s*\(/i.exec(rest)?.[1] ?? "";
      out.set(name, { timing, fn: fn.toLowerCase() });
    }
  }
  return out;
}

describe("error_logs client insert path (Q106, Q98)", () => {
  it("reads a real migration history", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  describe("Q106: stamp_error_log_origin pins a signed-in client's identity", () => {
    const f = newestFunction("stamp_error_log_origin");
    const b = f?.body ?? "";

    it("the newest definition exists and stays SECURITY INVOKER (it reads the real role)", () => {
      expect(f).not.toBeNull();
      expect(f!.header).not.toMatch(/SECURITY DEFINER/i);
      expect(f!.header).toMatch(/SET search_path = public, pg_temp/i);
    });

    it("stamps NEW.user_id := auth.uid() for role authenticated, after the server early return", () => {
      const serverReturn = b.indexOf("IF current_user NOT IN ('anon', 'authenticated') THEN");
      const stamp = b.search(/IF current_user = 'authenticated' THEN NEW\.user_id := auth\.uid\(\); END IF;/);
      expect(serverReturn, `${f?.file}: server early return missing`).toBeGreaterThan(-1);
      expect(stamp, `${f?.file}: a signed-in client can still insert user_id NULL (Q106)`).toBeGreaterThan(serverReturn);
      expect(stamp).toBeLessThan(b.lastIndexOf("RETURN NEW;"));
    });

    it("re-stamps created_at on a client row so the throttle window cannot be back-dated", () => {
      const serverReturn = b.indexOf("IF current_user NOT IN ('anon', 'authenticated') THEN");
      const at = b.indexOf("NEW.created_at := now();");
      expect(at, `${f?.file}: client created_at is not re-stamped`).toBeGreaterThan(serverReturn);
    });

    it("the stamp trigger still sorts first among BEFORE triggers", () => {
      const before = [...errorLogTriggers().entries()]
        .filter(([, t]) => t?.timing === "BEFORE")
        .map(([n, t]) => [n, t!.fn] as const)
        .sort(([a], [b2]) => (a < b2 ? -1 : 1));
      expect(before[0]).toEqual(["trg_error_logs_00_stamp_origin", "stamp_error_log_origin"]);
    });
  });

  describe("Q98: client-origin rows are throttled, server rows never", () => {
    const f = newestFunction("throttle_client_error_log");
    const b = f?.body ?? "";

    it("runs as a BEFORE INSERT trigger that fires AFTER the origin stamp", () => {
      const trg = [...errorLogTriggers().entries()].filter(([, t]) => t?.fn === "throttle_client_error_log");
      expect(trg.length, "no live trigger runs throttle_client_error_log").toBe(1);
      const [name, t] = trg[0];
      expect(t!.timing).toBe("BEFORE");
      expect(name > "trg_error_logs_00_stamp_origin", `${name} must sort after the origin stamp`).toBe(true);
    });

    it("is SECURITY DEFINER with a pinned search_path and no client EXECUTE", () => {
      expect(f).not.toBeNull();
      expect(f!.header).toMatch(/SECURITY DEFINER/i);
      expect(f!.header).toMatch(/SET search_path = public, pg_temp/i);
      const sql = stripSqlComments(sqlOf.get(f!.file)!);
      expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.throttle_client_error_log\(\) FROM PUBLIC, anon, authenticated;/);
    });

    it("lets every non-client row through first", () => {
      expect(b.indexOf("IF coalesce(NEW.tags ->> 'origin', '') <> 'client' THEN RETURN NEW; END IF;")).toBeGreaterThan(-1);
      expect(b.indexOf("IF coalesce(NEW.tags ->> 'origin', '') <> 'client' THEN")).toBeLessThan(b.indexOf("SELECT count(*)"));
    });

    it("caps per account and for guests, from the measured peaks, with bounded counts over one minute", () => {
      const acc = Number(b.match(/v_account_cap CONSTANT int := (\d+);/)?.[1]);
      const guest = Number(b.match(/v_guest_cap CONSTANT int := (\d+);/)?.[1]);
      const fp = Number(b.match(/v_guest_fp_cap CONSTANT int := (\d+);/)?.[1]);
      // Prod 30-day peaks (2026-09-23): 20 rows/account/minute; guests 7 rows/minute
      // all together and 6 of ONE fingerprint (Q113 measurement).
      expect(acc).toBeGreaterThan(20);
      expect(acc).toBeLessThanOrEqual(100);
      expect(guest, "Q113: the shared guest bucket was raised from 120").toBeGreaterThan(120);
      expect(guest).toBeLessThanOrEqual(500);
      expect(fp, "Q113: per-fingerprint guest cap").toBeGreaterThan(6);
      expect(fp * 10, "Q113: one fingerprint must be a small slice of the guest bucket").toBeLessThanOrEqual(guest);
      const counts = [...b.matchAll(/SELECT count\(\*\) INTO v_n FROM \((.*?)\) x; IF v_n >= (v_\w+) THEN PERFORM public\.record_error_log_throttle_drop\('(\w+)'\); RETURN NULL; END IF;/g)];
      expect(counts.length, `${f?.file}: expected fingerprint, guest and account counts, each counting then dropping the row`).toBe(3);
      const byCap = Object.fromEntries(counts.map((m) => [m[2], m[1]]));
      const kindOf = Object.fromEntries(counts.map((m) => [m[2], m[3]]));
      expect(kindOf).toEqual({ v_guest_fp_cap: "guest_fp", v_guest_cap: "guest", v_account_cap: "account" });
      expect(byCap.v_guest_fp_cap).toContain("e.user_id IS NULL");
      expect(byCap.v_guest_fp_cap).toContain("e.tags ->> 'guest_fp' = v_fp");
      expect(byCap.v_guest_cap).toContain("e.user_id IS NULL");
      expect(byCap.v_account_cap).toContain("e.user_id = NEW.user_id");
      for (const [cap, c] of Object.entries(byCap)) {
        expect(c).toContain("e.created_at > now() - interval '1 minute'");
        expect(c).toContain("e.tags ->> 'origin' = 'client'");
        expect(c).toMatch(new RegExp(`LIMIT ${cap}$`));
      }
    });

    it("Q113: every dropped row is counted first (no silent RETURN NULL)", () => {
      const nulls = [...b.matchAll(/RETURN NULL;/g)].length;
      const counted = [...b.matchAll(/PERFORM public\.record_error_log_throttle_drop\('\w+'\); RETURN NULL;/g)].length;
      expect(nulls).toBeGreaterThanOrEqual(3);
      expect(counted, `${f?.file}: a RETURN NULL with no drop count`).toBe(nulls);
    });

    it("Q113: the guest fingerprint is normalised message + url path, stamped on the row before counting", () => {
      const at = b.indexOf("v_fp := md5(");
      expect(at, `${f?.file}: no guest fingerprint`).toBeGreaterThan(-1);
      const def = b.slice(at, b.indexOf(";", at));
      expect(def).toMatch(/public\.ops_alert_normalise\(left\(coalesce\(NEW\.message/);
      expect(def).toMatch(/public\.ops_alert_normalise\( substring\(coalesce\(NEW\.url/);
      const stamp = b.indexOf("NEW.tags := jsonb_set(NEW.tags, '{guest_fp}', to_jsonb(v_fp), true);");
      expect(stamp, "tags.guest_fp is not overwritten from the server-side fingerprint").toBeGreaterThan(at);
      expect(stamp).toBeLessThan(b.indexOf("SELECT count(*)"));
      expect(b.indexOf("LIMIT v_guest_fp_cap"), "fingerprint cap is checked before the shared bucket").toBeLessThan(b.indexOf("LIMIT v_guest_cap"));
    });

    it("never raises: its own failures keep the row, and nothing in it can wait", () => {
      expect(b).toMatch(/EXCEPTION WHEN OTHERS THEN RETURN NEW; END;/);
      expect(b).not.toMatch(/\bRAISE\s+EXCEPTION\b/i);
      expect(b).not.toMatch(/\bFOR\s+(?:NO\s+KEY\s+)?(?:UPDATE|SHARE)\b|\bON\s+CONFLICT\b|pg_sleep|LOCK\s+TABLE/i);
    });
  });

  describe("Q113: drops are counted, bounded, and reach the ledger when sustained", () => {
    const rec = newestFunction("record_error_log_throttle_drop");
    const chk = newestFunction("check_error_log_throttle");
    const cond = newestFunction("ops_alert_condition");

    it("record_error_log_throttle_drop: definer, pinned path, one row per minute x backend x kind, bounded, never raises", () => {
      expect(rec, "record_error_log_throttle_drop is not defined").not.toBeNull();
      expect(rec!.header).toMatch(/SECURITY DEFINER/i);
      expect(rec!.header).toMatch(/SET search_path = public, pg_temp/i);
      const r = rec!.body;
      expect(r).toMatch(/ON CONFLICT \(minute, backend_pid, drop_kind\) DO UPDATE SET dropped = d\.dropped \+ 1/);
      // Q122: the column is drop_kind (a bare `kind` column made every `{ kind: ... }` test literal a row of this table).
      expect(r).toMatch(/INSERT INTO public\.error_log_throttle_drops AS d \(minute, backend_pid, drop_kind, dropped, first_at, last_at\)/);
      expect(r).toMatch(/VALUES \(date_trunc\('minute', now\(\)\), pg_backend_pid\(\), p_kind/);
      expect(r).toMatch(/set_config\('lock_timeout', '\d+ms', true\)/);
      expect(r).toMatch(/EXCEPTION WHEN lock_not_available OR deadlock_detected THEN NULL; WHEN OTHERS THEN NULL; END;/);
      expect(r).not.toMatch(/\bRAISE\s+EXCEPTION\b/i);
      const sql = stripSqlComments(sqlOf.get(rec!.file)!);
      expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.record_error_log_throttle_drop\(text\) FROM PUBLIC, anon, authenticated;/);
    });

    it("error_log_throttle_drops is server-only: RLS on, no client grants", () => {
      const file = files.filter((f) => /CREATE TABLE IF NOT EXISTS public\.error_log_throttle_drops/.test(sqlOf.get(f)!)).pop();
      expect(file, "no migration creates error_log_throttle_drops").toBeDefined();
      const sql = stripSqlComments(sqlOf.get(file!)!);
      expect(sql).toMatch(/ALTER TABLE public\.error_log_throttle_drops ENABLE ROW LEVEL SECURITY;/);
      expect(sql).toMatch(/REVOKE ALL ON TABLE public\.error_log_throttle_drops FROM PUBLIC, anon, authenticated;/);
      expect(sql).not.toMatch(/GRANT [^;]*ON TABLE public\.error_log_throttle_drops TO [^;]*\b(anon|authenticated)\b/);
    });

    it("Q122: the drop column is drop_kind, renamed replay-safely, CHECK on the new name", () => {
      // A column named `kind` on this table made every `{ kind: ... }` literal in the test tree a row of it
      // (fixtureSchemaContract's distinctiveColumns): 40 false findings measured 2026-09-23 at 0ff197995, Vitest red on main.
      const file = files.filter((f) => /RENAME COLUMN kind TO drop_kind/.test(stripSqlComments(sqlOf.get(f)!))).pop();
      expect(file, "no migration renames error_log_throttle_drops.kind to drop_kind").toBeDefined();
      const sql = ws(stripSqlComments(sqlOf.get(file!)!));
      expect(sql).toMatch(/column_name = 'kind'\) AND NOT EXISTS \(SELECT 1 FROM information_schema\.columns WHERE table_schema = 'public' AND table_name = 'error_log_throttle_drops' AND column_name = 'drop_kind'\) THEN ALTER TABLE public\.error_log_throttle_drops RENAME COLUMN kind TO drop_kind;/);
      expect(sql).toMatch(/ADD CONSTRAINT error_log_throttle_drops_drop_kind_check CHECK \(drop_kind IN \('guest', 'guest_fp', 'account'\)\);/);
      const types = readFileSync(join(process.cwd(), "src/integrations/supabase/types.ts"), "utf8");
      const block = types.slice(types.indexOf("      error_log_throttle_drops: {"), types.indexOf("Relationships", types.indexOf("      error_log_throttle_drops: {")));
      expect(block).toMatch(/\n {10}drop_kind: string\n/);
      expect(block).not.toMatch(/\n {10}kind\??:/);
    });

    it("check_error_log_throttle raises 'error-log-throttled' on drops in >= 2 of the last 10 complete minutes, at most every 15 min", () => {
      expect(chk, "check_error_log_throttle is not defined").not.toBeNull();
      const c = chk!.body;
      expect(c).toMatch(/v_min_minutes CONSTANT int := 2;/);
      expect(c).toMatch(/v_lookback CONSTANT int := 10;/);
      expect(c).toMatch(/d\.minute < v_now_min/);
      expect(c).toMatch(/IF v_minutes >= v_min_minutes AND NOT EXISTS \(/);
      expect(c).toMatch(/e\.created_at > now\(\) - interval '15 minutes'/);
      expect(c).toMatch(/jsonb_build_object\('source', 'error-log-throttled', 'area', 'observability'\)/);
      // Q122: grouped by the renamed column; a stale `kind` here fails at runtime, every 5 minutes, in cron.
      expect(c).toMatch(/SELECT d\.drop_kind, sum\(d\.dropped\) n FROM public\.error_log_throttle_drops d/);
      expect(c).toMatch(/GROUP BY d\.drop_kind\) k;/);
      expect(c).not.toMatch(/\bd\.kind\b/);
      let schedule: string | null = null;
      let expectation = false;
      for (const file of files) {
        const sql = stripSqlComments(sqlOf.get(file)!);
        for (const m of sql.matchAll(/cron\.(schedule|unschedule)\s*\(\s*'error-log-throttle-check'(?:\s*,\s*'([^']+)')?/g)) {
          schedule = m[1] === "schedule" ? m[2] : null;
        }
        if (/cron_work_expectations[\s\S]*?'error-log-throttle-check'/.test(sql)) expectation = true;
      }
      expect(schedule).toBe("*/5 * * * *");
      expect(expectation).toBe(true);
    });

    it("ops_alert_condition('error-log-throttled') closes only on an observed clean minute after the last occurrence", () => {
      expect(cond).not.toBeNull();
      const at = cond!.body.indexOf("p_source = 'error-log-throttled'");
      expect(at, `ops_alert_condition (${cond?.file}) has no 'error-log-throttled' branch`).toBeGreaterThan(-1);
      const branch = cond!.body.slice(at, cond!.body.indexOf("ELSIF", at + 10));
      expect(branch).toMatch(/v_min := date_trunc\('minute', now\(\)\) - interval '1 minute';/);
      expect(branch).toMatch(/IF v_min < p_since THEN RETURN NULL; END IF;/);
      expect(branch).toMatch(/RETURN EXISTS \(SELECT 1 FROM public\.error_log_throttle_drops d WHERE d\.minute = v_min\);/);
    });
  });
});
