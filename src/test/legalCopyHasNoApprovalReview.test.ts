/**
 * CLASS CHECK — the Terms, Privacy, Community Rules and Help Center never
 * describe an account approval review or a denied account again (Q276, found
 * by the Q179 walk 2026-09-23). Approval review was retired in Q193 (owner,
 * 2026-09-23): every account only verifies its email. Legal copy that
 * promises a review nobody performs is a false statement in the Terms.
 *
 * Inventory: every .ts/.tsx under src/pages/legal and src/pages/helpCenter
 * (plus HelpCenter.tsx), tests excluded; floor so an emptied glob fails.
 *
 * @mutate src/pages/legal/TermsSection.tsx | Every account verifies its email address before it can post or take jobs. | All accounts are reviewed before approval.
 * @mutate src/pages/legal/TermsSection.tsx | You must verify your email address to use your account. | Denied accounts may reapply.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { walkSource } from "./helpers/walkSource";

const REPO = resolve(__dirname, "..", "..");
const RETIRED_COPY =
  /reviewed before approval|subject to review|pending until approved|awaiting approval|denied accounts?|may reapply|account (?:is |was )?(?:approved|denied)|approval review/i;

function files(): string[] {
  const roots = ["src/pages/legal", "src/pages/helpCenter"].map((r) => join(REPO, r));
  return [...walkSource(roots), join(REPO, "src/pages/HelpCenter.tsx")]
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .map((f) => relative(REPO, f));
}

describe("Q276 — legal and help copy never promise an approval review", () => {
  it("scans a real inventory", () => {
    expect(files().length).toBeGreaterThan(5);
  });

  it("no legal or help file describes approval review or denied accounts", () => {
    const hits = files().flatMap((f) =>
      readFileSync(join(REPO, f), "utf8")
        .split("\n")
        .map((line, i) => (RETIRED_COPY.test(line) ? `${f}:${i + 1}: ${line.trim().slice(0, 120)}` : null))
        .filter((x): x is string => x !== null),
    );
    expect(hits, "rewrite it: accounts verify their email; there is no approval review (Q193)").toEqual([]);
  });
});
