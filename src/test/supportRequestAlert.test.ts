/**
 * A person asking for help must not wait for tomorrow's digest.
 *
 * 20260914183932 made #ops-alerts critical-only: anything not critical is
 * recorded in error_logs and summarised once a day at 14:40 UTC. `contact-support`
 * posted its alert as `kind: 'custom', severity: 'info'`, so from that commit a
 * support request sent at 15:00 reached the channel almost 24 hours later. The
 * support email still went out immediately — this is about the channel the owner
 * actually watches.
 *
 * The fix is a kind of its own: `support_request` is in ALWAYS_POST_KINDS (posts
 * now) and deliberately NOT in CRITICAL_KINDS (keeps ℹ️ wording and colour, so a
 * page still means something is broken), deduped per request.
 *
 * RED before the fix: with contact-support at `kind: 'custom', severity: 'info'`,
 * "the support alert posts immediately" fails — postsImmediately('info','custom')
 * is false. Reproduced by pointing SUPPORT_ALERT_FUNCTIONS_DIR at a pre-fix
 * checkout, exactly as alertPolicy.test.ts does with ALERT_POLICY_FUNCTIONS_DIR.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALWAYS_POST_KINDS,
  CRITICAL_KINDS,
  effectiveSeverity,
  postsImmediately,
  supportRequestKey,
} from "../../supabase/functions/_shared/alertPolicy";

const FUNCTIONS = process.env.SUPPORT_ALERT_FUNCTIONS_DIR ?? join(process.cwd(), "supabase", "functions");
const CONTACT_SUPPORT = join(FUNCTIONS, "contact-support", "index.ts");

/**
 * The literal `kind`/`severity` of contact-support's ops alert, read from its
 * source. Deliberately a local reader rather than an import from
 * alertPolicy.test.ts: importing that file would re-run its whole suite here.
 */
function supportCall(): { kind: string | null; severity: string | null } {
  const s = readFileSync(CONTACT_SUPPORT, "utf8");
  const calls = [...s.matchAll(/postSlackOpsAlert\(\{/g)];
  expect(calls.length, "contact-support posts exactly one ops alert").toBe(1);
  let depth = 1;
  let j = calls[0].index! + calls[0][0].length;
  while (depth && j < s.length) {
    if (s[j] === "{") depth++;
    else if (s[j] === "}") depth--;
    j++;
  }
  const body = s.slice(calls[0].index! + calls[0][0].length, j);
  const lit = (key: string) => new RegExp(`${key}:\\s*["']([\\w_]+)["']`).exec(body)?.[1] ?? null;
  return { kind: lit("kind"), severity: lit("severity") };
}

describe("support requests reach #ops-alerts the same day", () => {
  it("the support alert posts immediately", () => {
    const call = supportCall();
    const severity = effectiveSeverity(call.kind ?? undefined, call.severity ?? undefined);
    expect(postsImmediately(severity, call.kind ?? undefined), `${call.kind}/${call.severity} waits for the digest`).toBe(true);
  });

  it("…without being dressed as a page", () => {
    const call = supportCall();
    expect(call.kind).toBe("support_request");
    expect([...CRITICAL_KINDS]).not.toContain("support_request");
    expect(effectiveSeverity(call.kind!, call.severity ?? undefined)).toBe("info");
  });

  it("…and is deduped per request", () => {
    const src = readFileSync(CONTACT_SUPPORT, "utf8");
    expect(src).toMatch(/oncePerDayKey:\s*supportRequestKey\(/);
  });

  it("only these kinds bypass the critical-only rule", () => {
    expect([...ALWAYS_POST_KINDS].sort()).toEqual(["digest", "support_request"]);
    expect(postsImmediately("info", "support_request")).toBe(true);
    expect(postsImmediately("info", "custom")).toBe(false);
    expect(postsImmediately("warning", "custom")).toBe(false);
  });

  it("the dedupe key is the request, not the sender and not the day", () => {
    const req = { email: "Ada@example.com", subject: "Payout missing", message: "I finished a job on Tuesday." };
    // A double-tapped Send: identical content, incidental whitespace and case.
    expect(supportRequestKey(req)).toBe(
      supportRequestKey({ email: "ada@example.com ", subject: "  Payout missing", message: "I finished a job on   Tuesday." }),
    );
    // Same person, a second, different problem: a different request.
    expect(supportRequestKey(req)).not.toBe(supportRequestKey({ ...req, message: "Also my photos will not upload." }));
    // Same text from someone else: also a different request.
    expect(supportRequestKey(req)).not.toBe(supportRequestKey({ ...req, email: "rex@example.com" }));
    // A guest sends no account: still a stable key, never a throw.
    expect(supportRequestKey({ email: null, subject: null, message: null })).toMatch(/^support-request:[0-9a-f]{8}$/);
  });
});
