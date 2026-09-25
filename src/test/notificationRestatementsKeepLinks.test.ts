/*
 * CLASS CHECK — a restated notification producer must not undo a link the
 * database already writes (Q139, 2026-09-23).
 *
 * FOUND 2026-09-23. The first Q139 branch restated 16 notification functions
 * from their newest CREATE FUNCTION text to add job_id. But 20260831232514 and
 * 20260901021929 had changed eight of them IN PLACE (pg_get_functiondef +
 * regexp_replace + EXECUTE): the bare '/posts' and the fixed '?filter='
 * links had become '/my-…?job=' || <id>. The newest TEXT never showed that, so
 * the restatement would have reverted 14 direct links on prod. A review against
 * live pg_get_functiondef caught it; nothing in the repo could.
 *
 * THE CHECK. src/test/helpers/effectiveFunctionDefs.ts replays every migration
 * (definitions AND the regexp rewrite tuples) to get the definition each
 * migration actually replaces. Then:
 *   (a) every function the Q139 migration restates is that effective body
 *       plus ONLY the intended additions: `, job_id` / `, <id>` in an insert,
 *       or '&user=' || <id> on a link. Any removed or changed token fails.
 *   (b) every notification producer restated by any migration since Q194
 *       (20260923152630, the owner's "links go direct") writes the same links
 *       as the definition it replaces, two-way, except the '&user=' addition,
 *       unless the change is listed in INTENDED_LINK_CHANGES (itself two-way:
 *       an entry whose link did not change fails).
 *   (c) the replay itself: every migration that EXECUTEs a rewritten
 *       pg_get_functiondef is either parsed or listed in NOT_LINK_REWRITES.
 *
 * Shown red (2026-09-23) with the first branch's migration
 * (origin/cloud/q139-notification-subjects, 20260923162545) in place of
 * 20260923205635: (a) 8 functions, (b) the same 8 (14 links).
 *
 * @mutate supabase/migrations/20260923205635_notification_producers_carry_their_subject.sql | '/jobs?job=' \|\| rec.id::text, false, rec.id); | '/jobs?filter=offered', false, rec.id);
 * @mutate supabase/migrations/20260923205635_notification_producers_carry_their_subject.sql | '/posts?job=' \|\| v_locked.id::text, | '/posts',
 * @mutate supabase/migrations/20260923205635_notification_producers_carry_their_subject.sql | '/admin?view=fraud&user=' \|\| p_reviewee_id, | '/admin?view=fraud&usr=' \|\| p_reviewee_id,
 * @mutate src/test/helpers/effectiveFunctionDefs.ts | const next = pgRegexpReplace(cur.stmt, r.pattern, r.replacement, r.flags); | const next = cur.stmt;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import {
  applyMigration,
  effectiveDefs,
  migrationFiles,
  parseDefs,
  parseRewrites,
  type FnDef,
} from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const MIGRATIONS = join(REPO, "supabase", "migrations");
const Q139 = "20260923205635_notification_producers_carry_their_subject.sql";
const Q194 = "20260923152630_notification_links_point_direct_not_at_redirects.sql";

/**
 * `file::function` restatements since Q194 that change a link ON PURPOSE.
 * Two-way: each must actually change one.
 */
const INTENDED_LINK_CHANGES = new Set([
  // Q194: '/earnings' (a retired redirect) -> '/profile?tab=earnings'.
  `${Q194}::notify_helper_on_tip`,
  `${Q194}::notify_on_payment_escrowed`,
  // Q310: the four referral-bonus links '/profile' -> '/profile?tab=referral'
  // (20260831232514 had made that change; 20260902014651 restated older text).
  "20260923211309_referral_bonus_links_and_apostrophe.sql::check_referral_bonus",
  // V-008: the trigger no longer sends; its '/home?job=' || id link and the
  // email call live in deliver_saved_search_alert, the one saved-search send
  // path (called by the queue sweep), with the same link.
  "20260925053412_saved_search_alerts_wait_for_early_access.sql::notify_saved_searches_on_new_job",
  // Q393: a crew member leaving tells the poster "A Helpr left your crew",
  // linking to the job on /posts like the poster's other job notifications.
  "20260925140148_group_roster_departure.sql::helper_cancel_booking",
]);

