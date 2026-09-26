/**
 * CJ-007: what every scheduled job records, and what "did nothing" means for
 * it, read from the migrations alone.
 *
 *   jobInventory()   every job the migrations leave scheduled (cron.schedule
 *                    minus cron.unschedule) plus every job they leave a
 *                    liveness expectation for (expected_max_gap, minus DELETE):
 *                    the second half is the jobs created outside the
 *                    migrations, which sweep_dead_crons still watches.
 *   jobCommands()    each scheduled job's NEWEST command: a literal
 *                    cron.schedule('job', 'sched', <cmd>) call, or a
 *                    ('job', $tag$<cmd>$tag$) tuple in a migration that runs
 *                    cron.alter_job(... command := ...). Replayed in file and
 *                    statement order.
 *   workRegister()   each job's newest work_visibility entry, from any
 *                    INSERT INTO public.cron_work_expectations (cols) VALUES
 *                    or UPDATE ... FROM (VALUES ...) AS v(cols) whose column
 *                    list names work_visibility; a DELETE of the row retires it.
 *
 * Everything is located on comment-blanked SQL (blankSqlComments), so a name
 * in a comment never counts.
 */
import { blankSqlComments } from "./blankNonCode";
import { argsAt, cronEvents, TUPLE_RE } from "./cronHttpJobs";

export type MigrationFile = { file: string; sql: string };

export type WorkEntry = {
  file: string;
  jobname: string;
  visibility: string | null;
  workKeys: string[] | null;
  maxIdle: string | null;
  reason: string | null;
};

/** Split a parenthesised list's inside on top-level commas, quote- and nesting-aware. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      i++;
      while (i < s.length && !(s[i] === "'" && s[i + 1] !== "'")) i += s[i] === "'" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(s.slice(i))?.[0];
      if (tag) {
        const end = s.indexOf(tag, i + tag.length);
        i = end === -1 ? s.length : end + tag.length;
        continue;
      }
    }
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
    i++;
  }
  const last = s.slice(start).trim();
  if (last) out.push(last);
  return out;
}

/** The top-level parenthesised tuples of a VALUES list, as their inner text. */
function tuples(values: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < values.length) {
    if (values[i] !== "(") {
      i++;
      continue;
    }
    let depth = 0;
    let j = i;
    while (j < values.length) {
      const c = values[j];
      if (c === "'") {
        j++;
        while (j < values.length && !(values[j] === "'" && values[j + 1] !== "'")) j += values[j] === "'" ? 2 : 1;
        j++;
        continue;
      }
      if (c === "$") {
        const tag = /^\$[A-Za-z_]*\$/.exec(values.slice(j))?.[0];
        if (tag) {
          const end = values.indexOf(tag, j + tag.length);
          j = end === -1 ? values.length : end + tag.length;
          continue;
        }
      }
      if (c === "(") depth++;
      if (c === ")") {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    out.push(values.slice(i + 1, j));
    i = j + 1;
  }
  return out;
}

/** A SQL literal as a JS value: 'text' (with '' unescaped), NULL, or the raw text. */
function literal(v: string): string | null {
  const t = v.replace(/::[a-z_[\]]+$/i, "").trim();
  if (/^null$/i.test(t)) return null;
  const q = /^'((?:[^']|'')*)'$/s.exec(t);
  if (q) return q[1].replace(/''/g, "'");
  const iv = /^interval\s+'([^']*)'$/i.exec(t);
  if (iv) return iv[1];
  return t;
}

function arrayLiteral(v: string): string[] | null {
  const t = v.replace(/::[a-z_[\]]+$/i, "").trim();
  if (/^null$/i.test(t)) return null;
  const m = /^ARRAY\s*\[([\s\S]*)\]$/i.exec(t);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}

type Positioned = { order: number; apply: () => void };

/** Jobs the migrations leave scheduled, with the call that last scheduled them. */
function scheduled(files: MigrationFile[]): Map<string, string> {
  const live = new Map<string, string>();
  for (const e of cronEvents(files)) {
    if (e.kind === "unschedule") live.delete(e.jobname);
    else live.set(e.call.jobname, e.call.file);
  }
  return live;
}

/** Jobs with a standing liveness expectation (expected_max_gap), order-aware. */
function standingExpectations(files: MigrationFile[]): Set<string> {
  const out = new Set<string>();
  const stmt =
    /INSERT\s+INTO\s+public\.cron_work_expectations\s*\(([^)]*)\)\s*VALUES([\s\S]*?);|DELETE\s+FROM\s+(?:public\.)?cron_work_expectations\s+WHERE\s+jobname\s*(?:IN\s*\(([^)]*)\)|=\s*'([a-z0-9-]+)')/gi;
  for (const { sql: raw } of files) {
    const sql = blankSqlComments(raw);
    for (const m of sql.matchAll(stmt)) {
      if (m[1] !== undefined) {
        const cols = m[1].split(",").map((c) => c.trim().toLowerCase());
        if (!cols.includes("expected_max_gap")) continue;
        for (const row of tuples(m[2])) {
          const name = /^'([a-z0-9-]+)'$/.exec(splitTopLevel(row)[0] ?? "")?.[1];
          if (name) out.add(name);
        }
      } else {
        const names = m[4] !== undefined ? [m[4]] : [...m[3].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]);
        for (const n of names) out.delete(n);
      }
    }
  }
  return out;
}

