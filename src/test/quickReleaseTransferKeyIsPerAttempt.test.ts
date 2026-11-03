// Q2166 (lh-money-escrow@b1730c932#6): Quick Release's transfer used ONE
// Stripe idempotency key per job (`dispute-release-<job>`) for every attempt.
// A definite refusal gives the Helpr-fault card fee back; if that debt then
// changed before the next attempt (inside Stripe's 24h key window), the same
// key arrived with a different amount, Stripe answered an idempotency error,
// create-payment read that as "money may have moved", and the claim stuck with
// the fee never restored. The key is now salted per attempt with the
// settlement claim's token (a definite refusal hands the claim back, so the
// next attempt holds a new token), as release-payout salts with its
// failed-attempt count.
//
// @mutate supabase/functions/create-payment/index.ts | idempotencyKey: claimToken ? `dispute-release-${jobId}-c${claimToken}` : `dispute-release-${jobId}`, | idempotencyKey: `dispute-release-${jobId}`,
// @mutate supabase/functions/create-payment/index.ts | releaseClaim.claim?.token ?? null, | null,
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const SRC = blankComments(readFileSync("supabase/functions/create-payment/index.ts", "utf8"));

/** The body of `async function <name>(`, up to the next top-level function. */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`async function ${name}(`);
  if (start < 0) return "";
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(?:export )?(?:async )?function \w+\(/);
  return next < 0 ? rest : rest.slice(0, next);
}

/** Each `stripe.transfers.create(...)` call with its options argument. */
function transferCreateCalls(body: string): string[] {
  const out: string[] = [];
  let i = body.indexOf("stripe.transfers.create(");
  while (i >= 0) {
    let depth = 0;
    let j = i + "stripe.transfers.create".length;
    for (; j < body.length; j++) {
      if (body[j] === "(") depth++;
      else if (body[j] === ")" && --depth === 0) break;
    }
    out.push(body.slice(i, j + 1));
    i = body.indexOf("stripe.transfers.create(", j);
  }
  return out;
}

describe("Quick Release's transfer key changes with each attempt (Q2166)", () => {
  const body = functionBody(SRC, "transferToHelper");

  it("finds transferToHelper and its one transfer", () => {
    expect(body.length).toBeGreaterThan(2000);
    expect(transferCreateCalls(body)).toHaveLength(1);
  });

  it("takes the claim token as a parameter and salts the key with it", () => {
    const params = body.slice(0, body.indexOf(") {"));
    expect(params).toMatch(/\bclaimToken\s*:\s*string\s*\|\s*null/);
    const call = transferCreateCalls(body)[0];
    const key = call.match(/idempotencyKey\s*:\s*([^\n]+)/)?.[1] ?? "";
    // The key expression must read the token, not just name the job.
    expect(key).toMatch(/\$\{claimToken\}/);
  });

  it("the Quick Release caller passes its claim's token", () => {
    const callStart = SRC.indexOf("await transferToHelper(");
    expect(callStart).toBeGreaterThan(0);
    const call = SRC.slice(callStart, SRC.indexOf(");", callStart));
    expect(call).toMatch(/releaseClaim\.claim\?\.token/);
  });
});
