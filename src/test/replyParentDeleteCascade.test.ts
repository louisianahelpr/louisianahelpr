/**
 * Q1242 — a person can delete a message the other party replied to.
 *
 * messages_reply_to_id_fkey is ON DELETE SET NULL; its cascade UPDATEs the
 * reply inside the deleter's request, so enforce_message_non_sender_read_only
 * saw a non-sender changing reply_to_id and failed the whole DELETE.
 * 20261005063951 lets exactly the FK's own action through. This pins the
 * NEWEST definition (effectiveDefs replays every migration): every condition of
 * the carve-out, and that it sits before the non-sender refusal. It also pins
 * the FK action the carve-out is written for, from the newest migration that
 * declares it. Behaviour: src/test/pglite/replyParentDeleteCascade.pglite.mjs
 * (2 FAILED on prod's state, ALL PASS applied 3x; a client still cannot clear
 * reply_to_id or edit someone else's message).
 */
// Registered mutations - each turns this guard RED on its own:
// @mutate supabase/migrations/20261005063951_reply_parent_delete_cascade_allowed.sql |   IF pg_trigger_depth() > 1\n     AND OLD.reply_to_id IS NOT NULL | IF OLD.reply_to_id IS NOT NULL
// @mutate supabase/migrations/20261005063951_reply_parent_delete_cascade_allowed.sql |      AND NOT EXISTS (SELECT 1 FROM public.messages p WHERE p.id = OLD.reply_to_id)\n |      AND true\n
// @mutate supabase/migrations/20261005063951_reply_parent_delete_cascade_allowed.sql |      AND (to_jsonb(NEW) - 'reply_to_id') = (to_jsonb(OLD) - 'reply_to_id')\n |      AND true\n
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase/migrations");
const body = blankSqlComments(effectiveDefs(MIG).get("enforce_message_non_sender_read_only")?.stmt ?? "")
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("Q1242: the reply_to_id FK cascade is not refused as a non-sender edit", () => {
  it("the newest definition is found", () => {
    expect(body).toMatch(/security definer/);
    expect(body).toMatch(/raise exception 'a message may only be edited by the person who sent it'/);
  });

  it("the carve-out admits only the FK's own action, before the refusal", () => {
    const carve = body.search(
      /if pg_trigger_depth\(\) > 1 and old\.reply_to_id is not null and new\.reply_to_id is null and not exists \(select 1 from public\.messages p where p\.id = old\.reply_to_id\) and \(to_jsonb\(new\) - 'reply_to_id'\) = \(to_jsonb\(old\) - 'reply_to_id'\) then return new; end if;/,
    );
    const refusal = body.search(/raise exception 'a message may only be edited by the person who sent it'/);
    expect(carve, "carve-out missing or loosened").toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(carve);
  });

  it("the FK it is written for is still ON DELETE SET NULL (newest declaration)", () => {
    let action = "";
    for (const f of migrationFiles(MIG)) {
      const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
      for (const m of sql.matchAll(/reply_to_id\s+uuid\s+references\s+(?:public\.)?messages\s*\(\s*id\s*\)\s+on\s+delete\s+(set\s+null|cascade|restrict|no\s+action)/gi)) action = m[1];
      for (const m of sql.matchAll(/messages_reply_to_id_fkey[^;]*?on\s+delete\s+(set\s+null|cascade|restrict|no\s+action)/gi)) action = m[1];
    }
    expect(action.toLowerCase().replace(/\s+/g, " ")).toBe("set null");
  });
});
