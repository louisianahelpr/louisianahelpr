/**
 * CLASS GUARD (docs/OPEN.md Q262, receiver half): a message's receiver can be
 * a deleted account. Owner decision 2026-09-24: what a surviving user sent TO
 * an account that is then deleted is KEPT, so `messages.receiver_id` is
 * nullable with `messages_receiver_id_fkey ... ON DELETE SET NULL`
 * (supabase/migrations/20260924013306_messages_receiver_set_null.sql).
 *
 * The class is "code that assumes the other party of a thread exists":
 *   1. the schema really is SET NULL + nullable (newest migration wins);
 *   2. the client types say so (a non-null type lets every reader skip it);
 *   3. every PostgREST pair filter on receiver_id is inventoried from source:
 *      an interpolated `receiver_id.eq.${...}` is only allowed where the id is
 *      provably a live user (KNOWN_EQ, exact both ways); a conversation's
 *      other party goes through threadPairFilter, which uses `is.null`;
 *   4. no null other party is coalesced to "" outside the exact KNOWN list;
 *   5. the composer and the send path refuse a thread with nobody to receive.
 *
 * Proof of the DB behaviour: src/test/pglite/messagesReceiverSetNull.pglite.mjs.
 *
 * @mutate src/lib/deletedCounterparty.ts | and(sender_id.eq.${me},receiver_id.is.null),is_system.eq.true | and(sender_id.eq.${me},receiver_id.eq.${other}),is_system.eq.true
 * @mutate src/components/messages/chatView/ChatComposer.tsx | if (activeConvo.otherUserId === null) { | if (false) {
 * @mutate src/pages/messages/messagesData/sendHandlers.ts | if (receiverId === null) { | if (false) {
 * @mutate supabase/migrations/20260924013306_messages_receiver_set_null.sql | REFERENCES auth.users(id) ON DELETE SET NULL; | REFERENCES auth.users(id) ON DELETE CASCADE;
 * @mutate src/pages/messages/useMessagesData.ts | .or(threadPairFilter(userId, activeConvo.otherUserId)) | .or(`and(sender_id.eq.${userId},receiver_id.eq.${activeConvo.otherUserId})`)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { threadPairFilter } from "@/lib/deletedCounterparty";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "__tests__" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(relative(ROOT, p));
    }
  }
  return out;
}
const SOURCES = walk(join(ROOT, "src"));

// Every interpolated `receiver_id.eq.${...}` in app source, by file:expr.
// Each id here is provably a live user; anything else must use threadPairFilter.
// @two-way src/test/messagesReceiverNullable.test.ts:KNOWN_EQ lists no site that no longer exists
const KNOWN_EQ: Record<string, string> = {
  "src/lib/deletedCounterparty.ts:other": "the non-null branch of threadPairFilter itself",
  "src/lib/deletedCounterparty.ts:me": "the signed-in viewer",
  "src/pages/messages/messagesData/loadConversations.ts:uid": "the signed-in viewer's own inbox",
  "src/pages/userProfile/useUserProfileData.ts:userId": "a profile page's subject, a live user",
  "src/pages/userProfile/useUserProfileData.ts:currentUserId": "the signed-in viewer",
};

// Every `otherUserId ?? ""` / `|| ""`: allowed only where the "" feeds a falsy
// early return, never a comparison.
// @two-way src/test/messagesReceiverNullable.test.ts:KNOWN_COALESCE lists no site that no longer exists
const KNOWN_COALESCE: Record<string, string> = {
  "src/lib/recipientGate.ts": "the effect returns on !otherUserId before any use",
  "src/pages/Messages.tsx": "useChatPresence returns on a falsy otherUserId",
};

describe("messages.receiver_id may be a deleted account (Q262)", () => {
  it("the newest migration defining messages_receiver_id_fkey makes it ON DELETE SET NULL, and receiver_id stays nullable", () => {
    const dir = join(ROOT, "supabase", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    let fkRule: string | null = null;
    let nullable = false;
    let fkFiles = 0;
    for (const f of files) {
      const sql = blankSqlComments(readFileSync(join(dir, f), "utf8"));
      const fk = /messages_receiver_id_fkey\s+FOREIGN KEY\s*\(receiver_id\)\s*REFERENCES\s+auth\.users\s*\(id\)\s*ON DELETE\s+(SET NULL|CASCADE|RESTRICT|NO ACTION)/i.exec(sql);
      if (fk) {
        fkRule = fk[1].toUpperCase();
        fkFiles++;
      }
      if (/ALTER TABLE\s+(public\.)?messages\s+ALTER COLUMN\s+receiver_id\s+DROP NOT NULL/i.test(sql)) nullable = true;
      if (/ALTER TABLE\s+(public\.)?messages\s+ALTER COLUMN\s+receiver_id\s+SET NOT NULL/i.test(sql)) nullable = false;
    }
    expect(fkFiles).toBeGreaterThanOrEqual(1);
    expect(fkRule).toBe("SET NULL");
    expect(nullable).toBe(true);
  });

  it("the client types admit a null receiver and a null other party", () => {
    const gen = read("src/integrations/supabase/types.ts");
    const block = gen.slice(gen.indexOf("      messages: {"), gen.indexOf("Relationships", gen.indexOf("      messages: {")));
    expect(block.match(/receiver_id\??: string \| null/g)?.length).toBe(3);
    const t = read("src/components/messages/types.ts");
    expect(t).toMatch(/receiver_id: string \| null;/);
    expect(t).toMatch(/otherUserId: string \| null;/);
  });

  it("threadPairFilter asks for `receiver_id.is.null` when the other party is gone", () => {
    const f = threadPairFilter("me", null);
    expect(f).toContain("receiver_id.is.null");
    expect(f).not.toMatch(/\.eq\.(null|undefined|)(,|\))/);
    expect(threadPairFilter("me", "you")).toContain("receiver_id.eq.you");
  });

  it("every interpolated receiver_id.eq filter is inventoried (exact both ways)", () => {
    const found = new Set<string>();
    for (const rel of SOURCES) {
      const src = blankComments(read(rel));
      for (const m of src.matchAll(/receiver_id\.eq\.\$\{([^}]+)\}/g)) found.add(`${rel}:${m[1].trim()}`);
    }
    // Floor: the inventory must actually find the sites it exists to police.
    expect(found.size).toBeGreaterThanOrEqual(5);
    const unknown = [...found].filter((k) => !(k in KNOWN_EQ));
    expect(unknown, "a receiver_id.eq pair filter on an id that may be a deleted account: use threadPairFilter").toEqual([]);
    const stale = Object.keys(KNOWN_EQ).filter((k) => !found.has(k));
    expect(stale, "KNOWN_EQ lists a site that no longer exists: remove it").toEqual([]);
  });

  it("the Messages thread loads through threadPairFilter (open, refresh, load older)", () => {
    const src = blankComments(read("src/pages/messages/useMessagesData.ts"));
    expect(src.match(/\.or\(threadPairFilter\(/g)?.length).toBe(3);
  });

  it("no other party is coalesced to \"\" outside KNOWN_COALESCE (exact both ways)", () => {
    const found = new Set<string>();
    for (const rel of SOURCES) {
      const src = blankComments(read(rel));
      if (/otherUserId\s*(\?\?|\|\|)\s*""/.test(src)) found.add(rel);
    }
    expect(found.size).toBeGreaterThanOrEqual(1);
    expect([...found].filter((k) => !(k in KNOWN_COALESCE))).toEqual([]);
    expect(Object.keys(KNOWN_COALESCE).filter((k) => !found.has(k))).toEqual([]);
  });

  it("a thread with nobody to receive is read-only: the composer shows the notice and the send path refuses", () => {
    const composer = blankComments(read("src/components/messages/chatView/ChatComposer.tsx"));
    expect(composer).toMatch(/if \(activeConvo\.otherUserId === null\) \{[\s\S]{0,1200}DELETED_ACCOUNT_NOTICE/);
    const send = blankComments(read("src/pages/messages/messagesData/sendHandlers.ts"));
    expect(send).toMatch(/if \(receiverId === null\) \{[\s\S]{0,400}sendStatus: "refused"[\s\S]{0,200}return;/);
    expect(send).toMatch(/if \(activeConvo\.otherUserId === null\) return false;/);
  });
});
