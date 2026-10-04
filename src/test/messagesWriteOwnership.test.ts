// Q1166: the sender's branch stops keeping the receiver's receipt.
// @mutate supabase/migrations/20261004001242_messages_status_notices_and_sender_writes.sql | NEW.read    := OLD.read;\n    NEW.read_at := OLD.read_at;\n |
// Q1166: the edited stamp fires only when an UPDATE names content again.
// @mutate supabase/migrations/20261004001242_messages_status_notices_and_sender_writes.sql | BEFORE UPDATE ON public.messages\n | BEFORE UPDATE OF content ON public.messages\n
// Q1167: the sender's DELETE reaches the platform's notices again.
// @mutate supabase/migrations/20261004001242_messages_status_notices_and_sender_writes.sql | USING (((SELECT auth.uid()) = sender_id) AND (is_system = false)); | USING ((SELECT auth.uid()) = sender_id);
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles, type FnDef } from "./helpers/effectiveFunctionDefs";
import { bodyOf, triggerInventory, triggersOn, type Trg } from "./helpers/migrationTriggers";

/**
 * WHO MAY WRITE WHAT ON A MESSAGE (Q1166, Q1167).
 *
 * Q1166: "Users can edit their own sent messages" lets the sender UPDATE for 15
 * minutes, and authenticated held column UPDATE on read and edited_at as well
 * as content. So a sender could mark their own message read (the receiver's
 * unread badge stopped counting it) and erase or forge its "edited" mark
 * (trg_stamp_message_edited_at fired only on an UPDATE naming content).
 * Q1167: the platform's status notices are written in the poster's name
 * (sender_id = the poster), and "Users can delete their own sent messages"
 * did not exclude them, so the poster could delete "Dispute opened" from both
 * threads.
 *
 * THE RULES, each read from the code the migrations leave:
 *   1. Every column a client may UPDATE has ONE owner (OWNER below, two-way
 *      with the declared list in scripts/ci/client-insert-columns.sql, which
 *      messagesInsertColumnsClientScoped.test.ts holds to the client's own
 *      update payloads and the replayed grants). enforce_message_non_sender_read_only
 *      refuses a non-sender changing a sender-owned column, and its sender
 *      branch keeps OLD for a receiver-owned column and that column's stamp.
 *   2. Each owned column's stamp is the server's: a BEFORE trigger on messages
 *      that runs on EVERY update (no `OF` column list, so naming only the stamp
 *      in a PATCH cannot skip it) keeps OLD.<stamp> unless its column changed.
 *   3. Every UPDATE/DELETE policy that lets the sender in (sender_id against
 *      auth.uid()) also requires is_system = false: a notice is the platform's,
 *      whoever it is attributed to.
 *
 * Behaviour: src/test/pglite/messageReadReceiptIsTheReceivers.pglite.mjs (Q1166:
 * applied 3x ALL PASS; NEW_MIGRATION=skip 6 FAILED) and
 * src/test/pglite/systemNoticesOutliveTheirSender.pglite.mjs (Q1167: applied 3x
 * ALL PASS; NEW_MIGRATION=skip 2 FAILED).
 */

const ROOT = resolve(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const FIX = "20261004001242";
const READ_ONLY_FN = "enforce_message_non_sender_read_only";

/** Each client-updatable column of messages: who writes it, and the server stamp that records it. */
const OWNER: Record<string, { owner: "sender" | "receiver"; stamp: string }> = {
  content: { owner: "sender", stamp: "edited_at" }, // the sender's edit, inside the edit policy's 15 minutes
  read: { owner: "receiver", stamp: "read_at" }, // the receiver's receipt
};

/** authenticated's declared UPDATE columns on messages, from the shared live check. */
function declaredUpdateColumns(): string[] {
  const sql = blankSqlComments(readFileSync(join(ROOT, "scripts/ci/client-insert-columns.sql"), "utf8"));
  const m = /\(\s*'messages'\s*,\s*'authenticated'\s*,\s*'UPDATE'\s*,\s*ARRAY\[([^\]]*)\]::text\[\]\s*\)/.exec(sql);
  return m ? [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort() : [];
}

type Policy = { name: string; cmd: string; using: string; check: string };

/** The balanced `( … )` that follows `kw` in `text`, or "". */
function clause(text: string, kw: RegExp): string {
  const m = kw.exec(text);
  if (!m) return "";
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(m.index + m[0].length, i).replace(/\s+/g, " ").trim();
  }
  return "";
}

