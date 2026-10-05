/**
 * CLASS CHECK: a checkout return page that names a job tells only that job's
 * POSTER about the payment (owner bug, 2026-10-05).
 *
 * THE BUG: `/payment-success?job_id=X` read the job by id alone, so any
 * signed-in account that could read job X saw "Payment authorized", "$10 is
 * held securely" and View Applicants. The owner, signed in to their admin
 * account (an admin reads every job), saw their other account's payment.
 *
 * THE CLASS, INVENTORIED FROM SOURCE: every Stripe `success_url` an edge
 * function builds whose query carries an interpolated value (`?job_id=${…}`,
 * `?boosted=${…}`) is a page that receives an id and makes a payment claim
 * about it. Each such query param must be read somewhere in src/, and every
 * src file that reads it must call `isJobPoster(` (src/lib/checkoutReturnOwner.ts)
 * in code, not in a comment. Returns without an id (`?tip=success`,
 * `?gift=success`, `?pro=success`…) describe the signed-in account's own
 * purchase and are not in the class.
 *
 * Behaviour (another account sees no claim, the poster still does) is pinned
 * in src/pages/post-job/PaymentSuccess.test.tsx and
 * src/pages/home/useBoostReturn.test.tsx.
 *
 * @mutate src/pages/post-job/PaymentSuccess.tsx | if (!isJobPoster(data.customer_id, viewerId)) { | if (!data.customer_id) {
 * @mutate src/pages/home/useBoostReturn.ts | } else if (!isJobPoster(data?.customer_id, userId)) { | } else if (!data) {
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readdirSync, trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(REPO, f), "utf8");

/** `?a=${x}&b=lit` -> the params whose value is interpolated. */
export function idParams(successUrlLine: string): string[] {
  const m = successUrlLine.match(/success_url:\s*buildRedirectUrl\(\s*`[^`?]*\?([^`]*)`/);
  if (!m) return [];
  return m[1]
    .split("&")
    .map((kv) => kv.split("="))
    .filter(([, v]) => v !== undefined && v.includes("${"))
    .map(([k]) => k);
}

// supabase/functions is outside src/: trackedFiles reads src/ only, and this readdirSync is the real one there.
const edgeFiles = (readdirSync(resolve(REPO, "supabase/functions"), { recursive: true }) as string[])
  .filter((f) => f.endsWith(".ts") && !f.startsWith("_shared") && !/\.test\.ts$/.test(f))
  .map((f) => `supabase/functions/${f}`);
const params = new Map<string, string[]>(); // param -> edge files that send it
for (const f of edgeFiles) {
  for (const line of blankComments(read(f)).split("\n")) {
    for (const p of idParams(line)) params.set(p, [...(params.get(p) ?? []), f]);
  }
}

const srcFiles = trackedFiles("src").filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f));
const consumers = (param: string) =>
  srcFiles.filter((f) => blankComments(read(f)).includes(`.get("${param}")`));

describe("checkout returns that name a job claim the payment only to its poster", () => {
  it("parses an id-carrying success_url (not vacuous)", () => {
    expect(idParams("success_url: buildRedirectUrl(`/payment-success?job_id=${jobId}`, isNative),")).toEqual(["job_id"]);
    expect(idParams("success_url: buildRedirectUrl(`/posts?tip=success`, isNative),")).toEqual([]);
    expect(idParams("success_url: buildRedirectUrl(`/home?boosted=${job_id}&x=1`, isNative),")).toEqual(["boosted"]);
  });

  it("inventory floor: finds the id-carrying returns", () => {
    // 2026-10-05: job_id (create-payment, job checkout) and boosted (create-boost-payment).
    expect(params.size).toBeGreaterThan(1);
  });

  it("every id-carrying return param has a page that reads it", () => {
    const unread = [...params.keys()].filter((p) => consumers(p).length === 0);
    expect(unread, "a success_url carries an id no page reads").toEqual([]);
  });

  it("every page that reads one checks the viewer is the job's poster", () => {
    const unchecked = [...params.keys()].flatMap((p) =>
      consumers(p)
        .filter((f) => !/\bisJobPoster\(/.test(blankComments(read(f))))
        .map((f) => `${f} reads ?${p}= (sent by ${params.get(p)!.join(", ")}) without isJobPoster()`),
    );
    expect(unchecked).toEqual([]);
  });
});
