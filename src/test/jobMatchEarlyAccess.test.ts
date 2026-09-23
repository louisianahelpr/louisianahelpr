/**
 * Q225 (docs/OPEN.md): a job-match notification never beats the job into the
 * recipient's browse feed.
 *
 * THE BUG. Browse shows a new job to a member only once
 * created_at <= early_access_cutoff() (20 minutes for a free account, less
 * for a paid tier: the Early Access perk). The job-match producers ignored it:
 * at funding they told every matching member the title and budget by in-app
 * row, push and email, so the perk leaked to every free inbox.
 *
 * THE RULE (20260923185634): every job_match row is sent at
 * jobs.created_at + early_access_delay_minutes(recipient), or held until then.
 *   - deliver_job_match: the two trigger fan-outs send through it;
 *   - trg_notifications_zz_early_access_hold: BEFORE INSERT backstop on
 *     notifications, holding any direct job_match insert (instant-job-match);
 *   - release_job_match_holds, cron every minute, sends what is due.
 * Behaviour, on the real migration text applied 3x:
 * src/test/pglite/jobMatchEarlyAccess.pglite.mjs — ALL PASS (30);
 * NEW_MIGRATION=skip (the state before) -> 10 FAILED.
 *
 * THE CLASS, from the source: every SQL function whose NEWEST definition
 * INSERTs a 'job_match' notifications row, and every edge function that does.
 * Each SQL writer must be a delivery path (holds or releases on the window) or
 * be listed below with why it names no job; edge writers are held by the
 * backstop, which must stay a BEFORE INSERT trigger that fires after the
 * seed-boundary and job_id-fill triggers.
 */
// @mutate supabase/migrations/20260923185634_early_access_holds_job_match_notifications.sql |     IF v_release IS NOT NULL AND v_release > now() THEN\n      INSERT INTO public.job_match_holds | IF false THEN\n      INSERT INTO public.job_match_holds
// @mutate supabase/migrations/20260923185634_early_access_holds_job_match_notifications.sql |     IF v_release IS NULL OR v_release <= now() THEN\n      RETURN NEW; | IF true THEN\n      RETURN NEW;
// @mutate supabase/migrations/20260923185634_early_access_holds_job_match_notifications.sql |              WHEN p.subscription_tier = 'plus'  THEN 15\n             WHEN p.subscription_tier = 'pro'   THEN 10\n             WHEN p.subscription_tier = 'basic' THEN 5\n             ELSE 0\n           END\n    FROM public.profiles p\n    WHERE p.user_id = p_user_id | WHEN p.subscription_tier = 'plus'  THEN 20\n             WHEN p.subscription_tier = 'pro'   THEN 10\n             WHEN p.subscription_tier = 'basic' THEN 5\n             ELSE 0\n           END\n    FROM public.profiles p\n    WHERE p.user_id = p_user_id
// @mutate supabase/migrations/20260923185634_early_access_holds_job_match_notifications.sql |     PERFORM public.deliver_job_match(helper_record.helper_id, NEW.id, v_title, v_message, v_link, true); |     INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES (helper_record.helper_id, v_title, v_message, 'job_match', v_link, NEW.id);
// @mutate supabase/migrations/20260923185634_early_access_holds_job_match_notifications.sql | CREATE TRIGGER trg_notifications_zz_early_access_hold\n  BEFORE INSERT | CREATE TRIGGER trg_notifications_zz_early_access_hold\n  AFTER INSERT
// @mutate supabase/migrations/20260923185634_early_access_holds_job_match_notifications.sql |        AND j.created_at + make_interval(mins => public.early_access_delay_minutes(h.user_id)) <= now() |        AND true
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const FN_DIR = join(ROOT, "supabase", "functions");
const FIX = "20260923185634_early_access_holds_job_match_notifications.sql";

const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = new Map(files.map((f) => [f, blankSqlComments(readFileSync(join(MIG, f), "utf8"))]));

/** Every CREATE OR REPLACE FUNCTION public.<name> body, any dollar-quote tag. */
function definitions(sql: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  for (const m of sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)\s*\(/gi)) {
    const rest = sql.slice(m.index!);
    const open = /\bAS\s+(\$\w*\$)/i.exec(rest);
    if (!open) continue;
    const start = open.index + open[0].length;
    const end = rest.indexOf(open[1], start);
    if (end === -1) continue;
    out.push({ name: m[1], body: rest.slice(start, end) });
  }
  return out;
}

