/**
 * TEAM MESSAGES GET THROUGH A BLOCK (Q1591(b), owner pop-up 2026-10-11).
 *
 * A staff message in the "Louisiana Helpr Team" thread is delivered even when
 * the user has blocked that staff member's personal account, and the user can
 * reply in that Team thread. Personal (job) messages stay blocked.
 *
 * Every layer that applies a block to messages has to agree, or the message
 * is delivered by one and hidden by another:
 *   - SERVER: trg_enforce_block_on_message_insert refused both directions
 *     (live body 2026-10-11). Its newest definition must let a Team row
 *     through ONLY between the thread's user and an admin, sent by the caller
 *     (behaviour: src/test/pglite/teamMessagesPassBlocks.pglite.mjs, applied
 *     3x: ALL PASS; NEW_MIGRATION=skip: 5 FAILED).
 *   - CLIENT AND EDGE READERS: the CLASS. Inventory, from source: every
 *     tracked file under src/ (tests excluded) and supabase/functions that
 *     reads the block list (getBlockedUserIds( or .from('user_blocks')) AND
 *     reads public.messages. Each must exempt Team rows from its block
 *     filter: a JS filter returns early on isTeamThreadKey, a PostgREST
 *     filter ORs `team_thread_user_id.not.is.null` into its sender exclusion.
 *     The inventory is EXACT (two-way): a new block-filtered messages reader
 *     fails here until it is handled and listed.
 *   - notify_message_recipient and the notifications push fan-out never read
 *     user_blocks (prod, every public function whose source names user_blocks
 *     or are_users_blocked, 2026-10-11), so they need no change.
 *
 * @mutate supabase/migrations/20261012030525_team_messages_pass_blocks.sql | AND COALESCE(public.has_role(NEW.sender_id, 'admin'::public.app_role), false)) | AND true)
 * @mutate supabase/migrations/20261012030525_team_messages_pass_blocks.sql |      AND NEW.sender_id = auth.uid()\n | \n
 * @mutate supabase/migrations/20261012030525_team_messages_pass_blocks.sql |   IF NEW.team_thread_user_id IS NOT NULL\n | IF false\n
 * @mutate supabase/migrations/20261012030525_team_messages_pass_blocks.sql | REVOKE ALL ON FUNCTION public.enforce_block_on_message_insert() FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.enforce_block_on_message_insert() FROM PUBLIC;
 * @mutate src/lib/unreadConversations.ts |   if (isTeamThreadKey(m.job_id)) return true;\n | \n
 * @mutate src/components/mobileNav/useNavUnreadCount.ts |     const next = unreadConversationCount( |     const next = (data ?? []).filter((m: { sender_id: string }) => !blockedSet.has(m.sender_id)).length + 0 * unreadConversationCount(
 * @mutate src/pages/messages/messagesData/loadConversations.ts |   const filteredMsgs = msgs.filter((m) => inboxShowsRow(m, uid, blockedSet)); |   const filteredMsgs = msgs.filter((m) => !blockedSet.has(m.sender_id));
 * @mutate supabase/functions/send-push-notification/index.ts | ,team_thread_user_id.not.is.null` | `
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readdirSync, trackedFiles } from "./helpers/trackedFiles";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const MIG = join(ROOT, "supabase", "migrations");
const migFiles = readdirSync(MIG)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort()
  .map((f) => ({ f, sql: blankSqlComments(readFileSync(join(MIG, f), "utf8")) }));

/** Newest CREATE [OR REPLACE] FUNCTION public.<name> statement, any dollar tag. */
function newest(name: string): { file: string; body: string } {
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
  let found: { file: string; body: string } | null = null;
  for (const { f, sql } of migFiles) {
    for (const m of sql.matchAll(head)) {
      const tag = /AS\s+(\$\w*\$)/i.exec(sql.slice(m.index!))![1];
      const open = sql.indexOf(tag, m.index!);
      found = { file: f, body: sql.slice(m.index!, sql.indexOf(tag, open + tag.length) + tag.length) };
    }
  }
  expect(found, `no migration defines public.${name}`).not.toBeNull();
  return found!;
}

