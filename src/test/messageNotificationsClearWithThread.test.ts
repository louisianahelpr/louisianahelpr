/*
 * CLASS CHECK — a chat message's bell notification is cleared when its thread
 * is read (Q755, owner decision 2026-09-27: "Mark read with thread").
 *
 * FOUND 2026-09-27. notify_message_recipient writes a type='message'
 * notifications row per message, but reading a thread only set messages.read,
 * so the bell and the app-icon badge kept counting read messages. Measured
 * live: 221 unread type='message' notifications.
 *
 * THE CHECK. Every function as the database runs it (effectiveDefs replays
 * every migration, rewrites included) that inserts a type='message'
 * notification writes its link as one of the thread-link shapes the mark-read
 * trigger function matches, and that function is fired AFTER UPDATE OF read
 * ON messages. Producers are found from the migrations, not from a list.
 *
 * Shown red (2026-09-27) with the trigger function's pair-link match changed.
 *
 * @mutate supabase/migrations/20261009142834_team_thread_direct_messages.sql | n.link = '/messages?jobId=' \|\| COALESCE(NEW.job_id::text, '') \|\| '&userId=' \|\| COALESCE(NEW.sender_id::text, '') | n.link = '/messages?jobId=' \|\| COALESCE(NEW.job_id::text, '') \|\| '&user=' \|\| COALESCE(NEW.sender_id::text, '')
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIGRATIONS = resolve(__dirname, "..", "..", "supabase", "migrations");
const norm = (s: string) => s.replace(/\s+/g, " ").replace(/\bpublic\./gi, "").toLowerCase();

/** The link shapes, as SQL expressions over NEW, that the mark-read function matches. */
const PAIR = norm(`'/messages?jobId=' || COALESCE(NEW.job_id::text, '') || '&userId=' || COALESCE(NEW.sender_id::text, '')`);
const JOB_ONLY = norm(`'/messages?jobId=' || NEW.job_id::text`);

describe("a message notification is cleared when its thread is read (Q755)", () => {
  const defs = [...effectiveDefs(MIGRATIONS)];
  const marker = defs.find(([fn]) => fn.startsWith("mark_message_notifications_read"));
  const producers = defs.filter(([, d]) => {
    const b = blankSqlComments(d.stmt);
    return /\binsert\s+into\s+(?:public\.)?notifications\b/i.test(b) && /'message'/.test(b) && /\bNEW\.sender_id\b/i.test(b);
  });

  it("finds the producer and the mark-read function (not vacuous)", () => {
    expect(defs.length).toBeGreaterThan(100);
    expect(producers.length).toBeGreaterThan(0);
    expect(marker).toBeTruthy();
    expect(producers.some(([fn]) => fn.startsWith("notify_message_recipient"))).toBe(true);
  });

  it("the mark-read function matches both thread-link shapes", () => {
    const body = norm(blankSqlComments(marker![1].stmt));
    expect(body).toContain(`n.link = ${PAIR}`);
    expect(body).toContain(`n.link = ${JOB_ONLY}`);
  });

  it("every producer's link is a shape the mark-read function matches", () => {
    const bad = producers
      .filter(([, d]) => {
        const b = norm(blankSqlComments(d.stmt));
        return !b.includes(PAIR) && !b.includes(JOB_ONLY);
      })
      .map(([fn]) => fn);
    expect(bad).toEqual([]);
  });

  it("the function fires AFTER UPDATE OF read ON messages", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(100);
    const all = files
      .map((f) => norm(blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"))))
      .join("\n");
    expect(all).toMatch(
      /create trigger \w+ after update of read on messages for each row when \(new\.read and not old\.read\) execute function mark_message_notifications_read\(\)/,
    );
  });
});
