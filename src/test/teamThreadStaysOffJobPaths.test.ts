import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import {
  isTeamThreadKey,
  normalizeMessageRow,
  teamThreadKey,
  teamThreadLink,
  teamUserIdFromKey,
} from "@/lib/teamThread";

// The "Louisiana Helpr Team" thread (owner, 2026-10-09: an admin messages a
// user directly from the User Profile dialog; two-way). Its rows have NO job:
// messages.job_id IS NULL, team_thread_user_id = the user
// (supabase/migrations/20261009223503_team_thread_direct_messages.sql). The
// client carries such a thread under a sentinel `team:<user>` job key.
//
// THE CLASS this guards: a job-less thread reaching a path keyed on a job.
// Four layers, each checked below:
//   1. the key itself (pure behaviour of src/lib/teamThread.ts);
//   2. every src/lib writer that takes a thread's `jobId` and writes a
//      job-keyed thread table (thread_archives, thread_pins, thread_mutes,
//      message_reactions) or RPC must refuse a team key before it touches
//      Supabase — inventory built from src/lib itself, floor 6;
//   3. the Messages page reads a thread only through `threadRows`, and sends a
//      team message through the RPCs, never the job INSERT;
//   4. the server: only an admin may open a thread, and a reply can only ever
//      land in the caller's own thread.
// @mutate src/lib/archivedConversations.ts | if (!userId \|\| isTeamThreadKey(jobId)) return;\n  const key = conversationKey(jobId, otherUserId);\n  const archivedAt | if (!userId) return;\n  const key = conversationKey(jobId, otherUserId);\n  const archivedAt
// @mutate src/lib/threadMutes.ts | if (isTeamThreadKey(jobId)) return false; | if (false) return false;
// @mutate src/pages/messages/messagesData/sendHandlers.ts | if (teamUser !== null) {\n      await dispatchTeamMessage(optimistic, teamUser); | if (false) {\n      await dispatchTeamMessage(optimistic, teamUser);
// @mutate supabase/migrations/20261009223503_team_thread_direct_messages.sql |    WHERE m.team_thread_user_id = v_me\n |    WHERE true\n
// @mutate supabase/migrations/20261009223503_team_thread_direct_messages.sql | IF NOT COALESCE(public.has_role(v_admin, 'admin'::public.app_role), false) THEN | IF false THEN

const REPO = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");
const U = "11111111-2222-3333-4444-555555555555";

describe("team thread key (src/lib/teamThread.ts)", () => {
  it("is never a uuid, round-trips, and links by the user", () => {
    const key = teamThreadKey(U);
    expect(isTeamThreadKey(key)).toBe(true);
    expect(/^[0-9a-f-]{36}$/i.test(key)).toBe(false);
    expect(teamUserIdFromKey(key)).toBe(U);
    expect(isTeamThreadKey(U)).toBe(false);
    expect(teamUserIdFromKey(U)).toBeNull();
    expect(teamThreadLink(U)).toBe(`/messages?teamThread=${U}`);
  });

  it("normalizes a job-less row to its key and leaves a job row alone", () => {
    expect(normalizeMessageRow({ job_id: null, team_thread_user_id: U }).job_id).toBe(teamThreadKey(U));
    const jobRow = { job_id: "job-1", team_thread_user_id: null };
    expect(normalizeMessageRow(jobRow)).toBe(jobRow);
  });
});

/** Exported functions in `text` (comment-blanked), with their parameter list and body. */
function exportedFunctions(text: string): { name: string; params: string; body: string }[] {
  const out: { name: string; params: string; body: string }[] = [];
  const re = /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)[^{]*\{/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
    }
    out.push({ name: m[1], params: m[2], body: text.slice(m.index + m[0].length, i) });
  }
  return out;
}

const JOB_KEYED_WRITE =
  /\.from\(\s*["'](?:thread_archives|thread_pins|thread_mutes|message_reactions)["']\s*\)[\s\S]{0,200}?\.(?:insert|upsert|delete|update)\(|\.rpc\(\s*["'](?:toggle_thread_mute|set_thread_snooze|clear_thread_mute)["']/;

describe("job-keyed thread writers refuse a team key", () => {
  const writers: { file: string; name: string; body: string }[] = [];
  for (const file of trackedFiles("src/lib").filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))) {
    const text = blankComments(read(file));
    for (const fn of exportedFunctions(text)) {
      if (!/\bjobId\b/.test(fn.params)) continue;
      // The write may sit in a helper the function awaits; the body is enough
      // for every writer today, and a writer the scan cannot see fails the floor.
      if (JOB_KEYED_WRITE.test(fn.body)) writers.push({ file, name: fn.name, body: fn.body });
    }
  }

  it("finds the writers (inventory floor)", () => {
    // archiveConversation, unarchiveConversation, togglePinned,
    // toggleThreadMute, snoozeThread, unmuteThread.
    expect(writers.length).toBeGreaterThan(5);
  });

  it("each returns on isTeamThreadKey(jobId) before its first Supabase call", () => {
    const bad = writers
      .filter((w) => {
        const guard = w.body.search(/isTeamThreadKey\(\s*jobId\s*\)/);
        const firstCall = w.body.search(/\bsupabase\b/);
        return guard === -1 || (firstCall !== -1 && guard > firstCall);
      })
      .map((w) => `${w.file}: ${w.name}`);
    expect(bad).toEqual([]);
  });
});

