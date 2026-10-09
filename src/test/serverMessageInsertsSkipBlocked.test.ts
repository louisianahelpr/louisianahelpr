// Q713: the status-message insert stops skipping blocked participants (newest definition: 20261004001242).
// @mutate supabase/migrations/20261004001242_messages_status_notices_and_sender_writes.sql |   WHERE p.participant IS NOT NULL\n    AND public.are_users_blocked(NEW.customer_id, p.participant) IS NOT TRUE |   WHERE p.participant IS NOT NULL
// Q1169 review: the status notice's per-recipient cap loses its window (the dispute loop is unbounded again).
// @mutate supabase/migrations/20261004001242_messages_status_notices_and_sender_writes.sql | AND d.created_at > now() - interval '10 minutes' | AND true
// Q1169 re-review: the latest-notice check stops comparing the text (a repeat of the same notice is sent again).
// @mutate supabase/migrations/20261004001242_messages_status_notices_and_sender_writes.sql | WHERE last.content = v_content | WHERE false
// Q1169: the send limit stops stepping aside for the platform's notices.
// @mutate supabase/migrations/20261004001242_messages_status_notices_and_sender_writes.sql | IF NEW.is_system AND pg_trigger_depth() > 1 THEN | IF false THEN
// Q1169: the trigger's count charges the platform's notices to the poster again.
// @mutate supabase/migrations/20261004001242_messages_status_notices_and_sender_writes.sql | AND NOT is_system\n |
// Q1169: the INSERT policy's copy of the count charges them again (the two counts disagree).
// @mutate supabase/migrations/20261004001242_messages_status_notices_and_sender_writes.sql | AND NOT m.is_system\n |
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles, type FnDef } from "./helpers/effectiveFunctionDefs";
import { bodyOf, firstRaise, triggerInventory, triggersOn, type Trg } from "./helpers/migrationTriggers";

/**
 * A SERVER-SIDE MESSAGE NEVER ABORTS THE WRITE THAT CAUSED IT (Q713, Q1169).
 *
 * insert_job_status_system_message (AFTER UPDATE OF status ON jobs, SECURITY
 * DEFINER) posts a notice from the poster to every thread participant, inside
 * the status change. Any INSERT trigger on messages that RAISEs on one of those
 * rows aborts the whole status change (accept, start, complete, cancel,
 * dispute) for whoever made it, the service role's sweeps included.
 *
 * Q713: trg_enforce_block_on_message_insert raised "You can't message this
 * user." for a blocked participant (it applies inside a client's request even
 * when the INSERT runs in a SECURITY DEFINER function: auth.uid() is set).
 * 20261003183349 skips a blocked participant with the block trigger's own
 * predicate.
 * Q1169: enforce_message_rate counted the notices (and the same statement's
 * earlier notices) against the poster's 30-per-hour cap: 31 participants meant
 * the job could never change status again. 20261004001242 steps it aside for a
 * notice written from inside another trigger and counts only the sender's own
 * rows, in the trigger and in the INSERT policy's copy of the count.
 *
 * INVENTORY, from the migrations (replayed in order, comments blanked, later
 * rewrites and DROPs applied):
 *   - every function that INSERTs INTO public.messages (the server writers);
 *   - every trigger the migrations leave on public.messages that fires on
 *     INSERT (BEFORE or AFTER, row or statement level; a trigger attached to
 *     every table with `ON public.%I` counts unless its loop excludes
 *     messages), whose function can RAISE (RAISE without WARNING/NOTICE/LOG/
 *     INFO/DEBUG). Measured 2026-10-03: the parser's trigger list for messages
 *     equals prod's pg_trigger list name for name (16; two come from
 *     20260923185224's 'table:OP' loop, one from 20260927234313's every-table
 *     loop), with prod's timing and events except trg_stamp_message_edited_at,
 *     which 20261004001242 widens to every UPDATE.
 * Every such trigger must be CLEARED below, two-way: a new raising trigger
 * fails until someone shows why a server notice cannot trip it; a cleared one
 * that stops raising (or leaves) fails until it is removed. Each clearance is
 * checked against the code, not taken on trust.
 *
 * Behaviour: src/test/pglite/statusMessageSkipsBlocked.pglite.mjs (Q713) and
 * src/test/pglite/messageRateSparesStatusNotices.pglite.mjs (Q1169: live
 * bodies, applied 3x: ALL PASS; NEW_MIGRATION=skip: 9 FAILED, incl. the dispute loop R8; the X -> Y -> X cases L8/L9 were red on 24f9ec692).
 */

