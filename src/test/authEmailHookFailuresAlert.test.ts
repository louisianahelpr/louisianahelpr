/**
 * ED-002: auth-email-hook failed silently to ops — no Slack alert on a missing
 * secret, a bad signature, a bad payload, an unknown email type, a failed
 * enqueue or a thrown handler. A systemic failure there blocks every signup
 * confirmation and password reset. Every console.error in the hook is a
 * failure branch, and each must raise an alert on the next line.
 *
 * @mutate supabase/functions/auth-email-hook/index.ts | await alertAuthEmail('enqueue failed', | void ('enqueue failed',
 * @mutate supabase/functions/auth-email-hook/index.ts | await alertAuthEmail('secret missing', | void ('secret missing',
 * @mutate supabase/functions/auth-email-hook/index.ts | const { error: pendingLogError } = await supabase.from('email_send_log') | const { data: pendingLogError } = await supabase.from('email_send_log')
 *
 * Q826 (from cloud/q206-perf): both email_send_log inserts were bare awaits
 * that dropped their error. A write whose result is discarded is the same
 * silent failure, so no statement in the hook may start with a bare
 * `await supabase.` — the error must be destructured and handled.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankNonCode } from "./helpers/blankNonCode";

const src = readFileSync("supabase/functions/auth-email-hook/index.ts", "utf8");
const lines = src.split("\n");
const failures = lines.flatMap((l, i) => (/^\s*console\.error\(/.test(l) ? [i] : []));

describe("auth-email-hook alerts ops on every failure (ED-002)", () => {
  it("the inventory is real", () => expect(failures.length).toBeGreaterThanOrEqual(8));
  it("each console.error is followed by an alert", () => {
    const silent = failures.filter((i) => !/await alertAuthEmail\(/.test(lines[i + 1] ?? "")).map((i) => `line ${i + 1}`);
    expect(silent).toEqual([]);
  });
  it("no Supabase call discards its result (Q826)", () => {
    const code = blankNonCode(src);
    const found = unhandledSupabaseCalls(code);
    expect(found.total).toBeGreaterThanOrEqual(3);
    expect(found.problems).toEqual([]);
  });
  it("the Q826 checker can fail (fixtures)", () => {
    const ok = "const supabase = createClient(u, k)\nconst { error: e1 } = await supabase.from('t').insert({})\nif (e1) {}";
    expect(unhandledSupabaseCalls(ok).problems).toEqual([]);
    for (const bad of [
      "const supabase = createClient(u, k)\nawait supabase.from('t').insert({})",
      "const supabase = createClient(u, k)\nconst { data } = await supabase.from('t').select()",
      "const supabase = createClient(u, k)\nvoid supabase.from('t').insert({})",
      "const supabase = createClient(u, k)\nconst { error: e1 } = await supabase\n  .from('t').insert({})",
      "const supabase = createClient(u, k)\nconst db = supabase",
      "const supabase = createClient(u, k)\nawait Promise.all([supabase.from('t').insert({})])",
      "const supabase = createClient(u, k)\nconst { error: e1 } = await supabase.from('t').insert({})",
    ]) {
      expect(unhandledSupabaseCalls(bad).problems, bad).not.toEqual([]);
    }
  });
});

/**
 * Every use of the client must be `const { error: X } = await supabase.<call>`
 * on one line, and X must then be checked with `if (X)`. Anything else (a bare
 * await, a destructure without error, fire-and-forget, an alias, a call inside
 * Promise.all, a chain split across lines) is reported.
 */
function unhandledSupabaseCalls(code: string): { total: number; problems: string[] } {
  const problems: string[] = [];
  let total = 0;
  code.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/\bsupabase\b/g)) {
      const at = m.index ?? 0;
      if (/\bconst\s+supabase\s*=\s*createClient\(/.test(line)) continue;
      total++;
      const ok = line.slice(0, at + "supabase".length + 1).match(/const\s*\{\s*error\s*:\s*(\w+)\s*\}\s*=\s*await\s+supabase\.$/);
      if (!ok || !/^\w/.test(line.slice(at + "supabase.".length))) {
        problems.push(`line ${i + 1}: ${line.trim()}`);
        continue;
      }
      if (!new RegExp(`\\bif\\s*\\(\\s*${ok[1]}\\s*\\)`).test(code)) problems.push(`line ${i + 1}: ${ok[1]} is never checked`);
    }
  });
  return { total, problems };
}
