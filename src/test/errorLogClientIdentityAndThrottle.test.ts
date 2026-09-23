// @mutate supabase/migrations/20260923094457_error_logs_client_identity_and_throttle.sql | IF current_user = 'authenticated' THEN\n    NEW.user_id := auth.uid(); | IF current_user = 'authenticated' THEN\n    NULL;
// @mutate supabase/migrations/20260923094457_error_logs_client_identity_and_throttle.sql | NEW.created_at := now();\n\n  v_source | v_source
// @mutate supabase/migrations/20260923094457_error_logs_client_identity_and_throttle.sql | v_account_cap CONSTANT int := 60; | v_account_cap CONSTANT int := 6000;
// @mutate supabase/migrations/20260923094457_error_logs_client_identity_and_throttle.sql | IF v_n >= v_guest_cap THEN\n        RETURN NULL; | IF false THEN\n        RETURN NULL;
// @mutate supabase/migrations/20260923094457_error_logs_client_identity_and_throttle.sql | IF coalesce(NEW.tags ->> 'origin', '') <> 'client' THEN\n    RETURN NEW; | IF false THEN\n    RETURN NEW;
// @mutate supabase/migrations/20260923094457_error_logs_client_identity_and_throttle.sql | EXCEPTION WHEN OTHERS THEN\n    -- The logger must never break the app: on any failure, keep the row.\n    RETURN NEW; | EXCEPTION WHEN division_by_zero THEN\n    RETURN NEW;
// @mutate supabase/migrations/20260923094457_error_logs_client_identity_and_throttle.sql | CREATE TRIGGER trg_error_logs_01_throttle | CREATE TRIGGER trg_error_logs_000_throttle
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
 * (green; NEW_MIGRATION=skip-q106 -> 8 FAILED).
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
      // Prod 30-day peaks (2026-09-23): 20 rows/account/minute, 7 guest browser rows/minute.
      expect(acc).toBeGreaterThan(20);
      expect(acc).toBeLessThanOrEqual(100);
      expect(guest).toBeGreaterThan(7);
      expect(guest).toBeLessThanOrEqual(500);
      const counts = [...b.matchAll(/SELECT count\(\*\) INTO v_n FROM \((.*?)\) x; IF v_n >= (v_\w+) THEN RETURN NULL; END IF;/g)];
      expect(counts.length, `${f?.file}: expected a guest and an account count, each dropping the row`).toBe(2);
      const byCap = Object.fromEntries(counts.map((m) => [m[2], m[1]]));
      expect(byCap.v_guest_cap).toContain("e.user_id IS NULL");
      expect(byCap.v_account_cap).toContain("e.user_id = NEW.user_id");
      for (const [cap, c] of Object.entries(byCap)) {
        expect(c).toContain("e.created_at > now() - interval '1 minute'");
        expect(c).toContain("e.tags ->> 'origin' = 'client'");
        expect(c).toMatch(new RegExp(`LIMIT ${cap}$`));
      }
    });

    it("never raises: its own failures keep the row, and nothing in it can wait", () => {
      expect(b).toMatch(/EXCEPTION WHEN OTHERS THEN RETURN NEW; END;/);
      expect(b).not.toMatch(/\bRAISE\s+EXCEPTION\b/i);
      expect(b).not.toMatch(/\bFOR\s+(?:NO\s+KEY\s+)?(?:UPDATE|SHARE)\b|\bON\s+CONFLICT\b|pg_sleep|LOCK\s+TABLE/i);
    });
  });
});