describe("the Messages page keeps team threads off job paths", () => {
  it("reads a thread only through threadRows (the one place that tells job from team)", () => {
    const src = blankComments(read("src/pages/messages/useMessagesData.ts"));
    // One `.eq("job_id"` on messages: the job branch inside threadRows.
    expect(src.match(/\.eq\(\s*"job_id"/g)?.length).toBe(1);
    expect(src).toMatch(/function threadRows\([\s\S]*?\.is\("job_id", null\)\.eq\("team_thread_user_id", teamUser\)/);
  });

  it("sends a team message through the RPCs, before the job INSERT can run", () => {
    const src = blankComments(read("src/pages/messages/messagesData/sendHandlers.ts"));
    // The branch itself, condition included: a team key returns into the RPC
    // path and never falls through to the INSERT below it.
    const branch = src.search(
      /const teamUser = teamUserIdFromKey\(optimistic\.job_id\);\s*if \(teamUser !== null\) \{\s*await dispatchTeamMessage\(optimistic, teamUser\);\s*return;\s*\}/,
    );
    const insert = src.search(/\.from\("messages"\)\s*\.insert\(/);
    expect(branch).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(insert);
    expect(src).toMatch(/supabase\.rpc\("send_team_reply"/);
    expect(src).toMatch(/supabase\.rpc\("admin_send_team_message"/);
  });
});

describe("server: who may write a team-thread row (newest definitions)", () => {
  const defs = effectiveDefs(join(REPO, "supabase/migrations"));

  it("admin_send_team_message refuses anyone without the admin role before it writes", () => {
    const stmt = blankSqlComments(defs.get("admin_send_team_message")?.stmt ?? "");
    expect(stmt).toMatch(/SECURITY DEFINER/);
    expect(stmt).toMatch(/SET search_path/);
    const check = stmt.search(/IF NOT COALESCE\(public\.has_role\(v_admin, 'admin'::public\.app_role\), false\) THEN\s*RAISE EXCEPTION 'admin_only'/);
    const insert = stmt.search(/INSERT INTO public\.messages/);
    expect(check).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(check);
    expect(stmt).toMatch(/v_admin\s+uuid := auth\.uid\(\)/);
  });

  it("send_team_reply only ever writes the caller's own thread", () => {
    const stmt = blankSqlComments(defs.get("send_team_reply")?.stmt ?? "");
    expect(stmt).toMatch(/SECURITY DEFINER/);
    expect(stmt).toMatch(/v_me\s+uuid := auth\.uid\(\)/);
    // No thread parameter exists to forge: the signature is (content, client id).
    expect(stmt).toMatch(/send_team_reply\(\s*p_content text,\s*p_client_id uuid DEFAULT NULL\s*\)/);
    expect(stmt).toMatch(/WHERE m\.team_thread_user_id = v_me\n/);
    expect(stmt).toMatch(/VALUES \(NULL, v_me, v_me, v_admin, v_content, p_client_id\)/);
  });

  it("neither is executable by anon, and a job-less row needs a team thread", () => {
    const mig = blankSqlComments(read("supabase/migrations/20261009223503_team_thread_direct_messages.sql"));
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION public\.admin_send_team_message\(uuid, text, uuid\) FROM PUBLIC, anon;/);
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION public\.send_team_reply\(text, uuid\) FROM PUBLIC, anon;/);
    expect(mig).toMatch(/CHECK \(\(job_id IS NULL\) <> \(team_thread_user_id IS NULL\)\)/);
    // The client may read the column, never write it.
    expect(mig).toMatch(/GRANT SELECT \(team_thread_user_id\) ON public\.messages TO authenticated;/);
    expect(mig).not.toMatch(/GRANT (?:INSERT|UPDATE)[^;]*team_thread_user_id/);
  });
});