/**
 * Migrations that EXECUTE a rewritten pg_get_functiondef but carry no
 * (ord, 'fn', $p$…$p$, $q$…$q$, 'flags') tuples, with what they rewrite. None
 * touches a notification link. Two-way.
 */
const NOT_LINK_REWRITES = new Set([
  "20260819070000_strengthen_server_phone_scan.sql", // scan_message_content
  "20260907194734_remove_helper_preferred_parishes.sql", // purge_user_data
]);

const INSERTS_NOTIFICATION = /\binsert\s+into\s+(?:public\.)?notifications\b/i;
const TOKEN = /'(?:[^']|'')*'|\|\||::|:=|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|\d+(?:\.\d+)?|\S/g;
const IDENT = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;

function tokens(stmt: string): string[] {
  return blankSqlComments(stmt).match(TOKEN) ?? [];
}

/** '…&user=' || <ident>[::type]  ->  '…'. Returns tokens and how many folded. */
function foldUserParam(t: string[]): { toks: string[]; folded: number } {
  const out: string[] = [];
  let folded = 0;
  for (let i = 0; i < t.length; i++) {
    if (/&user='$/.test(t[i]) && t[i + 1] === "||" && IDENT.test(t[i + 2] ?? "")) {
      out.push(t[i].replace(/&user='$/, "'"));
      i += 2;
      if (t[i + 1] === "::" && IDENT.test(t[i + 2] ?? "")) i += 2;
      folded++;
      continue;
    }
    out.push(t[i]);
  }
  return { toks: out, folded };
}

/** Tokens of `b` not in an LCS with `a` (inserted runs) and of `a` not matched (removed). */
function tokenDiff(a: string[], b: string[]): { removed: string[]; inserted: string[][] } {
  const n = a.length;
  const m = b.length;
  const L = new Int32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i * (m + 1) + j] =
        a[i] === b[j] ? L[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(L[(i + 1) * (m + 1) + j], L[i * (m + 1) + j + 1]);
  const removed: string[] = [];
  const inserted: string[][] = [];
  let run: string[] = [];
  let i = 0;
  let j = 0;
  const flush = () => {
    if (run.length) inserted.push(run);
    run = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (j < m && (i >= n || L[i * (m + 1) + j + 1] >= L[(i + 1) * (m + 1) + j])) {
      run.push(b[j++]);
    } else {
      flush();
      removed.push(a[i++]);
    }
  }
  flush();
  return { removed, inserted };
}

/** An allowed insertion: one or more `, <ident>[::type]` (or the mirror `<ident> ,`). */
function isAddedColumnOrValue(run: string[]): boolean {
  const s = run.join(" ");
  const item = "[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*(?: :: \\w+)?";
  return new RegExp(`^(?:, ${item})+$`).test(s) || new RegExp(`^(?:${item} ,)+$`).test(s);
}

/** Every link a body writes: a '/…' literal plus any `|| operand` chain after it. */
function links(stmt: string): string[] {
  const t = tokens(stmt);
  const out: string[] = [];
  for (let i = 0; i < t.length; i++) {
    if (!/^'\//.test(t[i])) continue;
    const parts = [t[i]];
    let k = i + 1;
    while (t[k] === "||") {
      parts.push("||");
      k++;
      if (t[k] === "(") {
        let depth = 0;
        do {
          if (t[k] === "(") depth++;
          if (t[k] === ")") depth--;
          parts.push(t[k++]);
        } while (depth > 0 && k < t.length);
      } else {
        parts.push(t[k++]);
      }
      while (t[k] === "::") parts.push(t[k++], t[k++]);
    }
    out.push(parts.join(" "));
    i = k - 1;
  }
  return out;
}

/** Links of `after` vs `before`, two-way; an added '&user=' || x is not a change. */
function linkChanges(before: string, after: string): { gone: string[]; added: string[] } {
  const pool = links(before);
  const added: string[] = [];
  for (const l of links(after)) {
    let at = pool.indexOf(l);
    if (at === -1) {
      const folded = foldUserParam(l.split(" ")).toks.join(" ");
      at = pool.indexOf(folded);
    }
    if (at === -1) added.push(l);
    else pool.splice(at, 1);
  }
  return { gone: pool, added };
}

describe("Q139: a restated notification producer keeps the links the database writes", () => {
  it("(c) the replay reads every link-rewrite migration", () => {
    const withTuples: string[] = [];
    const unparsed: string[] = [];
    let tuples = 0;
    for (const f of migrationFiles(MIGRATIONS)) {
      const sql = readFileSync(join(MIGRATIONS, f), "utf8");
      const code = blankSqlComments(sql);
      const dynamic =
        /pg_get_functiondef\s*\(/i.test(code) && /\bEXECUTE\s+(?:v_\w+|(?:regexp_)?replace\s*\()/i.test(code);
      const rw = parseRewrites(sql, f);
      tuples += rw.length;
      if (rw.length) withTuples.push(f);
      else if (dynamic) unparsed.push(f);
    }
    expect(withTuples).toEqual([
      "20260831232514_notification_links_land_on_the_right_spot.sql",
      "20260901021929_notification_links_never_carry_a_fixed_filter.sql",
      // Copy, not links: the same mechanism rewording SQL notification copy.
      "20260925143327_notification_copy_names_the_person.sql",
    ]);
    expect(tuples).toBeGreaterThan(28);
    expect(unparsed.sort()).toEqual([...NOT_LINK_REWRITES].sort());

    // The replay reproduces a rewrite the newest text does not show.
    const before = effectiveDefs(MIGRATIONS, { before: Q139 }).get("notify_poster_on_status_change")!;
    expect(before.file).toBe("20260829061546_helper_mark_on_the_way_atomic.sql");
    expect(before.stmt).toContain("'/posts?job=' || NEW.id::text");
    expect(before.stmt).not.toContain("?filter=scheduled");
  });

  it("(a) the Q139 migration restates each function as its effective body plus only job_id / &user=", () => {
    const prior = effectiveDefs(MIGRATIONS, { before: Q139 });
    const defs = parseDefs(readFileSync(join(MIGRATIONS, Q139), "utf8"));
    expect(defs.length).toBeGreaterThan(15);
    const problems: string[] = [];
    for (const d of defs) {
      const was = prior.get(d.name);
      if (!was) {
        problems.push(`${d.name}: no prior definition`);
        continue;
      }
      const { toks, folded } = foldUserParam(tokens(d.stmt));
      const { removed, inserted } = tokenDiff(tokens(was.stmt), toks);
      const bad = inserted.filter((r) => !isAddedColumnOrValue(r));
      const addsJobId = inserted.some((r) => r.includes("job_id"));
      if (removed.length || bad.length)
        problems.push(
          `${d.name} (was ${was.file}${was.rewrites.length ? " + " + was.rewrites.join(", ") : ""}): ` +
            `removed [${removed.join(" ")}] inserted [${bad.map((r) => r.join(" ")).join(" | ")}]`,
        );
      else if (!addsJobId && folded === 0) problems.push(`${d.name}: restated with no job_id / &user= added`);
    }
    expect(problems).toEqual([]);
  });

  it("(b) every notification producer restated since Q194 keeps its links (two-way)", () => {
    const defs = new Map<string, FnDef>();
    const changed: string[] = [];
    const unexpected: string[] = [];
    let checked = 0;
    for (const f of migrationFiles(MIGRATIONS)) {
      const sql = readFileSync(join(MIGRATIONS, f), "utf8");
      if (f >= Q194) {
        for (const d of parseDefs(sql)) {
          const was = defs.get(d.name);
          if (!was || !INSERTS_NOTIFICATION.test(blankSqlComments(was.stmt))) continue;
          checked++;
          const { gone, added } = linkChanges(was.stmt, d.stmt);
          if (!gone.length && !added.length) continue;
          const key = `${f}::${d.name}`;
          changed.push(key);
          if (!INTENDED_LINK_CHANGES.has(key))
            unexpected.push(`${key} (was ${was.file}): gone [${gone.join(" ; ")}] added [${added.join(" ; ")}]`);
        }
      }
      applyMigration(defs, f, sql);
    }
    expect(checked).toBeGreaterThan(20);
    expect(unexpected).toEqual([]);
    expect([...INTENDED_LINK_CHANGES].filter((k) => !changed.includes(k))).toEqual([]);
  });
});
