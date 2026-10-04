/*
 * The triggers the migrations leave, and the code a trigger function runs,
 * read from the migrations (comments blanked with blankSqlComments; function
 * bodies come from effectiveDefs, any dollar-quote tag).
 *
 * Built for the public.messages guards (serverMessageInsertsSkipBlocked,
 * messagesWriteOwnership, Q1169/Q1166/Q1167). Measured 2026-10-03: for
 * public.messages, triggerInventory() returns prod's 16 pg_trigger rows name
 * for name, including the three attached by format() in a loop.
 */
import { blankSqlComments } from "./blankNonCode";

export type Trg = { table: string; name: string; fn: string; timing: string; events: string; excludes: string[] };

/** The function body between `AS $tag$` and its closing tag (any tag), comments blanked. */
export function bodyOf(stmt: string): string {
  const code = blankSqlComments(stmt);
  const open = /\bAS\s+(\$\w*\$)/i.exec(code);
  if (!open) return "";
  const start = open.index + open[0].length;
  const end = code.indexOf(open[1], start);
  return code.slice(start, end < 0 ? code.length : end);
}

/** Offset of the first statement that aborts (RAISE without a non-error level), or -1. */
export function firstRaise(body: string): number {
  const m = /\bRAISE\b(?!\s+(?:WARNING|NOTICE|LOG|INFO|DEBUG)\b)/i.exec(body);
  return m ? m.index : -1;
}

/**
 * Every trigger the migrations leave, keyed `table.name` (newest CREATE, minus
 * DROPs, in file order). A trigger built by format() in a loop (name, events or
 * table `%I`/`%s`) is expanded from the list the loop reads, found in the 4000
 * characters before it: `'table:OP'` strings (20260923185224) or
 * `('table', 'trigger', 'OP')` tuples (20260903030936). With no list, it runs
 * for every table (`*`, 20260927234313) except the ones its loop excludes
 * (`relname NOT IN (...)`).
 */
export function triggerInventory(files: { name: string; sql: string }[]): Map<string, Trg> {
  const out = new Map<string, Trg>();
  // `[\s']+` also crosses the quotes of a format() string split over lines.
  const CREATE =
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER[\s']+("?[\w%]+"?)[\s']+(BEFORE|AFTER|INSTEAD\s+OF)\s+([\s\S]*?)[\s']+ON[\s']+(?:ONLY\s+)?(?:public\.)?("?[\w%]+"?)([\s\S]*?)\bEXECUTE[\s']+(?:FUNCTION|PROCEDURE)\s+(?:public\.)?"?(\w+)"?/gi;
  const DROP = /\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+(?:ONLY\s+)?(?:public\.)?"?(\w+)"?/gi;
  for (const f of files) {
    const code = blankSqlComments(f.sql);
    const events: { at: number; set?: Trg; drop?: string }[] = [];
    for (const m of code.matchAll(CREATE)) {
      const name = m[1].replace(/"/g, "").toLowerCase();
      const table = m[4].replace(/"/g, "").toLowerCase();
      const base = {
        fn: m[6].toLowerCase(),
        timing: m[2].replace(/\s+/g, " ").toUpperCase(),
        events: m[3].replace(/[\s']+/g, " ").trim().toUpperCase(),
        excludes: [] as string[],
      };
      if (!/%/.test(name + base.events + table)) {
        events.push({ at: m.index!, set: { ...base, table, name } });
        continue;
      }
      const back = code.slice(Math.max(0, m.index! - 4000), m.index!);
      const pairs = [...back.matchAll(/'(\w+):(INSERT|UPDATE|DELETE)'/gi)];
      const tuples = [...back.matchAll(/\(\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*'(INSERT|UPDATE|DELETE)'\s*\)/gi)];
      const naming = /'(\w+)'\s*\|\|\s*\w+\s*\|\|\s*'_'\s*\|\|\s*lower\(\s*\w+\s*\)/i.exec(back);
      if (pairs.length)
        for (const p of pairs) {
          const [tbl, op] = [p[1].toLowerCase(), p[2].toUpperCase()];
          const n = naming ? `${naming[1]}${tbl}_${op.toLowerCase()}` : `${base.fn}:${tbl}:${op.toLowerCase()}`;
          events.push({ at: m.index!, set: { ...base, table: tbl, name: n, events: op } });
        }
      else if (tuples.length)
        for (const t of tuples) events.push({ at: m.index!, set: { ...base, table: t[1].toLowerCase(), name: t[2].toLowerCase(), events: t[3].toUpperCase() } });
      else {
        const notIn = [...back.matchAll(/relname\s+NOT\s+IN\s*\(([^)]*)\)/gi)].pop();
        const excludes = notIn ? [...notIn[1].matchAll(/'(\w+)'/g)].map((x) => x[1].toLowerCase()) : [];
        events.push({ at: m.index!, set: { ...base, table: "*", name, excludes } });
      }
    }
    for (const m of code.matchAll(DROP)) events.push({ at: m.index!, drop: `${m[2].toLowerCase()}.${m[1].toLowerCase()}` });
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.set) out.set(`${e.set.table}.${e.set.name}`, e.set);
      else if (e.drop) out.delete(e.drop);
    }
  }
  return out;
}

/** The triggers on `table`, an every-table attach included unless its loop excludes the table. */
export function triggersOn(inv: Map<string, Trg>, table: string): Trg[] {
  return [...inv.values()].filter((t) => t.table === table || (t.table === "*" && !t.excludes.includes(table)));
}