/** Every job the repo schedules or monitors: jobname -> where it comes from. */
export function jobInventory(files: MigrationFile[]): Map<string, "scheduled" | "monitored-only"> {
  const inv = new Map<string, "scheduled" | "monitored-only">();
  for (const n of scheduled(files).keys()) inv.set(n, "scheduled");
  for (const n of standingExpectations(files)) if (!inv.has(n)) inv.set(n, "monitored-only");
  return inv;
}

/** jobname -> newest command text (raw args of the schedule call, or the alter_job tuple's body). */
export function jobCommands(files: MigrationFile[]): Map<string, { file: string; command: string }> {
  const out = new Map<string, { file: string; command: string }>();
  for (const { file, sql: raw } of files) {
    const sql = blankSqlComments(raw);
    const events: Positioned[] = [];
    for (const m of sql.matchAll(/cron\.(schedule|unschedule)\s*\(/gi)) {
      const args = argsAt(sql, m.index! + m[0].length - 1);
      const name = /^\s*(?:job_name\s*:=\s*)?'([a-z0-9-]+)'/i.exec(args)?.[1];
      if (!name) {
        // 20260831190419's loop: cron.schedule(v_target.jobname, ...) over a
        // ('name', 'sched') VALUES list, the same reading cronEvents gives it.
        if (m[1].toLowerCase() === "schedule" && args.includes("net.http_post(")) {
          for (const t of sql.matchAll(TUPLE_RE)) {
            const job = t[1];
            events.push({ order: m.index!, apply: () => out.set(job, { file, command: args }) });
          }
        }
        continue;
      }
      if (m[1].toLowerCase() === "unschedule") events.push({ order: m.index!, apply: () => out.delete(name) });
      else events.push({ order: m.index!, apply: () => out.set(name, { file, command: args }) });
    }
    if (/cron\.alter_job\s*\([^;]*command\s*:=/i.test(sql)) {
      for (const m of sql.matchAll(/\(\s*'([a-z0-9-]+)'\s*,\s*(\$[A-Za-z_]*\$)([\s\S]*?)\2\s*\)/g)) {
        const [, name, , body] = m;
        events.push({ order: m.index!, apply: () => out.set(name, { file, command: body }) });
      }
    }
    events.sort((a, b) => a.order - b.order).forEach((e) => e.apply());
  }
  return out;
}

/** Newest work_visibility entry per job. */
export function workRegister(files: MigrationFile[]): Map<string, WorkEntry> {
  const reg = new Map<string, WorkEntry>();
  const stmt =
    /INSERT\s+INTO\s+public\.cron_work_expectations\s*\(([^)]*)\)\s*VALUES([\s\S]*?);|FROM\s*\(\s*VALUES([\s\S]*?)\)\s*AS\s+\w+\s*\(([^)]*)\)|DELETE\s+FROM\s+(?:public\.)?cron_work_expectations\s+WHERE\s+jobname\s*(?:IN\s*\(([^)]*)\)|=\s*'([a-z0-9-]+)')/gi;
  for (const { file, sql: raw } of files) {
    const sql = blankSqlComments(raw);
    for (const m of sql.matchAll(stmt)) {
      if (m[5] !== undefined || m[6] !== undefined) {
        const names = m[6] !== undefined ? [m[6]] : [...m[5].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]);
        for (const n of names) reg.delete(n);
        continue;
      }
      const colsRaw = m[1] ?? m[4];
      const values = m[2] ?? m[3];
      const cols = colsRaw.split(",").map((c) => c.trim().toLowerCase());
      if (!cols.includes("work_visibility")) continue;
      for (const row of tuples(values)) {
        const cells = splitTopLevel(row);
        const get = (c: string) => {
          const k = cols.indexOf(c);
          return k === -1 ? undefined : cells[k];
        };
        // Only a quoted name is a row: `ON CONFLICT (jobname)` after the
        // VALUES list is a parenthesised group too.
        const jobname = /^'([a-z0-9-]+)'$/.exec((get("jobname") ?? "").trim())?.[1];
        if (!jobname) continue;
        reg.set(jobname, {
          file,
          jobname,
          visibility: literal(get("work_visibility") ?? "NULL"),
          workKeys: arrayLiteral(get("work_keys") ?? "NULL"),
          maxIdle: literal(get("max_idle") ?? "NULL"),
          reason: literal(get("work_exempt_reason") ?? "NULL"),
        });
      }
    }
  }
  return reg;
}

/**
 * Jobs with a standing found-vs-dispositioned rule: the newest
 * ('job', 'candidate_key', ARRAY[...]) tuple, unless a later
 * `SET candidate_key = NULL ... WHERE jobname = 'job'` cleared it.
 */
export function candidateRules(files: MigrationFile[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const { sql: raw } of files) {
    const sql = blankSqlComments(raw);
    const ev: { at: number; name: string; key: string | null }[] = [];
    for (const m of sql.matchAll(/\(\s*'([a-z0-9-]+)'\s*,\s*'([a-zA-Z0-9_]+)'\s*,\s*ARRAY\[/g))
      ev.push({ at: m.index!, name: m[1], key: m[2] });
    for (const m of sql.matchAll(/SET\s+candidate_key\s*=\s*NULL[\s\S]*?WHERE\s+jobname\s*=\s*'([a-z0-9-]+)'/gi))
      ev.push({ at: m.index!, name: m[1], key: null });
    for (const e of ev.sort((a, b) => a.at - b.at)) {
      if (e.key === null) out.delete(e.name);
      else out.set(e.name, e.key);
    }
  }
  return out;
}
