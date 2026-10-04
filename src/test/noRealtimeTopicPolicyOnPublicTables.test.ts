/**
 * Q1168 — no policy on a public table is decided by the realtime topic.
 *
 * A policy whose rule is `realtime.topic() ~ ...` belongs on realtime.messages
 * (where a private channel join sets the topic). On a public table it never
 * reads the row: any session that set the topic would read every row. One sat
 * on public.messages from 20260412011520 until 20261004192943 dropped it
 * (read live 2026-10-04: same name and qual as the realtime.messages copy).
 *
 * THE CLASS, derived from the migrations: replay every CREATE / ALTER / DROP
 * POLICY (comments blanked; ON realtime.* and storage.* skipped, bare names
 * are public) and fail on any surviving public-table policy whose text calls
 * realtime.topic(). Live mirror: the done-when marker on Q1168 in docs/OPEN.md.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase/migrations");

function publicPolicies(before = "99999999999999"): Map<string, string> {
  const live = new Map<string, string>();
  const NAME = String.raw`(?:"([^"]+)"|(\w+))`;
  const ON = String.raw`\s+on\s+(?:"?(\w+)"?\.)?"?(\w+)"?`;
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
    const events: { at: number; apply: () => void }[] = [];
    const key = (m: RegExpMatchArray) => `${m[4].toLowerCase()}:${m[1] ?? m[2].toLowerCase()}`;
    const isPublic = (m: RegExpMatchArray) => !m[3] || m[3].toLowerCase() === "public";
    for (const m of sql.matchAll(new RegExp(String.raw`drop\s+policy\s+(?:if\s+exists\s+)?${NAME}${ON}`, "gi"))) {
      if (isPublic(m)) events.push({ at: m.index!, apply: () => live.delete(key(m)) });
    }
    for (const m of sql.matchAll(new RegExp(String.raw`create\s+policy\s+${NAME}${ON}([^;]*);`, "gi"))) {
      if (isPublic(m)) events.push({ at: m.index!, apply: () => live.set(key(m), m[5]) });
    }
    for (const m of sql.matchAll(new RegExp(String.raw`alter\s+policy\s+${NAME}${ON}([^;]*);`, "gi"))) {
      if (isPublic(m)) events.push({ at: m.index!, apply: () => { if (live.has(key(m))) live.set(key(m), `${live.get(key(m))} ${m[5]}`); } });
    }
    events.sort((a, b) => a.at - b.at).forEach((e) => e.apply());
  }
  return live;
}

const topicPolicies = (p: Map<string, string>) => [...p].filter(([, text]) => /\brealtime\s*\.\s*topic\s*\(/i.test(text)).map(([k]) => k);

describe("Q1168: no public-table policy reads the realtime topic", () => {
  it("the replay sees the public policies", () => {
    const p = publicPolicies();
    expect(p.size).toBeGreaterThan(200);
    expect(p.has("messages:Users can view their own messages")).toBe(true);
  });

  it("none survives that is decided by realtime.topic()", () => {
    expect(topicPolicies(publicPolicies())).toEqual([]);
  });

  it("the replay can fail: before 20261004192943 public.messages carried one", () => {
    expect(topicPolicies(publicPolicies("20261004192943"))).toEqual(["messages:Users can subscribe to own channels"]);
  });
});

// @mutate supabase/migrations/20261004192943_messages_drop_realtime_topic_policy.sql | DROP POLICY IF EXISTS "Users can subscribe to own channels" ON public.messages; |
