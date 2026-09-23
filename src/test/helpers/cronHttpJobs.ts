/**
 * The HTTP crons the migrations leave scheduled, derived from the SQL itself
 * (Q174). An HTTP cron is a `cron.schedule(...)` call whose command calls
 * `net.http_post(`. Replayed in filename order: `cron.schedule` upserts by
 * name, `cron.unschedule` removes.
 *
 * Two shapes exist:
 *   - a literal job name: `cron.schedule('name', 'sched', $cron$ ... $cron$)`;
 *   - 20260831190419's loop, `cron.schedule(v_target.jobname, ..., format(...))`
 *     over a `VALUES ('name', 'sched'), ...` list. A non-literal call whose
 *     command posts takes every ('name', '<cron expr>') tuple in its file.
 *
 * The argument list is read with a paren matcher that skips '...' and any
 * $tag$...$tag$ body, so a `)` inside the command cannot end the call early.
 */
import { blankSqlComments } from "./blankNonCode";

export type CronCall = { file: string; jobname: string; args: string };

const F = String.raw`[0-9*][0-9*,/\-]*`;
const EXPR = `${F}\\s+${F}\\s+${F}\\s+${F}\\s+${F}`;
const TUPLE_RE = new RegExp(String.raw`\(\s*'([a-z0-9-]+)'\s*,\s*'(${EXPR})'\s*\)`, "gi");

/** The text between `(` at `open` and its matching `)`, quote-aware. */
export function argsAt(sql: string, open: number): string {
  let depth = 0;
  let i = open;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      i++;
      while (i < sql.length && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? sql.length : end + tag.length;
        continue;
      }
    }
    if (c === "(") depth++;
    if (c === ")") {
      depth--;
      if (depth === 0) return sql.slice(open + 1, i);
    }
    i++;
  }
  return sql.slice(open + 1);
}

/** Every cron.schedule / cron.unschedule event, in order, comments blanked. */
export function cronEvents(files: { file: string; sql: string }[]) {
  const events: ({ kind: "schedule"; call: CronCall } | { kind: "unschedule"; file: string; jobname: string })[] = [];
  for (const { file, sql: raw } of files) {
    const sql = blankSqlComments(raw);
    for (const m of sql.matchAll(/cron\.(schedule|unschedule)\s*\(/gi)) {
      const args = argsAt(sql, m.index! + m[0].length - 1);
      const literal = /^\s*(?:job_name\s*:=\s*)?'([a-z0-9-]+)'/i.exec(args)?.[1];
      if (m[1].toLowerCase() === "unschedule") {
        if (literal) events.push({ kind: "unschedule", file, jobname: literal });
        continue;
      }
      if (literal) {
        events.push({ kind: "schedule", call: { file, jobname: literal, args } });
      } else if (args.includes("net.http_post(")) {
        for (const t of sql.matchAll(TUPLE_RE)) {
          events.push({ kind: "schedule", call: { file, jobname: t[1], args } });
        }
      }
    }
  }
  return events;
}

/** jobname -> the call that last scheduled it, for jobs whose command posts. */
export function httpCronJobs(files: { file: string; sql: string }[]): Map<string, CronCall> {
  const live = new Map<string, CronCall>();
  for (const e of cronEvents(files)) {
    if (e.kind === "unschedule") live.delete(e.jobname);
    else live.set(e.call.jobname, e.call);
  }
  for (const [name, call] of live) if (!call.args.includes("net.http_post(")) live.delete(name);
  return live;
}