const MIG = join(__dirname, "..", "..", "supabase", "migrations");

/**
 * NOT SERVER NOTICES: a PERSON'S OWN MESSAGE written through a SECURITY
 * DEFINER RPC (2026-10-09, the "Louisiana Helpr Team" thread: it has no job,
 * so the INSERT policy refuses a client INSERT and the server writes it,
 * 20261009142834). The block gate, the send cap and the ban and
 * unconfirmed-email gates must refuse these exactly as they refuse a client
 * INSERT, so they are left OUT of the server-notice inventory below. EXACT and
 * two-way: each must exist, insert into messages, write sender_id from
 * auth.uid() and never write is_system (`personSendGaps`).
 */
export const PERSON_SEND_RPCS: readonly string[] = ["admin_send_team_message", "send_team_reply"];

/** Why a PERSON_SEND_RPCS function is not the caller's own send, [] when it is. */
export function personSendGaps(stmt: string): string[] {
  const out: string[] = [];
  const body = blankSqlComments(stmt);
  const caller = /\b(\w+)\s+uuid\s*:=\s*auth\.uid\(\)/i.exec(body)?.[1];
  if (!caller) out.push("no `<var> uuid := auth.uid()`: the sender is not the caller");
  const inserts = messageInserts(stmt);
  if (inserts.length === 0) out.push("no INSERT INTO messages");
  for (const ins of inserts) {
    const cols = insertColumns(ins);
    const vals = /\)\s*VALUES\s*\(([\s\S]*)\)/i.exec(ins);
    const items = vals ? splitTop(vals[1]) : null;
    if (!cols || !items || items.length !== cols.length) { out.push("an insert whose values cannot be read"); continue; }
    if (items[cols.indexOf("sender_id")] !== caller) out.push(`sender_id is ${items[cols.indexOf("sender_id")]}, not the caller`);
    const sys = cols.indexOf("is_system");
    if (sys >= 0 && items[sys].toLowerCase() !== "false") out.push(`is_system is ${items[sys]}`);
  }
  return out;
}

const isServerInserter = ([name]: [string, FnDef]) => !PERSON_SEND_RPCS.includes(name);

/** Each `INSERT INTO [public.]messages …;` statement in a function body, comments blanked. */
export function messageInserts(stmt: string): string[] {
  const body = blankSqlComments(stmt);
  // No column list required: `INSERT INTO messages SELECT ...`, `... VALUES ...`
  // and `... AS m (...)` are inserts too (lh-authz-rls review of Q713).
  return [...body.matchAll(/\bINSERT\s+INTO\s+(?:public\.)?"?messages"?\b[^;]*;/gi)].map((m) => m[0]);
}

