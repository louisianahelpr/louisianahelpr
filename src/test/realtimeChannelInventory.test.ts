/**
 * THE REALTIME CHANNEL INVENTORY IS EXACT, EVERY BINDING IS SCOPED, AND NO TWO
 * CHANNELS CARRY THE SAME SUBSCRIPTION (docs/OPEN.md Q105).
 *
 * Realtime was the largest DB cost after the Q53 outage: realtime.list_changes
 * 121,403 calls / 1,124 s, 35% of all SQL time (pg_stat_statements 15:23Z
 * 09-22 -> 08:54Z 09-23), 136 live realtime.subscription rows at ~09:10Z with
 * no real users. That cost scales with subscription rows, and a row is one
 * `postgres_changes` binding on one open channel. So this pins, from source:
 *
 *  1. THE INVENTORY. Every binding (file, channel name, table, event, filter),
 *     parsed with the TypeScript AST, is listed below EXACTLY. A new binding,
 *     a removed one or a changed filter fails until this list is edited, which
 *     is where its cost gets written down.
 *  2. EVERY BINDING IS FILTERED AND USER/JOB-SCOPED (an interpolated id in the
 *     filter). Exceptions are two rules, each required to still apply: DELETE
 *     bindings (a DELETE payload carries only the primary key, so no scoping
 *     filter can ever match) and the admin console.
 *  3. NO DUPLICATES. The same (table, filter) with overlapping events in two
 *     different channels is a second subscription row for the same rows. Four
 *     consumers each bound `notifications` INSERT `user_id=eq.<me>` on their
 *     own channel; src/lib/userRealtimeBus.ts now carries it once.
 *  4. NO CHANNEL IS OPENED BY A COMPONENT THAT THEN RENDERS NOTHING: a
 *     subscribing effect ahead of a top-level early return must bail on the
 *     same condition.
 *
 * WHY A NEW SCAN AND NOT realtimeBindingsAreScoped.test.ts: that guard's regex
 * matches only the double-quoted `"postgres_changes"`. Admin.tsx writes
 * `'postgres_changes'` and its two whole-table bindings were invisible to it.
 * The AST does not care how a string is quoted, and never reads a comment.
 *
 * @mutate src/lib/userRealtimeBus.ts | table: "messages", filter: `receiver_id=eq.${userId}` } | table: "messages" }
 * @mutate src/pages/messages/useMessagesRealtime.ts | const sub = subscribeWithRecovery( | void supabase.channel("dup").on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `receiver_id=eq.${userId}` }, () => {}); const sub = subscribeWithRecovery(
 * @mutate src/pages/admin/Admin.tsx | table: 'jobs', filter: 'is_seed=eq.false' | table: 'jobs'
 * @mutate src/hooks/useActivityData.ts | .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `helper_id=eq.${userId}` }, invalidate) | .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `helper_id=eq.${userId}` }, invalidate).on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, invalidate)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const SRC = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "__tests__") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

const parse = (file: string, text = readFileSync(file, "utf8")) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

function visit(node: ts.Node, fn: (n: ts.Node) => void) {
  fn(node);
  ts.forEachChild(node, (c) => visit(c, fn));
}

/** The literal text of a string / template, without its quotes. */
function lit(sf: ts.SourceFile, e: ts.Expression | undefined): string {
  if (!e) return "";
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  const t = e.getText(sf);
  return t.startsWith("`") ? t.slice(1, -1) : t;
}

function prop(sf: ts.SourceFile, obj: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText(sf) === key) return p.initializer;
  }
  return undefined;
}

export interface Binding {
  file: string;
  channel: string;
  table: string;
  event: string;
  filter: string;
}

/** The channel a binding sits on: the `name:` option of its enclosing subscribeWithRecovery / the arg of supabase.channel(). */
function channelOf(sf: ts.SourceFile, node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === "subscribeWithRecovery") {
      const opts = n.arguments[1];
      if (opts && ts.isObjectLiteralExpression(opts)) return lit(sf, prop(sf, opts, "name"));
      return "?";
    }
  }
  return "?";
}

export function bindingsIn(file: string, text?: string): Binding[] {
  const sf = parse(file, text);
  const out: Binding[] = [];
  visit(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== "on") return;
    const [kind, cfg] = n.arguments;
    if (!kind || lit(sf, kind) !== "postgres_changes" || !(ts.isStringLiteral(kind) || ts.isNoSubstitutionTemplateLiteral(kind))) return;
    if (!cfg || !ts.isObjectLiteralExpression(cfg)) {
      out.push({ file: relative(SRC, file), channel: channelOf(sf, n), table: "?", event: "?", filter: "?" });
      return;
    }
    out.push({
      file: relative(SRC, file),
      channel: channelOf(sf, n),
      table: lit(sf, prop(sf, cfg, "table")),
      event: lit(sf, prop(sf, cfg, "event")),
      filter: lit(sf, prop(sf, cfg, "filter")),
    });
  });
  return out;
}