describe("server: the block gate lets a Team row through, scoped to the thread's user and staff", () => {
  it("reads a real migration corpus", () => {
    expect(migFiles.length).toBeGreaterThan(500);
  });

  const { file, body } = newest("enforce_block_on_message_insert");
  const bypassAt = body.search(/IF\s+NEW\.team_thread_user_id\s+IS\s+NOT\s+NULL/i);
  const blockAt = body.search(/public\.are_users_blocked\s*\(\s*NEW\.sender_id\s*,\s*NEW\.receiver_id\s*\)/i);
  const bypass = bypassAt >= 0 ? body.slice(bypassAt, body.indexOf("RETURN NEW;", bypassAt)) : "";

  it("the bypass exists, returns before the block test, and the block test still raises", () => {
    expect(bypassAt, `newest definition (${file}) has no Team-row bypass`).toBeGreaterThan(-1);
    expect(blockAt).toBeGreaterThan(bypassAt);
    expect(body.slice(blockAt)).toMatch(/RAISE\s+EXCEPTION\s+'You can''t message this user\.'/i);
    expect(body).toMatch(/IF\s+public\.is_server_context\(\)\s+THEN\s+RETURN\s+NEW;/i);
  });

  it("every scope condition is in the bypass (a non-staff user can never use it)", () => {
    for (const cond of [
      /AND\s+NEW\.job_id\s+IS\s+NULL/i,
      /AND\s+NEW\.sender_id\s*=\s*auth\.uid\(\)/i,
      // Staff side: the admin writes to the thread's user.
      /\(\s*NEW\.receiver_id\s*=\s*NEW\.team_thread_user_id\s+AND\s+NEW\.sender_id\s*<>\s*NEW\.team_thread_user_id\s+AND\s+COALESCE\(public\.has_role\(NEW\.sender_id,\s*'admin'::public\.app_role\),\s*false\)\)/i,
      // User side: the thread's user writes to an admin.
      /\(\s*NEW\.sender_id\s*=\s*NEW\.team_thread_user_id\s+AND\s+NEW\.receiver_id\s*<>\s*NEW\.team_thread_user_id\s+AND\s+COALESCE\(public\.has_role\(NEW\.receiver_id,\s*'admin'::public\.app_role\),\s*false\)\)/i,
    ]) {
      expect(bypass, String(cond)).toMatch(cond);
    }
    // Exactly the two sides, OR-ed, and nothing that widens them.
    expect(bypass.match(/\bOR\b/gi) ?? []).toHaveLength(1);
    expect(bypass).not.toMatch(/\btrue\b/i);
  });

  it("the gate stays SECURITY INVOKER and closed to every client role", () => {
    expect(body).not.toMatch(/SECURITY\s+DEFINER/i);
    const sql = migFiles.find((m) => m.f === file)!.sql;
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.enforce_block_on_message_insert\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;/i);
    expect(sql).not.toMatch(/GRANT\s+[^;]*ON\s+FUNCTION\s+public\.enforce_block_on_message_insert\(\)\s+TO\s+[^;]*\b(?:anon|authenticated|PUBLIC)\b/i);
  });
});