/** Why a function's message inserts can be aborted by a block, or [] when each is screened. */
export function unscreened(stmt: string): string[] {
  const out: string[] = [];
  const screenedInFunction = /\bare_users_blocked\s*\(/i.test(blankSqlComments(stmt));
  for (const ins of messageInserts(stmt)) {
    const isSelect = /\bSELECT\b/i.test(ins);
    const screened = isSelect ? /\bare_users_blocked\s*\(/i.test(ins) : screenedInFunction;
    if (!screened) out.push(ins.replace(/\s+/g, " ").slice(0, 120));
  }
  return out;
}

/** The column list of `INSERT INTO messages (a, b, …)`, lower-cased, or null without one. */
function insertColumns(ins: string): string[] | null {
  const m = /\bINSERT\s+INTO\s+(?:public\.)?"?messages"?\s*\(([^)]*)\)/i.exec(ins);
  return m ? m[1].split(",").map((c) => c.trim().replace(/"/g, "").toLowerCase()) : null;
}

/** Top-level comma split (parentheses balanced). */
function splitTop(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The value each insert writes into is_system ("true", "false", …), or why it cannot be read. */
export function isSystemValue(ins: string): string {
  const cols = insertColumns(ins);
  if (!cols) return "unreadable: no column list";
  const at = cols.indexOf("is_system");
  if (at < 0) return "absent (the column default, false)";
  const sel = /\)\s*SELECT\s+(?:DISTINCT\s+)?([\s\S]*?)\s+FROM\b/i.exec(ins);
  const vals = /\)\s*VALUES\s*\(([\s\S]*)\)/i.exec(ins);
  const items = sel ? splitTop(sel[1]) : vals ? splitTop(vals[1]) : null;
  if (!items || items.length !== cols.length) return "unreadable: the values do not line up with the column list";
  return items[at].toLowerCase();
}

/** The highest per-recipient notice count a window may allow (the reviewer's "about 6"). */
const MAX_NOTICES_PER_WINDOW = 10;

/**
 * Why an insert's repeat brake is missing or loose, [] when it has both halves
 * (lh-authz-rls re-review of 24f9ec692):
 *  (a) it skips a recipient whose LATEST notice already says the same thing:
 *      `NOT EXISTS (SELECT 1 FROM (SELECT ... FROM messages ... receiver_id = ...
 *      ORDER BY ... created_at DESC LIMIT 1) x WHERE x.content = ...)`. Matching
 *      the same text anywhere in a window instead drops a real move back
 *      (in_progress -> disputed -> in_progress ended the thread at "Dispute opened");
 *  (b) it caps the recipient's notices in a window:
 *      `(SELECT count(*) FROM messages ... receiver_id = ... created_at > now() - interval '...') < N`,
 *      N at most MAX_NOTICES_PER_WINDOW, which bounds an alternating loop.
 */
export function brakeGaps(ins: string): string[] {
  const out: string[] = [];
  const latest = /\bNOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s*\(\s*SELECT\s+[\s\S]*?\bFROM\s+(?:public\.)?messages\b([\s\S]*?)\bORDER\s+BY\s+\w+\.created_at\s+DESC\b[\s\S]*?\bLIMIT\s+1\s*\)\s*\w+\s+WHERE\s+\w+\.content\s*=/i.exec(ins);
  if (!latest || !/\breceiver_id\s*=/i.test(latest[1])) out.push("no latest-notice check (skip only when the recipient's newest notice already says this)");
  const cap = /\(\s*SELECT\s+count\(\*\)\s+FROM\s+(?:public\.)?messages\b([\s\S]*?)\)\s*<\s*(\d+)/i.exec(ins);
  if (!cap || !/\breceiver_id\s*=/i.test(cap[1]) || !/\bcreated_at\s*>\s*now\(\)\s*-\s*interval\s*'[^']+'/i.test(cap[1]))
    out.push("no per-recipient cap in a window (count(*) of their notices since now() - interval < N)");
  else if (Number(cap[2]) > MAX_NOTICES_PER_WINDOW) out.push(`a per-recipient cap of ${cap[2]} (more than ${MAX_NOTICES_PER_WINDOW}) per window`);
  return out;
}

type Ctx = {
  defs: Map<string, FnDef>;
  inserters: [string, FnDef][];
  triggers: Map<string, Trg>;
};

/**
 * Why each raising INSERT trigger on messages can never abort a server notice.
 * Each entry returns its offenders ([] = cleared), read off the code.
 */
const CLEARED: Record<string, { why: string; offenders: (ctx: Ctx) => string[] }> = {
  enforce_block_on_message_insert: {
    why: "every server insert screens its recipients with are_users_blocked, the trigger's own test (Q713)",
    offenders: (ctx) => ctx.inserters.flatMap(([n, d]) => unscreened(d.stmt).map((s) => `${n}: ${s}`)),
  },
  enforce_message_rate: {
    why:
      "it returns for a notice (is_system) written from inside another trigger before it can raise, every server " +
      "insert is a trigger writing is_system = true, and each one brakes its own repeats, since the cap no longer bounds " +
      "how many notices a party can drive (the lh-authz-rls review's open/withdraw-dispute loop) (Q1169)",
    offenders: (ctx) => {
      const out: string[] = [];
      const body = bodyOf(ctx.defs.get("enforce_message_rate")?.stmt ?? "");
      const exempt = /\bIF\s+NEW\.is_system\s+AND\s+pg_trigger_depth\(\)\s*>\s*1\s+THEN\s+RETURN\s+NEW\s*;/i.exec(body);
      if (!exempt) out.push("enforce_message_rate: no `IF NEW.is_system AND pg_trigger_depth() > 1 THEN RETURN NEW;`");
      else if (firstRaise(body) >= 0 && firstRaise(body) < exempt.index) out.push("enforce_message_rate: it can raise before the notice exemption");
      for (const [n, d] of ctx.inserters) {
        if (!/\bRETURNS\s+trigger\b/i.test(blankSqlComments(d.stmt)))
          out.push(`${n}: writes messages outside a trigger, so pg_trigger_depth() is 1 there and the cap counts and refuses its rows`);
        for (const ins of messageInserts(d.stmt)) {
          const v = isSystemValue(ins);
          if (v !== "true") out.push(`${n}: is_system is ${v}, so the cap counts and refuses this insert`);
          for (const gap of brakeGaps(ins)) out.push(`${n}: ${gap}, so its notices are unbounded or drop a real change`);
        }
      }
      return out;
    },
  },
  messages_validate_reply: {
    why: "it raises only for a reply (reply_to_id set), and no server insert names reply_to_id",
    offenders: (ctx) => {
      const out: string[] = [];
      const body = bodyOf(ctx.defs.get("messages_validate_reply")?.stmt ?? "");
      const early = /\bIF\s+NEW\.reply_to_id\s+IS\s+NULL\s+THEN\s+RETURN\s+NEW\s*;/i.exec(body);
      if (!early || firstRaise(body) < early.index) out.push("messages_validate_reply: it can raise before `IF NEW.reply_to_id IS NULL THEN RETURN NEW;`");
      for (const [n, d] of ctx.inserters)
        for (const ins of messageInserts(d.stmt)) {
          const cols = insertColumns(ins);
          if (!cols) out.push(`${n}: an insert with no column list (cannot show it leaves reply_to_id NULL)`);
          else if (cols.includes("reply_to_id")) out.push(`${n}: writes reply_to_id`);
        }
      return out;
    },
  },
  enforce_ban_gate: {
    why: "a gate on the CALLER (auth.uid()), and the same gate guards the write that fires each server insert, so the caller was refused there first",
    offenders: (ctx) => callerGateOffenders(ctx, "enforce_ban_gate"),
  },
  refuse_unconfirmed_email_write: {
    why: "a gate on the CALLER's session, and the same gate guards the write that fires each server insert, so the caller was refused there first",
    offenders: (ctx) => callerGateOffenders(ctx, "refuse_unconfirmed_email_write"),
  },
};

/**
 * A caller gate is cleared when its abort condition never reads the row, and
 * every table whose trigger runs a server insert carries the same gate on that
 * trigger's event.
 */
function callerGateOffenders(ctx: Ctx, gate: string): string[] {
  const out: string[] = [];
  const body = bodyOf(ctx.defs.get(gate)?.stmt ?? "");
  const r = firstRaise(body);
  const ifs = r < 0 ? [] : [...body.slice(0, r).matchAll(/\bIF\b/gi)];
  const cond = ifs.length ? body.slice(ifs[ifs.length - 1].index!, r) : "";
  if (!cond || /\b(?:NEW|OLD)\./i.test(cond)) out.push(`${gate}: its abort condition reads the row, so it is not a caller-only gate`);
  for (const [n] of ctx.inserters)
    for (const t of [...ctx.triggers.values()].filter((x) => x.fn === n && x.table !== "*")) {
      const ev = /\bINSERT\b/.test(t.events) ? "INSERT" : /\bUPDATE\b/.test(t.events) ? "UPDATE" : "DELETE";
      const gated = triggersOn(ctx.triggers, t.table).some((g) => g.fn === gate && g.timing === "BEFORE" && new RegExp(`\\b${ev}\\b`).test(g.events));
      if (!gated) out.push(`${gate}: not on ${t.table} BEFORE ${ev}, where ${n} (${t.name}) writes messages`);
    }
  return out;
}

const files = () => migrationFiles(MIG).map((name) => ({ name, sql: readFileSync(join(MIG, name), "utf8") }));

function context(defs: Map<string, FnDef>, triggers: Map<string, Trg>): Ctx {
  return {
    defs,
    triggers,
    inserters: [...defs].filter(([, d]) => messageInserts(d.stmt).length > 0).filter(isServerInserter),
  };
}

/** The raising INSERT triggers on messages: function -> trigger names. */
function raisingInsertTriggers(ctx: Ctx): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of triggersOn(ctx.triggers, "messages")) {
    if (!/\bINSERT\b/.test(t.events)) continue;
    if (firstRaise(bodyOf(ctx.defs.get(t.fn)?.stmt ?? "")) < 0) continue;
    out.set(t.fn, [...(out.get(t.fn) ?? []), t.name]);
  }
  return out;
}