/** The policies the migrations leave on public.<table> (CREATE / ALTER / DROP POLICY, in order). */
export function policiesOn(files: { name: string; sql: string }[], table: string): Map<string, Policy> {
  const out = new Map<string, Policy>();
  const STMT = /\b(CREATE|ALTER|DROP)\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+(?:public\.)?(\w+)\b([^;]*)/gi;
  for (const f of files) {
    for (const m of blankSqlComments(f.sql).matchAll(STMT)) {
      if (m[3].toLowerCase() !== table) continue;
      const [verb, name, rest] = [m[1].toUpperCase(), m[2], m[4]];
      if (verb === "DROP") { out.delete(name); continue; }
      const using = clause(rest, /\bUSING\s*\(/i);
      const check = clause(rest, /\bWITH\s+CHECK\s*\(/i);
      if (verb === "CREATE") {
        out.set(name, { name, cmd: (/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(rest)?.[1] ?? "ALL").toUpperCase(), using, check });
        continue;
      }
      const cur = out.get(name);
      if (!cur) continue;
      const renamed = /\bRENAME\s+TO\s+"([^"]+)"/i.exec(rest)?.[1];
      const next = { ...cur, using: using || cur.using, check: check || cur.check, name: renamed ?? name };
      out.delete(name);
      out.set(next.name, next);
    }
  }
  return out;
}

/** Why the column-ownership rules (1, 2) fail on these definitions; [] = they hold. */
function ownershipOffenders(defs: Map<string, FnDef>, triggers: Map<string, Trg>): string[] {
  const out: string[] = [];
  const body = bodyOf(defs.get(READ_ONLY_FN)?.stmt ?? "");
  const branch = /\bIF\s+auth\.uid\(\)\s*=\s*OLD\.sender_id\s+THEN([\s\S]*?)\bRETURN\s+NEW\s*;\s*END\s+IF\s*;/i.exec(body);
  if (!branch) return [`${READ_ONLY_FN}: no sender branch (IF auth.uid() = OLD.sender_id THEN ... RETURN NEW; END IF;)`];
  const refusal = body.slice(branch.index + branch[0].length);
  const keeps = (col: string) => new RegExp(String.raw`\bNEW\.${col}\s*:=\s*OLD\.${col}\s*;`, "i").test(branch[1]);
  for (const [col, { owner, stamp }] of Object.entries(OWNER)) {
    if (owner === "sender" && !new RegExp(String.raw`\bNEW\.${col}\s+IS\s+DISTINCT\s+FROM\s+OLD\.${col}\b[\s\S]*\bRAISE\s+EXCEPTION\b`, "i").test(refusal))
      out.push(`${READ_ONLY_FN}: a non-sender's change to ${col} (the sender's) is not refused`);
    if (owner === "receiver") {
      if (!keeps(col)) out.push(`${READ_ONLY_FN}: the sender branch does not keep OLD.${col} (the receiver's)`);
      if (!keeps(stamp)) out.push(`${READ_ONLY_FN}: the sender branch does not keep OLD.${stamp} (the receiver's ${col} stamp)`);
    }
    const stampers = triggersOn(triggers, "messages").filter(
      (t) => t.timing === "BEFORE" && new RegExp(String.raw`\bNEW\.${stamp}\s*:=\s*OLD\.${stamp}\b`, "i").test(bodyOf(defs.get(t.fn)?.stmt ?? "")),
    );
    if (!stampers.length) out.push(`${stamp}: no BEFORE trigger on messages keeps OLD.${stamp}`);
    for (const t of stampers)
      if (!/(^|\bOR\s)UPDATE(\s+OR\b|$)/.test(t.events)) out.push(`${t.name}: stamps ${stamp} only on "${t.events}", so a PATCH that names only ${stamp} skips it`);
  }
  return out;
}

