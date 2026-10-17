/**
 * press-every-control run 39014836855, leg 4 (375, prod, 2026-10-17): one FAIL,
 * `[/posts customer] "Job address: 100 Audit Way, Baton Rouge, LA 99999 — tap
 * to e" — control not found on a freshly loaded page [reloaded screen: 32
 * control(s); ...; label text absent]`.
 *
 * Read off prod and the run's own results.json, not guessed:
 *   - between 11:14:10Z and 11:24:07Z poster-e2e's backout_notices got TWELVE
 *     acknowledged_at stamps, one a minute, each 2-3 s after the sweep pressed
 *     a "Got It" on /posts (BackoutBanner -> ack_backout_notice). Five were
 *     100 Audit Way jobs. An acknowledged card leaves the "You" bucket, which is
 *     what /posts opens on (19 cards at enumeration), so the reloaded page had
 *     ~7 cards and no 100 Audit Way card at all.
 *   - "got it" was not in DESTRUCTIVE_RX, so those writes were never gated and
 *     never recorded as this run's own writes (mutatedRows), and
 *     ROW_CONSUMED_SKIP could not fire.
 *   - and it could not have fired anyway: JobCardShell carries no class with
 *     "card" in it, so every control on a My Posts card resolved to NO record
 *     (rowText "", measured on prod /posts, 7 of 7 location chips). All the
 *     "Got It"s are identical, so once one card left, the next press's DOM path
 *     pointed at the NEXT card's button: the gate approved one record and the
 *     click landed on another.
 *
 * The fix: "got it" is a write; a job card is a record ([data-activity-card]);
 * and a mutating press re-checks, at click time, that it lands on the record
 * the gate approved (pressTargetRecord).
 *
 * @mutate scripts/audit/press-every-control.mjs | \|checkout\|got it)\b/i; | \|checkout)\b/i;
 * @mutate scripts/audit/press-every-control.mjs | [role="alertdialog"], [data-activity-card], [class*="card"] | [role="alertdialog"], [class*="card"]
 * @mutate scripts/audit/press-every-control.mjs | if (!meta?.rowText \|\| sameRecord(liveRowText, meta.rowText)) return { verdict: "same" }; | return { verdict: "same" };
 * @mutate scripts/audit/press-every-control.mjs | const inRecord = (now ?? []).filter((c) => sameRecord(c.rowText, meta.rowText)); | const inRecord = now ?? [];
 * @mutate scripts/audit/press-every-control.mjs | rowText: (el.closest(rowSel)?.innerText | rowText: (el.closest('li')?.innerText
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JobCardShell } from "@/components/job-card/JobCardShell";
import { BackoutBanner } from "@/components/job-card/BackoutBanner";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";

const DESTRUCTIVE_RX = harness.DESTRUCTIVE_RX as RegExp;
const RECORD_ROW_SEL = harness.RECORD_ROW_SEL as string;
type C = { sig: string; rowText: string; path: string };
const pressTargetRecord = harness.pressTargetRecord as (a: {
  liveRowText: string | null; meta: { sig: string; rowText: string }; now: C[];
}) => { verdict: "same" | "moved" | "gone"; control?: C };
const rowGoneAfterOwnWrite = harness.rowGoneAfterOwnWrite as (a: {
  rowText: string; mutatedRows: Set<string>; now: C[];
}) => boolean;
const repoRoot = resolve(__dirname, "../..");

function card(title: string) {
  return (
    <JobCardShell expandable expanded={false} onToggle={() => {}} category="cleaning">
      <BackoutBanner job={{ backout_notice: { id: `n-${title}`, job_id: `j-${title}`, backout_kind: "offer_expired", actor_name: null } }} />
      <h3>{title}</h3>
      <span>
        <button type="button" aria-label="Job address: 100 Audit Way, Baton Rouge, LA 99999 — tap to expand this job">100 Audit Way</button>
      </span>
    </JobCardShell>
  );
}

describe("press-every-control: a write on a job card lands on, and is remembered against, that card", () => {
  it("treats the backout banner's Got It as a write (and Declutter's 'I got it', which pays the seller)", () => {
    render(<QueryClientProvider client={new QueryClient()}>{card("[E2E DO NOT ACCEPT] J asc8ta")}</QueryClientProvider>);
    const got = screen.getByRole("button", { name: "Got It" });
    expect(DESTRUCTIVE_RX.test(got.textContent ?? "")).toBe(true);
    const handover = readFileSync(resolve(repoRoot, "src/components/declutter/DeclutterHandoverViews.tsx"), "utf8");
    expect(handover).toMatch(/>\s*I got it\s*</);
    expect(DESTRUCTIVE_RX.test("I got it")).toBe(true);
  });

  it("resolves the Got It and the location chip of one My Posts card to THAT card, and two cards to two records", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        {card("[E2E DO NOT ACCEPT] J asc8ta")}
        {card("[E2E DO NOT ACCEPT] J ataxm1")}
      </QueryClientProvider>,
    );
    const shells = [...container.querySelectorAll("[data-activity-card]")];
    expect(shells).toHaveLength(2);
    const gots = screen.getAllByRole("button", { name: "Got It" });
    const chips = screen.getAllByRole("button", { name: /tap to expand this job/ });
    for (const i of [0, 1]) {
      expect(gots[i].closest(RECORD_ROW_SEL), "Got It belongs to no record").toBe(shells[i]);
      expect(chips[i].closest(RECORD_ROW_SEL), "the chip belongs to no record").toBe(shells[i]);
    }
  });

  // The run's shape: three identical "Got It"s, card A's already acknowledged
  // away, so the path the sweep addressed for card B now holds card C's button.
  const A = "Cleaning [E2E DO NOT ACCEPT] J asc8ta $25 100 Audit Way, Baton Rouge, LA 99999";
  const B = "Cleaning [E2E DO NOT ACCEPT] J ataxm1 $25 100 Audit Way, Baton Rouge, LA 99999";
  const Cc = "Cleaning [E2E DO NOT ACCEPT] J 7s14qs $25 100 Audit Way, Baton Rouge, LA 99999";
  const SIG = "button\u0000\u0000\u0000Got It";
  const nowAfterA: C[] = [
    { sig: SIG, rowText: B, path: "div:nth-of-type(1) button" },
    { sig: SIG, rowText: Cc, path: "div:nth-of-type(2) button" },
  ];

  it("moves a mutating press to the control inside the approved record when its path drifted to the next card", () => {
    const placed = pressTargetRecord({ liveRowText: Cc, meta: { sig: SIG, rowText: B }, now: nowAfterA });
    expect(placed.verdict).toBe("moved");
    expect(placed.control?.rowText).toBe(B);
  });

  it("presses as addressed when the click already lands on the approved record (a ticked clock is the same record)", () => {
    expect(pressTargetRecord({ liveRowText: B, meta: { sig: SIG, rowText: B }, now: nowAfterA }).verdict).toBe("same");
    expect(pressTargetRecord({ liveRowText: B.replace("$25", "$26"), meta: { sig: SIG, rowText: B }, now: nowAfterA }).verdict).toBe("same");
  });

  it("never presses another record when the approved one has left the screen", () => {
    expect(pressTargetRecord({ liveRowText: Cc, meta: { sig: SIG, rowText: A }, now: nowAfterA }).verdict).toBe("gone");
  });

  it("excuses a control whose card left the list after this run's own write on THAT card, and nothing else", () => {
    // Card A's chip, after card A's own Got It was pressed and recorded.
    expect(rowGoneAfterOwnWrite({ rowText: A, mutatedRows: new Set([A]), now: nowAfterA })).toBe(true);
    // Card A gone, but the run wrote only to card B: not excused.
    expect(rowGoneAfterOwnWrite({ rowText: A, mutatedRows: new Set([B]), now: nowAfterA })).toBe(false);
  });

  it("reads rowText in the page through the one shared record selector", () => {
    const src = readFileSync(resolve(repoRoot, "scripts/audit/press-every-control.mjs"), "utf8");
    expect(src).toMatch(/rowText: \(el\.closest\(rowSel\)\?\.innerText/);
    expect(src).toMatch(/rowSel: RECORD_ROW_SEL/);
    // The press-time check reads the element about to be clicked, so it sits
    // after `target` is resolved (ready/reds-1017-9 put it before the loop's
    // `let target`: a TDZ throw on every gate-approved write, invisible to a
    // source match like this one). The loop itself is driven, end to end, by
    // src/test/pressDrivesTheRealPressPath.test.tsx.
    expect(src).toMatch(/target = target\.first\(\);\n[\s\S]{0,1500}if \(entry\.mutating\) \{\n\s+const liveRowText = await target\.evaluate\(LIVE_ROW_TEXT, RECORD_ROW_SEL\)/);
  });
});
