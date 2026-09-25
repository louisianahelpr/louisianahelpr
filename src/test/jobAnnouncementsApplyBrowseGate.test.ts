/**
 * Q392 — THE CLASS: a notification that announces a job to someone who is not
 * a party to it (type 'job_match') reaches only a user the job is visible to
 * on the browse feed, at the moment they could see it there.
 *
 * The browse feed is open_jobs_browse. For a stranger its WHERE is: open, a
 * living poster (customer_id IS NOT NULL), funded, no live direct offer, the
 * early-access clock (created_at <= early_access_cutoff()), not a hidden
 * fixture, and not above the viewer's credential tier. instant-job-match sent
 * "Match for you" with title and budget at funding, ignoring the clock and the
 * credential gate, and could be re-triggered to the same users; the parish
 * fan-out ignored the clock; the daily parish digest counted unfunded,
 * ownerless, offered and not-yet-visible jobs.
 *
 * This file derives every producer from the source tree and asserts each one
 * applies every piece of the gate and the clock:
 *   - SQL: every live function body that INSERTs a 'job_match' notification.
 *     A piece is met by calling public.job_announceable_to() (the gate, once;
 *     asserted below to hold every piece of the view's WHERE) or by spelling it
 *     out. The clock is early_access_visible_at() compared with now().
 *   - Edge functions: every file that names the type or the queue RPC is
 *     classified, exactly (two-way). A producer must reach the database's gate.
 *   - The view itself: its WHERE has exactly the seven conjuncts mirrored here,
 *     so a gate added to the feed later fails this file until every
 *     announcement applies it too.
 *
 * Behaviour is proven in PGlite: src/test/pglite/jobMatchesWaitForEarlyAccess.pglite.mjs
 * (RED on the previous definitions with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20260925231704_job_matches_wait_for_early_access.sql |       AND public.job_announceable_to(NEW, c.user_id)\n |
 * @mutate supabase/migrations/20260925231704_job_matches_wait_for_early_access.sql |     IF v_visible_at > now() THEN | IF false THEN
 * @mutate supabase/migrations/20260925231704_job_matches_wait_for_early_access.sql |   IF v_reason IS NULL AND public.early_access_visible_at(r.user_id, v_job.created_at) > now() THEN | IF false THEN
 * @mutate supabase/migrations/20260925231704_job_matches_wait_for_early_access.sql |         AND public.early_access_visible_at(p.user_id, nj.created_at) <= now()\n |
 * @mutate supabase/migrations/20260925231704_job_matches_wait_for_early_access.sql |     AND p_job.customer_id IS NOT NULL\n |
 * @mutate supabase/migrations/20260925231704_job_matches_wait_for_early_access.sql |         OR COALESCE(public.get_user_credential_tier(p_user_id), 0) >= p_job.credential_tier), | OR true),
 * @mutate supabase/functions/instant-job-match/index.ts | supabase.rpc("enqueue_instant_job_match", { | supabase.rpc("enqueue_instant_job_match_v0", {
 * @mutate supabase/functions/daily-match-digest/index.ts | supabase.rpc("job_match_digest_rows", { p_queue_ids: allIds }) | supabase.rpc("job_match_digest_rows_v0", { p_queue_ids: allIds })
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const MIG = join(ROOT, "supabase/migrations");
const FN = join(ROOT, "supabase/functions");
const ws = (s: string) => s.replace(/\s+/g, " ");

const migrations = readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ file: f, sql: blankSqlComments(readFileSync(join(MIG, f), "utf8")) }));

/** name -> newest body over every migration, any dollar-quote tag. A later DROP with no redefinition removes it. */
function newestBodies(): Map<string, { file: string; body: string }> {
  const out = new Map<string, { file: string; body: string }>();
  const def = /CREATE (?:OR REPLACE )?FUNCTION public\.([a-z0-9_]+)\s*\([\s\S]*?\bAS\s+\$([A-Za-z_]*)\$([\s\S]*?)\$\2\$/gi;
  const drop = /DROP FUNCTION (?:IF EXISTS )?public\.([a-z0-9_]+)\s*(?:\(|;|\s)/gi;
  for (const { file, sql } of migrations) {
    const defined = new Set<string>();
    for (const m of sql.matchAll(def)) {
      out.set(m[1].toLowerCase(), { file, body: m[3] });
      defined.add(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(drop)) if (!defined.has(m[1].toLowerCase())) out.delete(m[1].toLowerCase());
  }
  return out;
}
const bodies = newestBodies();
const body = (name: string) => {
  const b = bodies.get(name);
  expect(b, `no migration defines public.${name}`).toBeTruthy();
  return ws(b!.body);
};

/** A notifications INSERT whose row is type 'job_match' (VALUES or SELECT form). */
const writesJobMatch = (b: string) =>
  /INSERT\s+INTO\s+public\.notifications\s*\([^)]*\)\s*(?:VALUES|SELECT)[\s\S]{0,600}?'job_match'/i.test(b);

// ── The gate's pieces, each as it is spelled when a producer writes it out ──
const PIECES: Record<string, RegExp> = {
  open: /status\s*<>\s*'open'|status\s*=\s*'open'/,
  ownerless: /customer_id IS (?:NOT )?NULL/,
  funded: /payment_status[^;]{0,80}ARRAY\['escrow'::text, 'payout_pending'::text, 'released'::text\]/,
  offer: /offered_to_helper_id IS (?:NOT )?NULL[^;]{0,160}'declined', 'expired'/,
  fixture: /is_seed[^;]{0,60}seed_jobs_hidden_publicly\(\)/,
  credential: /credential_tier[^;]{0,200}get_user_credential_tier\(/,
};
const GATE_CALL = /public\.job_announceable_to\(/;
/** The clock: early_access_visible_at() compared with now(), either way round. */
const CLOCK = /early_access_visible_at\([^;]*?(?:>|<=)\s*now\(\)|v_visible_at\s*>\s*now\(\)/;

/**
 * Every live SQL producer of a 'job_match' notification, and why it is gated.
 * Derived from the migrations; this list is compared against that, both ways.
 */
const SQL_PRODUCERS: Record<string, string> = {
  deliver_job_match: "job_match_queue's one send path (instant matches + the parish fan-out's waiting users)",
  deliver_saved_search_alert: "saved-search alerts (Q225, V-008): spells the gate out",
  notify_helpers_on_job_post: "parish fan-out: sends inline only to users the job is already visible to, queues the rest",
  sweep_daily_job_digest: "daily parish digest: counts only jobs the recipient can already see",
};

/**
 * Every edge-function file that names the job_match type or the queue RPC.
 * EXACT (two-way): derived from supabase/functions, compared both ways.
 */
const EDGE_MENTIONS: Record<string, "producer" | "not-a-producer"> = {
  "supabase/functions/instant-job-match/index.ts": "producer",
  "supabase/functions/daily-match-digest/index.ts": "producer",
  // Preference / type maps and the mailer for a row that already exists.
  "supabase/functions/_shared/notificationLog.ts": "not-a-producer",
  "supabase/functions/send-notification-email/index.ts": "not-a-producer",
  // ALLOWED_TYPES for an admin's free text; no template emits job_match (asserted).
  "supabase/functions/create-notification/index.ts": "not-a-producer",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|mts|js|mjs)$/.test(e) && !/\.test\./.test(e)) out.push(p);
  }
  return out;
}
const edgeFiles = walk(FN).map((f) => ({ rel: relative(ROOT, f), code: blankComments(readFileSync(f, "utf8")) }));
const edgeCode = (rel: string) => ws(edgeFiles.find((f) => f.rel === rel)!.code);

/** Top-level AND conjuncts of a WHERE clause (parentheses respected). */
function conjuncts(where: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < where.length; i++) {
    const c = where[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && /^ AND /i.test(where.slice(i, i + 5))) {
      out.push(where.slice(start, i).trim());
      start = i + 5;
    }
  }
  out.push(where.slice(start).trim());
  return out;
}

describe("Q392: every job announcement applies the browse gate and the early-access clock", () => {
  it("reads the whole history (the scan itself can fail)", () => {
    expect(migrations.length).toBeGreaterThan(500);
    expect(bodies.size).toBeGreaterThan(300);
    expect(edgeFiles.length).toBeGreaterThan(100);
  });

  it("the SQL producers of 'job_match' are exactly the classified set", () => {
    const live = [...bodies].filter(([, b]) => writesJobMatch(b.body)).map(([n]) => n).sort();
    expect(live).toEqual(Object.keys(SQL_PRODUCERS).sort());
  });

  for (const fn of Object.keys(SQL_PRODUCERS)) {
    it(`${fn} applies every piece of the gate, and the clock`, () => {
      const b = body(fn);
      if (!GATE_CALL.test(b)) {
        const missing = Object.entries(PIECES).filter(([, re]) => !re.test(b)).map(([k]) => k);
        expect(missing, `${fn} neither calls job_announceable_to() nor spells out these pieces`).toEqual([]);
      }
      expect(b, `${fn} announces a job without asking early_access_visible_at() against now()`).toMatch(CLOCK);
    });
  }

  it("job_announceable_to holds every piece, fails closed, and is not client-callable", () => {
    const b = body("job_announceable_to");
    const missing = Object.entries(PIECES).filter(([, re]) => !re.test(b)).map(([k]) => k);
    expect(missing).toEqual([]);
    expect(b).toContain("p_job.customer_id <> p_user_id");
    expect(b).toMatch(/^ ?SELECT COALESCE\(/);
    expect(b).toMatch(/, false\); ?$/);
    const all = migrations.map((m) => m.sql).join("\n");
    expect(all).toContain("REVOKE ALL ON FUNCTION public.job_announceable_to(public.jobs, uuid) FROM PUBLIC, anon, authenticated;");
    expect(all).not.toMatch(/GRANT [^;]*public\.job_announceable_to\b[^;]*\b(?:anon|authenticated)\b/i);
  });

  it("open_jobs_browse's WHERE is exactly the seven conjuncts the gate mirrors", () => {
    const view = migrations.filter((m) => /CREATE (?:OR REPLACE )?VIEW public\.open_jobs_browse\b/.test(m.sql)).pop();
    expect(view, "no migration creates open_jobs_browse").toBeTruthy();
    const def = ws(view!.sql.slice(view!.sql.search(/CREATE (?:OR REPLACE )?VIEW public\.open_jobs_browse\b/)));
    const stmt = def.slice(0, def.indexOf(";"));
    // The view's own WHERE: the one at parenthesis depth 0 (the select list
    // has correlated subqueries with WHEREs of their own).
    let depth = 0;
    let at = -1;
    for (let i = 0; i < stmt.length; i++) {
      if (stmt[i] === "(") depth++;
      else if (stmt[i] === ")") depth--;
      else if (depth === 0 && stmt.startsWith(" WHERE ", i)) at = i;
    }
    expect(at, "no top-level WHERE in open_jobs_browse").toBeGreaterThan(0);
    const where = stmt.slice(at + 7);
    const parts = conjuncts(where);
    const MIRRORED: Array<[string, RegExp]> = [
      ["open", /^status = 'open'::job_status$/],
      ["ownerless", /^customer_id IS NOT NULL$/],
      ["funded", /payment_status = ANY \(ARRAY\['escrow'::text, 'payout_pending'::text, 'released'::text\]\)/],
      ["offer", /offered_to_helper_id IS NULL OR \(direct_offer_status = ANY \(ARRAY\['declined'::text, 'expired'::text\]\)\)/],
      ["clock", /created_at <= early_access_cutoff\(\)/],
      ["fixture", /NOT is_seed OR NOT seed_jobs_hidden_publicly\(\)/],
      ["credential", /COALESCE\(credential_tier, 0\) = 0 OR .*my_credential_tier\(\)/],
    ];
    const unmatched = parts.filter((p) => !MIRRORED.some(([, re]) => re.test(p)));
    expect(unmatched, "open_jobs_browse gained a gate: add it to job_announceable_to and PIECES").toEqual([]);
    expect(parts).toHaveLength(MIRRORED.length);
  });

  it("every edge file naming job_match or the queue RPC is classified, exactly (two-way)", () => {
    const mention = /["']job_match["']|\bjob_match\s*:|["']enqueue_instant_job_match["']|["']job_match_digest_rows["']/;
    const found = edgeFiles.filter((f) => mention.test(f.code)).map((f) => f.rel).sort();
    expect(found).toEqual(Object.keys(EDGE_MENTIONS).sort());
  });

  it("instant-job-match writes no notification itself: it hands its matches to the database's gate", () => {
    const src = edgeCode("supabase/functions/instant-job-match/index.ts");
    expect(src).not.toMatch(/\.from\("notifications"\)|\.from\("match_digest_queue"\)/);
    expect(src).toContain('supabase.rpc("enqueue_instant_job_match", { p_job_id: job.id, p_matches: matches, });');
    // Deploy lag fails CLOSED: no fallback that inserts the rows itself.
    expect(src).toMatch(/if \(\(enqueueError as \{ code\?: string \}\)\.code === "PGRST202"\) \{ console\.error\("[^"]*"\); return new Response\(/);
    // The ownerless skip happens before any work, and re-triggers are limited per job.
    expect(src).toContain('.not("customer_id", "is", null)');
    expect(src).toMatch(/windowMs: 10 \* 60_000, maxRequests: 1, keyPrefix: `instant-job-match:job:\$\{jobId\}`/);
    const enq = body("enqueue_instant_job_match");
    expect(enq).toContain("CONTINUE WHEN v_uid IS NULL OR NOT public.job_announceable_to(v_job, v_uid);");
    expect(enq).toContain("ON CONFLICT (user_id, job_id) DO NOTHING");
    expect(enq).toContain("IF public.early_access_visible_at(v_uid, v_job.created_at) <= now() THEN");
  });

  it("the queue dedupes per (job, recipient) and keeps settled rows as the ledger", () => {
    const all = ws(migrations.map((m) => m.sql).join("\n"));
    expect(all).toContain("CONSTRAINT job_match_queue_user_job_unique UNIQUE (user_id, job_id)");
    const later = migrations.filter((m) => m.sql.includes("CREATE TABLE IF NOT EXISTS public.job_match_queue")).map((m) => m.file);
    expect(later).toHaveLength(1);
    expect(all).not.toMatch(/DELETE FROM public\.job_match_queue/i);
    expect(all).toContain("REVOKE ALL ON TABLE public.job_match_queue FROM PUBLIC, anon, authenticated;");
    expect(all).not.toMatch(/GRANT [^;]* ON (?:TABLE )?public\.job_match_queue TO [^;]*\b(?:anon|authenticated)\b/i);
    const d = body("deliver_job_match");
    expect(d).toContain("WHERE n.user_id = r.user_id AND n.job_id = r.job_id AND n.type = 'job_match'");
    expect(d).toContain("INSERT INTO public.notifications (user_id, title, message, type, link, job_id) VALUES (r.user_id, r.title, r.message, 'job_match', r.link, r.job_id);");
    expect(all).toMatch(/cron\.schedule\('job-match-queue', '\* \* \* \* \*', 'SELECT public\.sweep_job_match_queue\(\);'\)/);
  });

  it("daily-match-digest re-checks its rows against the gate before it summarises them", () => {
    const src = edgeCode("supabase/functions/daily-match-digest/index.ts");
    const ask = src.indexOf('supabase.rpc("job_match_digest_rows", { p_queue_ids: allIds })');
    expect(ask).toBeGreaterThan(0);
    const skip = src.indexOf("if (!row.jobs || !sendable.has(row.id)) continue;");
    expect(skip).toBeGreaterThan(ask);
    expect(src.indexOf('.from("notifications").insert(')).toBeGreaterThan(skip);
    const rows = body("job_match_digest_rows");
    expect(rows).toContain("public.job_announceable_to(j, q.user_id)");
    expect(rows).toContain("public.early_access_visible_at(q.user_id, j.created_at) > now()");
  });

  it("create-notification's job_match is admin free text only: no template emits it", () => {
    const templates = blankComments(readFileSync(join(FN, "_shared/notification-templates.ts"), "utf8"));
    expect(templates.length).toBeGreaterThan(1000);
    expect(templates).not.toMatch(/["']job_match["']/);
  });
});