/** name -> NEWEST body (replay order: the one that is live). */
const live = new Map<string, string>();
for (const f of files) for (const d of definitions(sqlOf.get(f)!)) live.set(d.name, d.body);
const body = (name: string) => {
  const b = live.get(name);
  if (b === undefined) throw new Error(`no definition of public.${name} in supabase/migrations`);
  return b;
};
const ws = (s: string) => s.replace(/\s+/g, " ").trim();

const writesJobMatch = (b: string) =>
  /INSERT\s+INTO\s+(?:public\.)?notifications\s*\([^)]*\)\s*(?:VALUES|SELECT)[\s\S]{0,600}?'job_match'/i.test(b);

/** Hold or release on the recipient's window. */
const DELIVERY_PATHS = ["deliver_job_match", "release_job_match_holds"];
/** Writers that name no job, with why the window does not apply. */
const NAMES_NO_JOB: Record<string, string> = {
  sweep_daily_job_digest:
    "daily 'New jobs in <parish>' count and budget range, linking to /dashboard: no title, no job link (its young-job edge is Q299)",
};

/** The `SELECT CASE ... END` tier table of a function body, whitespace-normalised. */
const tierCase = (b: string) => {
  const m = /SELECT\s+CASE\b([\s\S]*?)\bEND\b/i.exec(b);
  if (!m) throw new Error("no SELECT CASE ... END tier table");
  return ws(m[1]);
};

