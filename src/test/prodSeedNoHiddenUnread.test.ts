/**
 * POSTER-E2E'S INBOX HAS NO HIDDEN UNREAD THREAD WHEN THE AUDIT MEASURES IT.
 *
 * prod-audit 39008504928 (2026-10-17) went red three ways on ONE unread message
 * helper-e2e sent poster-e2e at 06:34:51Z on completed journey job c92f73d5:
 * the inbox's hidden-unread bar showed, so page-settle 375 /messages measured
 * cls 0.0394, web-vitals mobile /messages LCP 6152 ms (the bar's text) and
 * shell-spacing found the bar + list stack ([18]). Anything can message a
 * shared account, so the seed that runs before every leg puts the state back
 * (scripts/audit/prod-seed.mjs restoreNoHiddenUnread), the same way it empties
 * the admin seed inbox (prodSeedRestoresEmptyInbox.test.ts).
 *
 * @mutate scripts/audit/prod-seed.mjs |   await restoreNoHiddenUnread(posterId); |   void restoreNoHiddenUnread;
 * @mutate scripts/audit/prod-seed.mjs | const LIVE_JOB_STATUSES = ["accepted", "in_progress", | const LIVE_JOB_STATUSES = ["in_progress",
 * @mutate scripts/audit/prod-seed.mjs | (j) => j.is_seed === true && !LIVE_JOB_STATUSES | (j) => !LIVE_JOB_STATUSES
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const SEED = blankComments(readFileSync(resolve(ROOT, "scripts/audit/prod-seed.mjs"), "utf8"));
const LIVE_SRC = blankComments(readFileSync(resolve(ROOT, "src/components/messages/liveThread.ts"), "utf8"));
const LIST_SRC = blankComments(readFileSync(resolve(ROOT, "src/components/messages/ConversationList.tsx"), "utf8"));

const quoted = (s: string) => [...s.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();

describe("prod-seed clears poster-e2e's hidden unread threads", () => {
  const fn = SEED.slice(SEED.indexOf("async function restoreNoHiddenUnread("), SEED.indexOf("async function apply()"));

  it("apply() runs it for the poster after the accounts exist", () => {
    const apply = SEED.slice(SEED.indexOf("async function apply()"));
    const poster = apply.indexOf("const posterId = await requireSeed(POSTER.email);");
    const call = apply.indexOf("await restoreNoHiddenUnread(posterId);");
    expect(poster).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(poster);
  });

  it("'hidden' is the inbox's own rule: the same live statuses as liveThread.ts, which the bar's count uses", () => {
    const seedList = /const LIVE_JOB_STATUSES = \[([^\]]*)\]/.exec(SEED)?.[1] ?? "";
    const appList = /const LIVE_JOB_STATUSES = new Set\(\[([^\]]*)\]\)/.exec(LIVE_SRC)?.[1] ?? "";
    expect(quoted(appList).length, "liveThread.ts's LIVE_JOB_STATUSES no longer parses").toBeGreaterThan(3);
    expect(quoted(seedList)).toEqual(quoted(appList));
    expect(LIST_SRC, "the bar's count no longer comes from isLiveThread").toMatch(/c\.unread > 0 && !isLiveThread\(c\)/);
  });

  it("touches only seed jobs and seed senders, never a team thread, and reads the write back by count", () => {
    expect(fn).toMatch(/receiver_id=eq\.\$\{posterId\}&read=eq\.false&team_thread_user_id=is\.null/);
    expect(fn).toMatch(/j\.is_seed === true && !LIVE_JOB_STATUSES\.includes\(j\.status\)/);
    expect(fn).toMatch(/is_seed=is\.true/);
    expect(fn).toMatch(/hiddenJob\.has\(m\.job_id\) && seedSender\.has\(m\.sender_id\)/);
    expect(fn).toMatch(/done\.length !== ids\.length/);
  });
});
