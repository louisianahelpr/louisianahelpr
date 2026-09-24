/**
 * VC-008: two overloads of claim_idv_attempt both accepted a (p_user_id,
 * p_max_attempts) call, so any call not naming the third argument failed with
 * 42725 "function is not unique". No live function may have two overloads
 * where one call shape matches both: B's leading args equal A's, and B needs
 * no more arguments than A supplies. Inventory: every public function in the
 * live write-contract snapshot.
 *
 * @mutate scripts/audit/write-contract.snapshot.json |     "nargdefaults": 2,\n    "nargs": 3\n   }\n  ],\n  "claim_marketing_content" |     "nargdefaults": 2,\n    "nargs": 3\n   },\n   {"anon": false, "args": ["p_user_id", "p_max_attempts"], "authenticated": false, "nargdefaults": 1, "nargs": 2}\n  ],\n  "claim_marketing_content"
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Overload = { args: string[]; nargs: number; nargdefaults: number };
const fns: Record<string, Overload[]> = JSON.parse(
  readFileSync("scripts/audit/write-contract.snapshot.json", "utf8"),
).functions;

describe("no RPC has ambiguous overloads (VC-008)", () => {
  it("the inventory is real", () => {
    expect(Object.keys(fns).length).toBeGreaterThan(300);
  });

  it("no two overloads accept the same call", () => {
    const hits: string[] = [];
    for (const [name, ovs] of Object.entries(fns)) {
      for (const a of ovs)
        for (const b of ovs) {
          if (b.nargs <= a.nargs) continue;
          const sharesPrefix = a.args.every((arg, i) => b.args[i] === arg);
          if (sharesPrefix && b.nargs - b.nargdefaults <= a.nargs) hits.push(`${name}(${a.nargs}) vs (${b.nargs})`);
        }
    }
    expect(hits).toEqual([]);
  });
});