// ── The class: every block-filtered reader of messages exempts Team rows ────
const READS_BLOCKS = /getBlockedUserIds\s*\(|\.from\(\s*["'`]user_blocks["'`]\s*\)/;
const READS_MESSAGES = /\.from\(\s*["'`]messages["'`]\s*\)/;

function sources(): { path: string; code: string }[] {
  const src = trackedFiles("src").filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.startsWith("src/test/"));
  const fnDir = join(ROOT, "supabase", "functions");
  const edge = (readdirSync(fnDir, { recursive: true }) as string[])
    .filter((p) => /\.ts$/.test(p) && !/\.test\.ts$/.test(p))
    .map((p) => `supabase/functions/${p.split("\\").join("/")}`);
  return [...src, ...edge].map((path) => ({ path, code: blankComments(readFileSync(join(ROOT, path), "utf8")) }));
}

/** Why a block-filtered messages reader still drops Team rows, [] when it does not. */
function teamExemptionGaps(code: string): string[] {
  const gaps: string[] = [];
  // A PostgREST sender exclusion that ignores Team rows.
  if (/\.not\(\s*["'`]sender_id["'`]\s*,\s*["'`]in["'`]/.test(code)) {
    gaps.push(".not('sender_id', 'in', ...) drops Team rows from a blocked sender; use .or(`sender_id.not.in.(...),team_thread_user_id.not.is.null`)");
  }
  // The rest of the template after `sender_id.not.in.(` must end in the Team exemption.
  for (const m of code.matchAll(/sender_id\.not\.in\.\(([^`]*)`/g)) {
    if (!m[1].endsWith("),team_thread_user_id.not.is.null")) gaps.push(`sender exclusion without the Team exemption: ${m[0]}`);
  }
  // A JS filter on the blocked set must return early for a Team row.
  if (/\bblockedSet\.has\(/.test(code) && !/if\s*\(\s*isTeamThreadKey\(\s*m\.job_id\s*\)\s*\)\s*return\s+true;[\s\S]{0,600}blockedSet\.has\(/.test(code)) {
    gaps.push("blockedSet.has(...) filters messages without returning early on isTeamThreadKey(m.job_id)");
  }
  // NOID-20: the inbox and the badge delegate their hide rules to src/lib/unreadConversations.ts (checked below).
  const handled = /isTeamThreadKey\(|team_thread_user_id\.not\.is\.null|\b(?:inboxShowsRow|unreadConversationCount)\(/.test(code);
  if (!handled) gaps.push("no Team-row exemption at all");
  return gaps;
}

describe("client and edge: every block-filtered messages reader exempts Team rows (the class)", () => {
  const inventory = sources().filter(({ code }) => READS_BLOCKS.test(code) && READS_MESSAGES.test(code));

  it("the inventory is exactly the readers handled for Q1591(b) (two-way)", () => {
    expect(inventory.length).toBeGreaterThan(2);
    expect(inventory.map((s) => s.path).sort()).toEqual([
      "src/components/mobileNav/useNavUnreadCount.ts",
      "src/pages/messages/messagesData/loadConversations.ts",
      "supabase/functions/send-push-notification/index.ts",
    ]);
  });

  it("the shared hide rules the inbox and badge delegate to exempt Team rows (NOID-20)", () => {
    const code = blankComments(readFileSync(join(ROOT, "src/lib/unreadConversations.ts"), "utf8"));
    expect(code).toMatch(/blockedSet\.has\(/);
    expect(teamExemptionGaps(code)).toEqual([]);
  });

  it("each one exempts Team rows from its block filter", () => {
    const gaps = inventory.flatMap(({ path, code }) => teamExemptionGaps(code).map((g) => `${path}: ${g}`));
    expect(gaps).toEqual([]);
  });

  it("the detector is not vacuous: it flags the pre-Q1591(b) shapes", () => {
    expect(teamExemptionGaps('q = q.not("sender_id", "in", `(${ids})`);')).not.toEqual([]);
    expect(teamExemptionGaps("q = q.or(`sender_id.not.in.(${ids})`);")).not.toEqual([]);
    expect(teamExemptionGaps("return other === null || !blockedSet.has(other);")).not.toEqual([]);
    expect(teamExemptionGaps("q = q.or(`sender_id.not.in.(${ids}),team_thread_user_id.not.is.null`);")).toEqual([]);
    expect(
      teamExemptionGaps("if (isTeamThreadKey(m.job_id)) return true;\n const other = x;\n return other === null || !blockedSet.has(other);"),
    ).toEqual([]);
  });
});