/** The send-limit count of a body: does it skip notices, its window, its cap. */
export function rateCount(body: string): { skipsNotices: boolean; window: string | null; cap: string | null } {
  const q = /SELECT\s+count\(\*\)[\s\S]*?FROM\s+public\.messages\b[\s\S]*?(?:;|\)\s*<\s*(\d+))/i.exec(body);
  const text = q?.[0] ?? "";
  return {
    skipsNotices: /\bAND\s+NOT\s+(?:\w+\.)?is_system\b/i.test(text),
    window: /interval\s+'([^']+)'/i.exec(text)?.[1] ?? null,
    cap: q?.[1] ?? /\bv_cap\s+constant\s+integer\s*:=\s*(\d+)/i.exec(body)?.[1] ?? null,
  };
}

describe("a server-side message insert screens blocked recipients (Q713)", () => {
  const defs = effectiveDefs(MIG);
  const allInserters = [...defs].filter(([, d]) => messageInserts(d.stmt).length > 0);
  const inserters = allInserters.filter(isServerInserter);

  it("every PERSON_SEND_RPCS entry exists, inserts into messages, and sends as the caller (two-way)", () => {
    const named = allInserters.map(([n]) => n);
    expect(PERSON_SEND_RPCS.filter((n) => !named.includes(n))).toEqual([]);
    const gaps = PERSON_SEND_RPCS.flatMap((n) => personSendGaps(defs.get(n)?.stmt ?? "").map((g) => `${n}: ${g}`));
    expect(gaps, "a person-send RPC must write the caller's own, non-system message, or it is a server notice").toEqual([]);
  });

  it("personSendGaps can fail: a sender that is not the caller, or a system row", () => {
    const forged = `DECLARE v_me uuid := auth.uid(); BEGIN INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES (NULL, p_sender, v_me, 'x'); END`;
    expect(personSendGaps(forged)).toHaveLength(1);
    const notice = `DECLARE v_me uuid := auth.uid(); BEGIN INSERT INTO public.messages (sender_id, receiver_id, content, is_system) VALUES (v_me, b, 'x', true); END`;
    expect(personSendGaps(notice)).toHaveLength(1);
  });

  it("the inventory is real", () => {
    expect(defs.size).toBeGreaterThan(300);
    // The status-message trigger at least; a parser that finds none cannot pass.
    expect(inserters.map(([n]) => n)).toContain("insert_job_status_system_message");
  });

  it("every function that inserts into messages screens with are_users_blocked", () => {
    const offenders = inserters.flatMap(([name, d]) => unscreened(d.stmt).map((s) => `${name} (${d.file}): ${s}`));
    expect(
      offenders,
      "trg_enforce_block_on_message_insert would abort the write that caused this message whenever sender and recipient " +
        "are blocked; skip blocked recipients with `public.are_users_blocked(<sender>, <recipient>) IS NOT TRUE` (20261003183349)",
    ).toEqual([]);
  });

  describe("the guard can fail", () => {
    it("on the pre-Q713 status-message insert", () => {
      const original = `CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN
        INSERT INTO messages (job_id, sender_id, receiver_id, content, read, is_system)
        SELECT DISTINCT NEW.id, NEW.customer_id, p.participant, 'x', false, true
        FROM (SELECT m.sender_id AS participant FROM messages m WHERE m.job_id = NEW.id) p
        WHERE p.participant IS NOT NULL
        ON CONFLICT DO NOTHING;
        RETURN NEW; END $function$;`;
      expect(unscreened(original)).toHaveLength(1);
    });

    it("on a single-row insert in a function that never screens, and not on one that does", () => {
      const bare = `BEGIN INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES (a, b, c, 'x'); END`;
      expect(unscreened(bare)).toHaveLength(1);
      const screened = `BEGIN IF public.are_users_blocked(b, c) IS NOT TRUE THEN INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES (a, b, c, 'x'); END IF; END`;
      expect(unscreened(screened)).toEqual([]);
    });
  });
});