describe("Q225: job-match notifications wait for the recipient's Early Access window", () => {
  it("reads the real tree (cannot pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain(FIX);
    expect(live.size).toBeGreaterThan(200);
  });

  it("the window is the browse window: same 20-minute base, same tier table as early_access_cutoff()", () => {
    const cutoff = body("early_access_cutoff");
    const delay = body("early_access_delay_minutes");
    expect(tierCase(delay)).toBe(tierCase(cutoff));
    expect(tierCase(delay)).toMatch(/WHEN p\.subscription_tier = 'elite' THEN 20/);
    expect(ws(cutoff)).toMatch(/now\(\) - make_interval\(mins => 20 - COALESCE\(/);
    expect(ws(delay)).toMatch(/^SELECT 20 - COALESCE\(/);
    expect(ws(delay)).toMatch(/WHERE p\.user_id = p_user_id \), 0\);?$/);
    expect(ws(body("job_match_release_at"))).toMatch(
      /j\.created_at \+ make_interval\(mins => public\.early_access_delay_minutes\(p_user_id\)\)/,
    );
  });

  it("every SQL writer of a job_match row is a delivery path or names no job (two-way)", () => {
    const writers = [...live.entries()].filter(([, b]) => writesJobMatch(b)).map(([n]) => n).sort();
    expect(writers.length).toBeGreaterThan(2);
    expect(writers).toEqual([...DELIVERY_PATHS, ...Object.keys(NAMES_NO_JOB)].sort());
    for (const n of Object.keys(NAMES_NO_JOB)) {
      const b = ws(body(n));
      expect(b, `${n} must not link a job`).not.toMatch(/job=|quickApply=|jobId=|\/jobs\//);
      expect(b, `${n} must not name a job title`).not.toMatch(/\b(?:j|nj|NEW)\.title\b/);
    }
  });

  it("deliver_job_match holds until job_match_release_at, and emails only when it sends", () => {
    const b = ws(body("deliver_job_match"));
    expect(b).toMatch(/v_release := public\.job_match_release_at\(p_job_id, p_user_id\); IF v_release IS NOT NULL AND v_release > now\(\) THEN INSERT INTO public\.job_match_holds .* RETURN false; END IF;/);
    const hold = b.indexOf("RETURN false;");
    expect(b.indexOf("INSERT INTO public.notifications")).toBeGreaterThan(hold);
    expect(b.indexOf("net.http_post")).toBeGreaterThan(hold);
  });

  it("the release sends only what is due for its recipient, and only for a job browse would still show", () => {
    const b = ws(body("release_job_match_holds"));
    expect(b).toMatch(/DELETE FROM public\.job_match_holds h USING public\.jobs j WHERE j\.id = h\.job_id AND j\.created_at \+ make_interval\(mins => public\.early_access_delay_minutes\(h\.user_id\)\) <= now\(\) RETURNING/);
    expect(b).toMatch(/CONTINUE WHEN r\.job_status <> 'open'/);
    expect(b).toMatch(/np\.job_matches IS FALSE/);
  });

  it("the backstop holds any direct job_match insert, BEFORE INSERT, after the seed boundary and job_id fill", () => {
    const b = ws(body("notifications_early_access_hold"));
    expect(b).toMatch(/IF NEW\.type IS DISTINCT FROM 'job_match' THEN RETURN NEW; END IF;/);
    expect(b).toMatch(/v_release := public\.job_match_release_at\(v_job, NEW\.user_id\); IF v_release IS NULL OR v_release <= now\(\) THEN RETURN NEW; END IF; INSERT INTO public\.job_match_holds .* RETURN NULL;/);
    const all = files.map((f) => sqlOf.get(f)!).join("\n");
    const triggers = [...all.matchAll(/CREATE\s+TRIGGER\s+(\w+)\s+(BEFORE|AFTER)\s+INSERT\s+ON\s+public\.notifications\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+(?:public\.)?(\w+)\(/gi)];
    const hold = triggers.filter((t) => t[3] === "notifications_early_access_hold").pop();
    expect(hold?.[2].toUpperCase()).toBe("BEFORE");
    // Postgres fires same-timing triggers in name order: seed-suppressed rows
    // are never held, and job_id is already filled from the link.
    for (const before of ["notifications_seed_boundary", "notifications_fill_job_id"]) {
      const t = triggers.filter((x) => x[3] === before).pop();
      expect(t, before).toBeTruthy();
      expect(t![1] < hold![1], `${t![1]} must sort before ${hold![1]}`).toBe(true);
    }
  });

  /** Edge job_match writers the backstop cannot hold (no job in the link), each a KNOWN gap with its queue item. */
  // @two-way src/test/jobMatchEarlyAccess.test.ts:stale edge known gap
  const EDGE_KNOWN_GAPS: Record<string, string> = {
    "daily-match-digest":
      "Q299: the daily digest links /dashboard and names its oldest queued job; a job queued minutes before the run can be named inside a free member's window",
  };

  it("every edge function that inserts a job_match row carries its job in the link (so the backstop can hold it)", () => {
    const writers: string[] = [];
    for (const name of readdirSync(FN_DIR)) {
      if (name.startsWith("_")) continue;
      let src: string;
      try {
        src = blankComments(readFileSync(join(FN_DIR, name, "index.ts"), "utf8"));
      } catch {
        continue; // not a function directory
      }
      if (!/from\(\s*["']notifications["']\s*\)\s*\.(?:insert|upsert)/.test(src) || !/type:\s*["']job_match["']/.test(src)) continue;
      writers.push(name);
      if (name in EDGE_KNOWN_GAPS) continue;
      const at = src.search(/type:\s*["']job_match["']/);
      expect(src.slice(at, at + 200), `${name}: job_match row must link its job`).toMatch(/link:\s*`[^`]*(?:quickApply|job)=\$\{job\.id\}/);
    }
    const stale = Object.keys(EDGE_KNOWN_GAPS).filter((n) => !writers.includes(n));
    expect(stale, "stale edge known gap: it no longer writes job_match rows — remove it").toEqual([]);
    expect(writers.sort()).toEqual(["instant-job-match", ...Object.keys(EDGE_KNOWN_GAPS)].sort());
  });

  it("the release runs every minute and is watched", () => {
    const fix = sqlOf.get(FIX)!;
    expect(fix).toMatch(/cron\.schedule\('release-job-match-holds', '\* \* \* \* \*',\s*'SELECT public\.release_job_match_holds\(\);'\)/);
    expect(fix).toMatch(/\('release-job-match-holds', interval '15 minutes',/);
  });

  it("no client can reach the window, the holds or the delivery functions", () => {
    const fix = ws(sqlOf.get(FIX)!);
    for (const sig of [
      "early_access_delay_minutes(uuid)", "job_match_release_at(uuid, uuid)",
      "deliver_job_match(uuid, uuid, text, text, text, boolean)", "notifications_early_access_hold()",
      "release_job_match_holds()",
    ]) expect(fix, sig).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
    expect(fix).toContain("REVOKE ALL ON public.job_match_holds FROM PUBLIC, anon, authenticated;");
    expect(fix).toContain("ALTER TABLE public.job_match_holds ENABLE ROW LEVEL SECURITY;");
  });
});