const files = walk(SRC);
const all = (): Binding[] => files.flatMap((f) => bindingsIn(f));
const key = (b: Binding) => `${b.file} | ${b.channel} | ${b.table} ${b.event} | ${b.filter || "(none)"}`;

/**
 * EXACT. One line per binding: file | channel base name | table event | filter.
 * 2026-09-23 after Q105: 17 bindings on 8 channel sites (was 22 on 10, two of
 * them the Admin bindings the old double-quote-only regex could not see).
 * 2026-09-23 Q105 follow-up: 15 on 7 — the unread-nav channel is gone and the
 * Messages page's receiver INSERT + UPDATE are one `messages *` binding on the
 * shared user bus.
 */
// @two-way src/test/realtimeChannelInventory.test.ts:expect(all().map(key).sort()).toEqual(
const CHANNEL_INVENTORY = [
  "components/JobTracking.tsx | tracking-${jobId} | job_tracking * | job_id=eq.${jobId}",
  "components/JobTracking.tsx | tracking-${jobId} | jobs UPDATE | id=eq.${jobId}",
  "components/messages/useMessageReactions.ts | message_reactions:${jobId} | message_reactions * | job_id=eq.${jobId}",
  "hooks/useActivityData.ts | activity-realtime | job_tracking * | helper_id=eq.${userId}",
  "hooks/useActivityData.ts | activity-realtime | jobs * | helper_id=eq.${userId}",
  "hooks/useActivityData.ts | activity-reviews | reviews INSERT | reviewee_id=eq.${userId}",
  "lib/userRealtimeBus.ts | user-realtime-${userId} | applications * | helper_id=eq.${userId}",
  "lib/userRealtimeBus.ts | user-realtime-${userId} | jobs * | customer_id=eq.${userId}",
  "lib/userRealtimeBus.ts | user-realtime-${userId} | messages * | receiver_id=eq.${userId}",
  "lib/userRealtimeBus.ts | user-realtime-${userId} | notifications INSERT | user_id=eq.${userId}",
  "pages/admin/Admin.tsx | admin-realtime | jobs * | is_seed=eq.false",
  "pages/admin/Admin.tsx | admin-realtime | reports * | (none)",
  "pages/messages/useMessagesRealtime.ts | messages-realtime-${userId} | messages DELETE | (none)",
  "pages/messages/useMessagesRealtime.ts | messages-realtime-${userId} | messages INSERT | sender_id=eq.${userId}",
  "pages/messages/useMessagesRealtime.ts | messages-realtime-${userId} | messages UPDATE | sender_id=eq.${userId}",
];

/**
 * Not user-scoped by design: the admin console exists to watch platform-wide
 * writes, and only an admin can open it (AdminRoute). `jobs` is still filtered
 * to `is_seed=eq.false` because every number on that screen excludes seed
 * rows, so a seed write (all CI test data) can never change what it shows —
 * unfiltered, each CI job write fired a ~25-query stats reload in any open
 * admin session. `reports` has no is_seed column and is low volume.
 */
// @two-way src/test/realtimeChannelInventory.test.ts:the admin exemption still applies to something
const ADMIN_EXEMPT = new Set(["pages/admin/Admin.tsx | admin-realtime | jobs * | is_seed=eq.false", "pages/admin/Admin.tsx | admin-realtime | reports * | (none)"]);

/**
 * Overlapping subscriptions that are NOT yet shared, each with why. EMPTY since
 * the Q105 follow-up: the unread nav badge (`messages *` to me) and the
 * Messages page (`messages` INSERT / UPDATE to me) overlapped while Messages
 * was open; both now read topic `messages:inbound` on the shared user bus.
 */
// @two-way src/test/realtimeChannelInventory.test.ts:stale overlap entry
const KNOWN_OVERLAPS = new Set<string>([]);

const eventsOverlap = (a: string, b: string) => a === "*" || b === "*" || a === b;

function overlaps(bs: Binding[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i];
      const b = bs[j];
      if (a.table !== b.table || !a.filter || a.filter !== b.filter) continue;
      if (a.file === b.file && a.channel === b.channel) continue; // one channel, one row set
      if (!eventsOverlap(a.event, b.event)) continue;
      const [x, y] = [a, b].sort((p, q) => `${p.file}${p.event}`.localeCompare(`${q.file}${q.event}`));
      out.push(`${a.table} ${a.filter}: ${x.file} ${x.event} ~ ${y.file} ${y.event}`);
    }
  }
  return [...new Set(out)].sort();
}

