/**
 * How much of the token's GitHub API hour is left, read from the X-RateLimit-*
 * headers of ONE real REST request, never from `gh api rate_limit`: on
 * 2026-10-13 01:52Z that endpoint answered used 0 / remaining 5000 (body and
 * headers) while a real request's headers said used 440 (lane B2). The owner's
 * token is shared by every REFRESH_PR_TOKEN workflow and every local `gh`, and
 * it ran out on 2026-10-12 and again at 01:44Z on 2026-10-13.
 *
 *   node scripts/lib/ghBudget.mjs [floor]   # prints the budget; exit 1 below floor
 *
 * Guard: src/test/ghCallsNotPerItem.test.ts (the budget gate cases).
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Below this, a PAT workflow step skips cleanly instead of spending the rest. */
export const BUDGET_FLOOR = 500;

/** { remaining, limit, used, reset } from `gh api -i` output, or null when the headers are missing. */
export function parseRateHeaders(text) {
  const get = (name) => {
    const m = new RegExp(`^${name}:\\s*(\\d+)\\s*$`, "im").exec(String(text));
    return m ? Number(m[1]) : null;
  };
  const remaining = get("x-ratelimit-remaining");
  if (remaining === null) return null;
  return { remaining, limit: get("x-ratelimit-limit"), used: get("x-ratelimit-used"), reset: get("x-ratelimit-reset") };
}

/** The REST budget now (1 call). Throws when gh fails or answers with no headers. */
export function readBudget(repo = process.env.GITHUB_REPOSITORY || "{owner}/{repo}") {
  const out = execFileSync("gh", ["api", "-i", `repos/${repo}`, "--jq", ".id"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const b = parseRateHeaders(out);
  if (!b) throw new Error("no X-RateLimit headers on the answer");
  return b;
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const floor = Number(process.argv[2] ?? BUDGET_FLOOR);
  try {
    const b = readBudget();
    console.log(`gh budget: ${b.remaining}/${b.limit} left (${b.used} used), resets ${new Date(b.reset * 1000).toISOString().slice(11, 16)}Z`);
    process.exit(b.remaining >= floor ? 0 : 1);
  } catch (e) {
    console.log(`gh budget: unknown (${String(e?.message ?? e).split("\n")[0]})`);
    process.exit(1);
  }
}
