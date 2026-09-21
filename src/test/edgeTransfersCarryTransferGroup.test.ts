/**
 * Every job-scoped `stripe.transfers.create` tags `transfer_group: job_<id>`.
 *
 * The unrecorded-transfer checks (Quick Release / Quick Refund in
 * create-payment, execute-dispute-split 6c, void-cancelled-payments Part A,
 * `_shared/payoutClaim.ts` for release-payout and process-scheduled-payouts)
 * ask Stripe `transfers.list({ transfer_group: "job_<id>" })`. A creator that
 * omits the tag makes its transfers invisible to that list, and the check
 * silently finds nothing — it fails OPEN. create-payment's transferToHelper did
 * exactly that before 20260915034822 (coordinator, 2026-09-15). The payout
 * claim check also lists by destination + metadata.job_id as a fallback; this
 * guard keeps the primary path honest.
 *
 * Inventory from source: every `stripe.transfers.create(` in
 * supabase/functions. Its first argument (inline object, or the object a local
 * `const/let <name> = {` declares) must carry `transfer_group:` whose value is
 * a `job_${…}` template or a local constant assigned one. Transfers that are
 * not job-scoped are listed in NOT_JOB_SCOPED with the reason.
 *
 * COMMENTS ARE BLANKED BEFORE ANY OF THAT. Until 2026-09-21 they were not, and
 * this money guard was satisfiable by prose: commenting out the one live
 * `transfer_group` line in create-payment's admin transfer — making that
 * transfer invisible to every `transfers.list({ transfer_group })` duplicate
 * check, which is exactly the fail-open described above — left this suite
 * GREEN, 3 passed. Blanking preserves offsets and newlines so the line numbers
 * this test reports stay true.
 */
// @mutate supabase/functions/create-payment/index.ts | \n      transfer_group: `job_${jobId}`, |
// @mutate supabase/functions/create-payment/index.ts | \n      transfer_group: `job_${jobId}`, | \n      // transfer_group: `job_${jobId}`,
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const NOT_JOB_SCOPED: Record<string, string> = {
  "supabase/functions/cash-out-credits/index.ts": "referral-credit cash-out to the user's own account; no job",
  "supabase/functions/instant-payout/index.ts": "instant-payout fee moved from the Helpr's connected account to the platform; no job",
};

/**
 * Blank `//` and block comments, preserving every byte offset and newline, so
 * a commented-out `transfer_group:` cannot stand in for a live one. `//` that
 * follows `:` or a quote is left alone — that is a URL, not a comment.
 */
export function blankComments(src: string): string {
  // A scanner, not a regex. A regex that blanks `//` to end of line eats the
  // rest of any line holding a URL ("https://x/a//b"), which would delete a
  // live `transfer_group:` sitting after it on the same line — a guard that
  // reads its own damage as a missing tag is a false RED, the other way this
  // shape fails. String and template literals are skipped byte by byte.
  const out = src.split("");
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] !== "\n") out[i] = " ";
      continue;
    }
    i++;
  }
  return out.join("");
}

/** Text of the balanced `{…}` starting at `open` (index of the `{`). */
function balanced(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

/** One entry per transfers.create call: { index, params } or { index, params: null } when unresolvable. */
export function transferCreateParams(raw: string): Array<{ line: number; params: string | null }> {
  const src = blankComments(raw);
  const out: Array<{ line: number; params: string | null }> = [];
  const re = /stripe\.transfers\.create\(\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const at = m.index + m[0].length;
    const line = src.slice(0, m.index).split("\n").length;
    // Skip mentions inside comments.
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    if (/^\s*(\/\/|\*)/.test(src.slice(lineStart, m.index))) continue;
    if (src[at] === "{") {
      out.push({ line, params: balanced(src, at) });
      continue;
    }
    const ident = /^([A-Za-z_]\w*)/.exec(src.slice(at))?.[1];
    const decl = ident ? new RegExp(`(?:const|let|var)\\s+${ident}\\b[^=]*=\\s*\\{`).exec(src.slice(0, m.index)) : null;
    if (!decl) { out.push({ line, params: null }); continue; }
    // The LAST declaration of that name before the call.
    const all = [...src.slice(0, m.index).matchAll(new RegExp(`(?:const|let|var)\\s+${ident}\\b[^=]*=\\s*\\{`, "g"))];
    const last = all[all.length - 1];
    out.push({ line, params: balanced(src, last.index! + last[0].length - 1) });
  }
  return out;
}

export function tagsJobGroup(rawSrc: string, rawParams: string | null): boolean {
  if (!rawParams) return false;
  const src = blankComments(rawSrc);
  const params = blankComments(rawParams);
  const v = /transfer_group:\s*(`job_\$\{[^`]+\}`|[A-Za-z_]\w*)/.exec(params)?.[1];
  if (!v) return false;
  if (v.startsWith("`")) return true;
  return new RegExp(`(?:const|let)\\s+${v}\\s*=\\s*\`job_\\$\\{`).test(src);
}

describe("every job-scoped Stripe transfer carries transfer_group job_<id>", () => {
  it("the checker is RED on create-payment's transferToHelper as it stood before this branch", () => {
    const prefix = readFileSync("src/test/fixtures/transferGroup/transferToHelper.prefix.ts.txt", "utf8");
    const calls = transferCreateParams(prefix);
    expect(calls).toHaveLength(1);
    expect(tagsJobGroup(prefix, calls[0].params)).toBe(false);
  });

  it("resolves inline objects, local params objects and a local job_ constant", () => {
    const inline = "await stripe.transfers.create({ amount: 1, transfer_group: `job_${job.id}` }, {});";
    const viaVar = "const p: any = { amount: 1, transfer_group: `job_${jobId}` };\nawait stripe.transfers.create(p, {});";
    const viaConst = "const g = `job_${job.id}`;\nconst p = { transfer_group: g };\nawait stripe.transfers.create(p);";
    for (const src of [inline, viaVar, viaConst]) {
      const [c] = transferCreateParams(src);
      expect(tagsJobGroup(src, c.params)).toBe(true);
    }
  });

  it("a commented-out transfer_group does not count as one", () => {
    // The 2026-09-21 finding, as a unit: prose is not a tag.
    const dead = "const p = {\n  amount: 1,\n  // transfer_group: `job_${jobId}`,\n};\nawait stripe.transfers.create(p);";
    const [call] = transferCreateParams(dead);
    expect(tagsJobGroup(dead, call.params)).toBe(false);
    // …and a `//` inside a string is not a comment, so a real tag beside a URL survives.
    const live = 'const p = { url: "https://x.example/a//b", transfer_group: `job_${jobId}` };\nawait stripe.transfers.create(p);';
    const [ok] = transferCreateParams(live);
    expect(tagsJobGroup(live, ok.params)).toBe(true);
  });

  it("no job-scoped transfers.create in supabase/functions omits it", () => {
    const files = execFileSync("git", ["ls-files", "supabase/functions"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.ts$/.test(f));
    const offenders: string[] = [];
    let seen = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!src.includes("stripe.transfers.create(")) continue;
      for (const c of transferCreateParams(src)) {
        seen++;
        if (NOT_JOB_SCOPED[f]) continue;
        if (!tagsJobGroup(src, c.params)) offenders.push(`${f}:${c.line}`);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(7);
    expect(offenders).toEqual([]);
  });
});
