// The verification email must contain a real, clickable button.
//
// A 2026-09-06 review found the signup email rendering:
//
//     <p>Please verify your email (…) to continue setting up your account:</p>
//     <div style="margin: 0 0 4px"></div>
//
// No button, no link anywhere in the HTML part. Only the plain-text alternative
// carried the verify URL — and every modern mail client renders the HTML part,
// so new signups had no way through, on the one email the entire funnel
// depends on.
//
// PROVEN ABLE TO FAIL 2026-09-21 (guard burn-down): putting the anchor back
// inside `<!--[if !mso]><!-->` — the original defect, verbatim — reds all three
// BrandButton assertions (3/3 failed). The registered mutation below is the
// blunter half of the same defect: the visible anchor stops being an anchor.
//
// CAUSE: BrandButton injected the whole button through dangerouslySetInnerHTML
// with the visible anchor wrapped in downlevel-revealed conditional comments —
// `<!--[if !mso]><!-->` … `<!--<![endif]-->`. Anything stripping comments with a
// greedy match removes everything from the first `<!--` to the LAST `-->`, and
// the anchor is between them. The wrapper div survives with its style attribute
// and nothing inside.
// @mutate supabase/functions/_shared/email-templates/components.tsx | <a\n      className="e-cta"\n      href={href} | <span\n      className="e-cta"\n      data-href={href}
// @mutate supabase/functions/_shared/email-templates/components.tsx | <!--[if mso]> | <!--[if !mso]><!--
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(process.cwd(), "supabase/functions/_shared/email-templates/components.tsx"),
  "utf8",
);
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The text of ONE top-level declaration, bounded at the next one.
 *
 * `slice(indexOf(x))` to end-of-file is the commonest hollow shape in this
 * repo (four found in one burn-down, one of them a privacy guard whose marker
 * its own comment-stripper had deleted, so `indexOf` returned -1 and the slice
 * was the whole file). Here it would let any LATER component's anchor satisfy
 * BrandButton's — and a missing marker would silently hand back one character.
 */
function declaration(marker: string): string {
  const at = code.indexOf(marker);
  if (at === -1) throw new Error(`components.tsx no longer declares ${marker}`);
  const rest = code.slice(at + marker.length);
  const end = rest.search(/\n(?:export |function |const )/);
  return marker + (end === -1 ? rest : rest.slice(0, end));
}

describe("BrandButton", () => {
  it("renders the anchor as real JSX, not injected HTML", () => {
    const btn = declaration("export const BrandButton");
    expect(btn).toMatch(/<a\s/);
    expect(btn).toMatch(/href=\{href\}/);
    expect(btn).toMatch(/\{label\}/);
  });

  it("never wraps the anchor in a conditional comment again", () => {
    // The whole defect in one assertion: an anchor inside `[if !mso]` is an
    // anchor that a comment-stripping renderer can delete.
    expect(code).not.toContain("if !mso");
  });

  it("keeps VML as an Outlook-only enhancement", () => {
    // Raw HTML is fine for VML — it cannot be JSX — as long as losing it costs
    // Outlook a rounded corner rather than costing everyone the button.
    expect(code).toContain("msoOnlyButtonHtml");
    const raw = declaration("function msoOnlyButtonHtml");
    expect(raw).toContain("[if mso]");
    expect(raw).not.toMatch(/<a\s+class="e-cta"/);
  });
});

describe("the signup template still uses it", () => {
  const SIGNUP = readFileSync(
    resolve(process.cwd(), "supabase/functions/_shared/email-templates/signup.tsx"),
    "utf8",
  );
  it("points the button at the confirmation URL", () => {
    expect(SIGNUP).toMatch(/<BrandButton\s+href=\{confirmationUrl\}/);
  });
});