describe("realtime channel inventory (Q105)", () => {
  it("scans a real tree and parses both quote styles", () => {
    const bs = all();
    expect(bs.length, "the postgres_changes scan found almost nothing").toBeGreaterThan(12);
    expect(new Set(bs.map((b) => b.table)).size).toBeGreaterThan(5);
    // The AST sees a single-quoted binding the old regex could not.
    const probe = bindingsIn("probe.ts", "x.on('postgres_changes', { event: '*', schema: 'public', table: 't', filter: `a=eq.${id}` }, h);");
    expect(probe.map((b) => `${b.table} ${b.event} ${b.filter}`)).toEqual(["t * a=eq.${id}"]);
    // …and never reads a comment.
    expect(bindingsIn("probe.ts", "// x.on('postgres_changes', { table: 't' }, h);\n/* y.on(\"postgres_changes\", {}, h) */")).toEqual([]);
    expect(bs.every((b) => b.channel !== "?"), bs.filter((b) => b.channel === "?").map(key).join("\n")).toBe(true);
  });

  it("the inventory is exact", () => {
    expect(all().map(key).sort()).toEqual([...CHANNEL_INVENTORY].sort());
  });

  it("every binding is filtered and scoped to a user or job, except DELETE and the admin console", () => {
    const bad = all().filter((b) => {
      if (ADMIN_EXEMPT.has(key(b))) return false;
      if (b.event === "DELETE") return false;
      return !b.filter || !/\$\{[^}]+\}/.test(b.filter);
    });
    expect(
      bad.map(key),
      "an unscoped binding fans every row change on its table out to every subscriber: one user's rows in " +
        "another's browser, plus a realtime.list_changes evaluation per write per client",
    ).toEqual([]);
  });

  it("the admin exemption still applies to something", () => {
    const keys = new Set(all().map(key));
    expect([...ADMIN_EXEMPT].filter((k) => !keys.has(k)), "stale admin exemption, remove it").toEqual([]);
    expect(all().some((b) => b.event === "DELETE" && !b.filter), "the DELETE rule excuses nothing any more").toBe(true);
  });

  it("no two channels carry the same subscription", () => {
    const found = overlaps(all());
    const unexpected = found.filter((o) => !KNOWN_OVERLAPS.has(o));
    expect(
      unexpected,
      "two channels bind the same (table, filter) with overlapping events: each is its own " +
        "realtime.subscription row for the same rows. Share it through src/lib/userRealtimeBus.ts.",
    ).toEqual([]);
    const stale = [...KNOWN_OVERLAPS].filter((o) => !found.includes(o));
    expect(stale, "stale overlap entry: it no longer overlaps, remove it").toEqual([]);
  });

  it("the shared user channel is the ONLY place its four subscriptions are bound", () => {
    const bus = all().filter((b) => b.file === "lib/userRealtimeBus.ts");
    expect(bus.length).toBe(4);
    const busKeys = new Set(bus.map((b) => `${b.table} ${b.filter}`));
    const elsewhere = all().filter((b) => b.file !== "lib/userRealtimeBus.ts" && busKeys.has(`${b.table} ${b.filter}`));
    expect(elsewhere.map(key)).toEqual([]);
    // …and it is actually used, by more than one consumer.
    const consumers = files.filter((f) => /\bsubscribeUserRealtime\(/.test(readFileSync(f, "utf8")) && !f.endsWith("userRealtimeBus.ts"));
    expect(consumers.map((f) => relative(SRC, f)).sort()).toEqual([
      "components/NotificationPanel.tsx",
      "components/mobileNav/useNavUnreadCount.ts",
      "hooks/useActivityBadgeCounts.ts",
      "hooks/useActivityData.ts",
      "hooks/useRealtimePush.ts",
      "pages/messages/useMessagesRealtime.ts",
    ]);
  });

  it("no component opens a channel and then renders nothing", () => {
    // A subscribing effect ahead of a top-level `if (…) return` in the same
    // component opens a channel on a screen that may show none of its data.
    // Allowed only when the effect bails on a variable the early return tests.
    const offenders: string[] = [];
    const SUBSCRIBES = /subscribeWithRecovery\(|subscribeUserRealtime\(|\.channel\(/;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (!SUBSCRIBES.test(text)) continue;
      const sf = parse(file, text);
      visit(sf, (fn) => {
        if (!(ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return;
        if (!fn.body || !ts.isBlock(fn.body)) return;
        const effects: string[] = [];
        for (const st of fn.body.statements) {
          const t = st.getText(sf);
          if (ts.isExpressionStatement(st) && /^use(Layout)?Effect\(/.test(t) && SUBSCRIBES.test(t)) {
            effects.push(t);
            continue;
          }
          if (effects.length && ts.isIfStatement(st) && /\breturn\b/.test(st.thenStatement.getText(sf))) {
            const ids = st.expression.getText(sf).match(/[A-Za-z_$][\w$]*/g) ?? [];
            const guarded = effects.every((e) => {
              const bail = /\bif\s*\(([^)]*)\)\s*return\b/.exec(e)?.[1] ?? "";
              return ids.some((id) => new RegExp(`\\b${id.replace(/\$/g, "\\$")}\\b`).test(bail));
            });
            if (!guarded) {
              offenders.push(`${relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1} ${st.expression.getText(sf)}`);
            }
          }
        }
      });
    }
    expect(offenders, "a channel is opened before an early return that renders nothing").toEqual([]);
  });
});
