/**
 * NB-014: deepLinkRoute.ts and Info.plist both said the helpr:// scheme was
 * "only deliverable to" this app, and used that to skip the host allowlist.
 * Any app or web page can open a custom scheme. What actually keeps it safe is
 * that the page it lands on only reads: so PaymentSuccess must never write,
 * and neither file may claim the scheme is exclusive again.
 *
 * @mutate src/pages/PaymentSuccess.tsx | export default PaymentSuccess; | void supabase.rpc("x");\nexport default PaymentSuccess;
 * @mutate src/lib/deepLinkRoute.ts | The scheme is NOT exclusive | The scheme is only deliverable to us
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WRITE = /\.(update|insert|upsert|delete|rpc)\(|functions\.invoke\(/;
const EXCLUSIVE_CLAIM = /only deliverable to|trust boundary the allowlist/i;

describe("the native return scheme is treated as untrusted (NB-014)", () => {
  it("PaymentSuccess performs no writes", () => {
    const src = readFileSync("src/pages/PaymentSuccess.tsx", "utf8");
    expect(src.length).toBeGreaterThan(1000);
    expect(src.split("\n").filter((l) => WRITE.test(l))).toEqual([]);
  });
  it("no comment claims the scheme is exclusive to this app", () => {
    for (const f of ["src/lib/deepLinkRoute.ts", "ios/App/App/Info.plist"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(EXCLUSIVE_CLAIM);
    }
  });
});
