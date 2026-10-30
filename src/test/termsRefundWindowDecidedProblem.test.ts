/**
 * The Terms' Declutter refund window names its one exception (owner 2026-10-30 pop-up answer 3: "24 h to ask unless
 * Louisiana Helpr already decided a problem on that order"; Builder 100).
 *
 * "You always get 24 hours ... to ask for a refund" was not what the server does: declutter_ask_refund refuses once
 * declutter_sale_decided(order) is true, and that is true as soon as a problem on the order is decided. The Terms now
 * say "unless Louisiana Helpr has already decided a problem on that order". This guard ties the sentence to the
 * EFFECTIVE server definitions, so the copy and the refusal cannot drift apart again.
 */
// @mutate src/pages/info/legal/TermsSection.tsx | to ask for a refund, unless Louisiana Helpr has already decided a problem on that order. | to ask for a refund.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const terms = blankComments(readFileSync(resolve(__dirname, "../pages/info/legal/TermsSection.tsx"), "utf8")).replace(/\s+/g, " ");
const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

describe("Terms: the 24 hours to ask for a refund end once a problem is decided", () => {
  it("reads the Terms and both server definitions (floors)", () => {
    expect(terms.length).toBeGreaterThan(20000);
    expect(flat("declutter_ask_refund").length).toBeGreaterThan(1000);
    expect(flat("declutter_sale_decided").length).toBeGreaterThan(200);
  });

  it("the server refuses a refund ask once a problem on the order is decided", () => {
    expect(flat("declutter_ask_refund")).toMatch(/now\(\) >= o\.handed_over_at \+ interval '24 hours' OR public\.declutter_sale_decided\(o\.id\)/);
    expect(flat("declutter_sale_decided")).toMatch(/FROM public\.declutter_problems x WHERE x\.order_id = p_order_id AND x\.status = 'decided'/);
  });

  it("the Terms say so in the refund paragraph", () => {
    expect(terms).toContain(
      "you have 24 hours after pickup to ask for a refund, unless Louisiana Helpr has already decided a problem on that order.",
    );
  });
});