/** Why rule 3 fails: the sender-keyed UPDATE/DELETE policies that reach a notice. */
function senderPolicyOffenders(policies: Map<string, Policy>): string[] {
  return senderWritePolicies(policies)
    .filter((p) => !/\bis_system\s*=\s*false\b/i.test(p.using))
    .map((p) => `"${p.name}" (${p.cmd}) lets the sender reach a platform notice: USING (${p.using})`);
}

function senderWritePolicies(policies: Map<string, Policy>): Policy[] {
  return [...policies.values()].filter(
    (p) => ["UPDATE", "DELETE", "ALL"].includes(p.cmd) && /auth\.uid\(\)[^=]*\)?\s*=\s*sender_id\b|\bsender_id\s*=\s*\(?\s*(?:SELECT\s+)?auth\.uid\(\)/i.test(p.using),
  );
}

const files = () => migrationFiles(MIG).map((name) => ({ name, sql: readFileSync(join(MIG, name), "utf8") }));

describe("who may write what on a message (Q1166, Q1167)", () => {
  const all = files();
  const defs = effectiveDefs(MIG);
  const triggers = triggerInventory(all);
  const policies = policiesOn(all, "messages");

  it("the inventory is real", () => {
    expect(declaredUpdateColumns().length).toBeGreaterThan(1);
    expect(defs.get(READ_ONLY_FN), `no migration defines ${READ_ONLY_FN}`).toBeDefined();
    expect(triggersOn(triggers, "messages").length).toBeGreaterThan(12);
    // 7 on prod's pg_policies, 2026-10-03; this replay finds the same 7 names.
    expect(policies.size).toBeGreaterThan(5);
    expect(senderWritePolicies(policies).map((p) => p.name).sort()).toEqual(
      expect.arrayContaining(["Users can delete their own sent messages", "Users can edit their own sent messages"]),
    );
  });

  it("every client-updatable column has one owner (two-way with the declared UPDATE list)", () => {
    expect(Object.keys(OWNER).sort(), "scripts/ci/client-insert-columns.sql grants a column nobody owns here, or the reverse").toEqual(declaredUpdateColumns());
  });

  it("the trigger keeps each column to its owner, and each stamp is the server's on every UPDATE", () => {
    expect(ownershipOffenders(defs, triggers)).toEqual([]);
  });

  it("no sender-keyed UPDATE or DELETE policy reaches a platform notice", () => {
    expect(senderPolicyOffenders(policies)).toEqual([]);
  });

  describe("the guard can fail", () => {
    const before = all.filter((f) => f.name < FIX);

    it("on prod's state before 20261004001242: the sender keeps the receipt, the edited stamp skips, the DELETE reaches notices", () => {
      expect(ownershipOffenders(effectiveDefs(MIG, { before: FIX }), triggerInventory(before))).toEqual([
        `trg_stamp_message_edited_at: stamps edited_at only on "UPDATE OF CONTENT", so a PATCH that names only edited_at skips it`,
        `${READ_ONLY_FN}: the sender branch does not keep OLD.read (the receiver's)`,
        `${READ_ONLY_FN}: the sender branch does not keep OLD.read_at (the receiver's read stamp)`,
      ]);
      expect(senderPolicyOffenders(policiesOn(before, "messages"))).toEqual([
        expect.stringContaining(`"Users can delete their own sent messages" (DELETE)`),
      ]);
    });

    it("on a sender-owned column the trigger stops refusing, and on an UPDATE policy without the notice test", () => {
      const defs2 = new Map(defs);
      const cur = defs.get(READ_ONLY_FN)!;
      defs2.set(READ_ONLY_FN, { ...cur, stmt: cur.stmt.replace(/NEW\.content\s+IS DISTINCT FROM OLD\.content\s+OR/, "") });
      expect(ownershipOffenders(defs2, triggers)).toEqual([`${READ_ONLY_FN}: a non-sender's change to content (the sender's) is not refused`]);
      const loose = policiesOn([...all, { name: "x.sql", sql: `CREATE POLICY "zz" ON public.messages FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = sender_id);` }], "messages");
      expect(senderPolicyOffenders(loose)).toEqual([expect.stringContaining(`"zz" (UPDATE)`)]);
    });
  });
});
