/**
 * F241 (audit 11-10): the /sponsor footer links (Facebook page, group, Official rules, Privacy) were 32px tall, under
 * the 44px tap minimum. Every rule that sizes them must give at least 44px.
 *
 * @mutate src/pages/sponsor/sponsor.css | .lh25-footer-links a { min-height: 44px; | .lh25-footer-links a { min-height: 32px;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const css = blankComments(readFileSync(resolve(__dirname, "../pages/sponsor/sponsor.css"), "utf8"));

describe("F241: the sponsor footer links are 44px tap targets", () => {
  it("every .lh25-footer-links a rule sets min-height of 44px or more", () => {
    const rules = [...css.matchAll(/\.lh25-footer-links a\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(rules.length).toBeGreaterThan(0);
    for (const body of rules) {
      const h = /min-height:\s*(\d+)px/.exec(body);
      expect(h, body).not.toBeNull();
      expect(Number(h![1])).toBeGreaterThanOrEqual(44);
    }
  });
});