describe("no INSERT trigger on messages that can raise can abort a server notice (Q1169)", () => {
  const ctx = context(effectiveDefs(MIG), triggerInventory(files()));
  const raising = raisingInsertTriggers(ctx);

  it("the inventory is real", () => {
    const onMessages = triggersOn(ctx.triggers, "messages").map((t) => t.name);
    // 16 on prod's pg_trigger, 2026-10-03, name for name; a floor, so a new one does not need this edited.
    expect(onMessages.length).toBeGreaterThan(12);
    expect(onMessages).toEqual(expect.arrayContaining(["enforce_message_rate", "trg_enforce_block_on_message_insert", "zz_refuse_unconfirmed_email_write"]));
    expect(raising.size).toBeGreaterThan(3);
    expect(ctx.inserters.length).toBeGreaterThan(0);
  });

  it("every raising INSERT trigger on messages is cleared, and every clearance is still needed (two-way)", () => {
    expect([...raising.keys()].sort(), "a raising INSERT trigger on messages: show in CLEARED why a server notice cannot trip it").toEqual(
      Object.keys(CLEARED).sort(),
    );
  });

  it.each(Object.keys(CLEARED).map((k) => [k]))("%s: its clearance holds in the code", (fn) => {
    expect(CLEARED[fn].offenders(ctx), `${fn} is cleared because ${CLEARED[fn].why}`).toEqual([]);
  });

  it("the INSERT policy's count and the trigger's count agree: both skip notices, same window, same cap", () => {
    const trigger = rateCount(bodyOf(ctx.defs.get("enforce_message_rate")?.stmt ?? ""));
    const policy = rateCount(bodyOf(ctx.defs.get("can_send_message_to_in_job")?.stmt ?? ""));
    expect(trigger).toEqual({ skipsNotices: true, window: "1 hour", cap: "30" });
    expect(policy).toEqual(trigger);
  });

  describe("the guard can fail", () => {
    const pre = context(effectiveDefs(MIG, { before: "20261004001242" }), ctx.triggers);

    it("on prod's state before 20261004001242: the send limit is not cleared and the counts charge notices", () => {
      expect(CLEARED.enforce_message_rate.offenders(pre)).toEqual([
        expect.stringContaining("no `IF NEW.is_system AND pg_trigger_depth() > 1"),
        expect.stringContaining("insert_job_status_system_message: no latest-notice check"),
        expect.stringContaining("insert_job_status_system_message: no per-recipient cap"),
      ]);
      expect(rateCount(bodyOf(pre.defs.get("enforce_message_rate")!.stmt)).skipsNotices).toBe(false);
      expect(rateCount(bodyOf(pre.defs.get("can_send_message_to_in_job")!.stmt)).skipsNotices).toBe(false);
    });

    it("on a new raising INSERT trigger on messages that nobody cleared", () => {
      const extra = [...files(), {
        name: "99999999999999_x.sql",
        sql: `CREATE FUNCTION public.zz_refuse() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'no'; END $f$;
              CREATE TRIGGER zz_refuse BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.zz_refuse();`,
      }];
      const defs = new Map(ctx.defs);
      defs.set("zz_refuse", { file: "x", index: 0, stmt: extra[extra.length - 1].sql, rewrites: [] });
      expect([...raisingInsertTriggers(context(defs, triggerInventory(extra))).keys()]).toContain("zz_refuse");
    });

    it("on a server insert that is not a trigger, writes is_system false, or names reply_to_id", () => {
      const defs = new Map(ctx.defs);
      defs.set("zz_rpc", {
        file: "x", index: 0, rewrites: [],
        stmt: `CREATE FUNCTION public.zz_rpc() RETURNS void LANGUAGE plpgsql AS $f$ BEGIN
          INSERT INTO public.messages (job_id, sender_id, receiver_id, content, is_system, reply_to_id) VALUES (a, b, c, 'x', false, d); END $f$;`,
      });
      const c = context(defs, ctx.triggers);
      expect(CLEARED.enforce_message_rate.offenders(c)).toEqual([
        expect.stringContaining("zz_rpc: writes messages outside a trigger"),
        "zz_rpc: is_system is false, so the cap counts and refuses this insert",
        expect.stringContaining("zz_rpc: no latest-notice check"),
        expect.stringContaining("zz_rpc: no per-recipient cap"),
      ]);
      expect(CLEARED.messages_validate_reply.offenders(c)).toEqual(["zz_rpc: writes reply_to_id"]);
    });

    it("on the notice insert without either half of its brake, or with a loose cap", () => {
      const without = (find: RegExp, replace: string) => {
        const defs = new Map(ctx.defs);
        const cur = defs.get("insert_job_status_system_message")!;
        const stmt = cur.stmt.replace(find, replace);
        expect(stmt, `${find} no longer matches the notice function`).not.toBe(cur.stmt);
        defs.set("insert_job_status_system_message", { ...cur, stmt });
        return CLEARED.enforce_message_rate.offenders(context(defs, ctx.triggers));
      };
      expect(without(/AND d\.created_at > now\(\) - interval '10 minutes'/, "AND true")).toEqual([
        expect.stringContaining("insert_job_status_system_message: no per-recipient cap"),
      ]);
      expect(without(/WHERE last\.content = v_content/, "WHERE false")).toEqual([
        expect.stringContaining("insert_job_status_system_message: no latest-notice check"),
      ]);
      expect(without(/\) < 6\b/, ") < 60")).toEqual([expect.stringContaining("a per-recipient cap of 60")]);
      // 24f9ec692's first brake: the same text anywhere in a 10-minute window.
      // It bounds the loop but drops a real move back, so it is not enough.
      const windowOnly =
        "INSERT INTO messages (job_id) SELECT x FROM p WHERE NOT EXISTS (SELECT 1 FROM messages d WHERE d.receiver_id = p.participant " +
        "AND d.content = v_content AND d.created_at > now() - interval '10 minutes') ON CONFLICT DO NOTHING;";
      expect(brakeGaps(windowOnly)).toEqual([expect.stringContaining("no latest-notice check"), expect.stringContaining("no per-recipient cap")]);
    });

    it("on a caller gate that the write firing the notice does not carry", () => {
      const noJobsGate = new Map([...ctx.triggers].filter(([k]) => k !== "jobs.trg_ban_gate_jobs_update"));
      expect(CLEARED.enforce_ban_gate.offenders(context(ctx.defs, noJobsGate))).toEqual([
        expect.stringContaining("enforce_ban_gate: not on jobs BEFORE UPDATE"),
      ]);
      // ...and on a dynamic attach whose loop excludes the table.
      const excluded = new Map(ctx.triggers);
      for (const [k, t] of excluded) if (t.fn === "refuse_unconfirmed_email_write") excluded.set(k, { ...t, excludes: [...t.excludes, "jobs"] });
      expect(CLEARED.refuse_unconfirmed_email_write.offenders(context(ctx.defs, excluded))).toEqual([
        expect.stringContaining("refuse_unconfirmed_email_write: not on jobs BEFORE UPDATE"),
      ]);
    });
  });
});

// Round-3 lh-authz-rls review of Q1169: the 6-per-10-minutes cap never holds
// back a FINAL state (cancelled, completed), or a capped one leaves the thread
// showing a live job. Behaviour: src/test/pglite/messageRateSparesStatusNotices.pglite.mjs L12.
// @mutate supabase/migrations/20261004001242_messages_status_notices_and_sender_writes.sql |       NEW.status::text IN ('cancelled', 'completed')\n      OR ( |       false\n      OR (
describe("the status-notice cap spares a final state (Q1169 round 3)", () => {
  it("insert_job_status_system_message's cap is OR'd with cancelled/completed", () => {
    const d = effectiveDefs(MIG).get("insert_job_status_system_message");
    expect(d).toBeDefined();
    const body = d!.stmt.replace(/--[^\n]*/g, "");
    expect(body).toMatch(/NEW\.status::text IN \('cancelled', 'completed'\)\s*OR \(\s*SELECT count\(\*\) FROM messages d/);
  });
});
