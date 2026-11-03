// @mutate scripts/audit/press-every-control.mjs |     if (liveRecordKey === meta.recordKey) return { verdict: "same" }; |     if (liveRecordKey === "never") return { verdict: "same" };
// @mutate scripts/audit/press-every-control.mjs |     const keyed = (now ?? []).filter((c) => c.recordKey === meta.recordKey); |     const keyed = now ?? [];
// @mutate scripts/audit/press-every-control.mjs |       recordKey: el.closest(`[${recordKeyAttr}]`)?.getAttribute(recordKeyAttr) \|\| "", |       recordKey: "",
// @mutate src/components/NotificationPanel.tsx | "data-record-id": n.id, role: | "data-row-id": n.id, role:
// @mutate src/components/NotificationPanel.tsx | <div data-record-id="notifications-panel" | <div
// @mutate scripts/audit/pressProdSafety.mjs |   if (meta.accountSetting === true) return true; |   void meta.accountSetting;
// @mutate scripts/audit/press-every-control.mjs |       accountSetting: el.hasAttribute("data-account-setting"), |       accountSetting: false,
// @mutate src/components/sections/CustomizeSheet.tsx | aria-label={`Move ${s.label} up`} data-account-setting | aria-label={`Move ${s.label} up`}
// @mutate scripts/audit/press-every-control.mjs |   if (!selfValidated) return false; |   if (selfValidated === "never") return false;
// @mutate scripts/audit/press-every-control.mjs |               !isInlineValidationRefusal({ toast: t, selfValidated, formText }) && |               true &&
// @mutate e2e/a11y-prod/abortProdWrites.ts | u.searchParams.get("tab") === e.tab && aborted.has(e.fn)); | u.searchParams.get("tab") === e.tab);
// @mutate e2e/errorScreens.ts |   return findErrorScreen({ ...screen, text: screen.text.split(excusedCopy).join(" ") }, allow); |   return null;
// @mutate e2e/a11y-prod/abortProdWrites.ts | tab: "payout_history", copy: | tab: "payouts", copy:
/*
 * RELEASE GATE "Press every control", run 41553094625 on 3ebffa3aea
 * (2026-11-03), artifact ~/.lh-shots/l45/press-art: three classes of red, plus
 * the a11y-prod pre-push sweep's /profile?tab=earnings red (B19, 03:08Z).
 *
 * 1. 143 FAILs in /home's bell panel, "its record is no longer on the screen",
 *    from "Mark all read" on (every row, every More, even Close). The panel's
 *    record was its whole dialog, matched by its first 400 characters of text;
 *    enumeration was at 02:29:01Z and "Mark all read" at 02:37:15Z, and the text
 *    no longer matched. Fix: rows carry data-record-id={n.id}, the panel a fixed
 *    one, and the harness matches a keyed record by its key (pressTargetRecord).
 * 2. 18 GATE MISSes: Customize "Move <section> up/down" POST
 *    member_section_prefs, an account setting, under words no rule named. Fix:
 *    data-account-setting on those buttons; isStateToggle honours it, so they
 *    are gated like the sheet's "Show <section>" switch.
 * 3. /reset-password "Update password": the form is noValidate (A3-L3), so an
 *    empty submit raises the app's own rule toast and repeats it inline. The
 *    harness does NOT fill a policy-meeting password: that would change the
 *    shared test account's password on prod. Fix: that exact refusal is excused
 *    (isInlineValidationRefusal); any other toast still fails.
 * 4. a11y-prod: stripe-payouts stays blocked; /profile?tab=earnings's "We
 *    couldn't load your payout data." is excused only when this context aborted
 *    stripe-payouts, and any other error copy on the screen still fails.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";
import { abortExplainedError, ABORT_EXPLAINED_ERRORS } from "../../e2e/a11y-prod/abortProdWrites";
import { errorScreenAfterExcuse } from "../../e2e/errorScreens";

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

type C = { sig: string; rowText: string; recordKey?: string; path: string };
type Meta = { sig: string; rowText: string; recordKey?: string };
const pressTargetRecord = harness.pressTargetRecord as (a: {
  liveRowText: string | null; liveRecordKey?: string; meta: Meta; now: C[];
}) => { verdict: "same" | "moved" | "gone"; control?: C };
const isInlineValidationRefusal = harness.isInlineValidationRefusal as (a: {
  toast: string; selfValidated: boolean; formText: string;
}) => boolean;
const isAccountSettingToggle = safety.isAccountSettingToggle as (a: Record<string, unknown>) => boolean;
const mutationGate = safety.mutationGate as (a: Record<string, unknown>) => Promise<string | null>;

describe("1. the bell panel's records are matched by id, not by the panel's live text", () => {
  // The run's panel text at enumeration, and the same panel eight minutes later.
  const PANEL_THEN = "Notifications Mark all read Unread 84 All TODAY Your card is on hold Your card is on hold for $25.";
  const PANEL_NOW = "Notifications Mark all read Unread 84 All TODAY Your card was not charged Nobody was hired for";
  const MARK = "button\u0000\u0000\u0000Mark all read";
  const MORE = "button\u0000\u0000\u0000More";

  it("presses a header control whose panel text drifted (the text-only match said 'gone')", () => {
    const meta = { sig: MARK, rowText: PANEL_THEN, recordKey: "notifications-panel" };
    const now = [{ sig: MARK, rowText: PANEL_NOW, recordKey: "notifications-panel", path: "h" }];
    expect(pressTargetRecord({ liveRowText: PANEL_NOW, liveRecordKey: "notifications-panel", meta, now }).verdict).toBe("same");
    // The unkeyed rule (the run's behaviour) reads the same drift as gone.
    expect(pressTargetRecord({ liveRowText: PANEL_NOW, meta: { sig: MARK, rowText: PANEL_THEN }, now }).verdict).toBe("gone");
  });

  it("moves a row's More to the same row when the list reflowed under it", () => {
    const meta = { sig: MORE, rowText: PANEL_THEN, recordKey: "n-2" };
    const now = [
      { sig: MORE, rowText: PANEL_NOW, recordKey: "n-new", path: "row1" },
      { sig: MORE, rowText: PANEL_NOW, recordKey: "n-2", path: "row2" },
    ];
    const placed = pressTargetRecord({ liveRowText: PANEL_NOW, liveRecordKey: "n-new", meta, now });
    expect(placed.verdict).toBe("moved");
    expect(placed.control?.path).toBe("row2");
  });

  it("never presses another row when the approved row has left the list", () => {
    const meta = { sig: MORE, rowText: PANEL_THEN, recordKey: "n-gone" };
    const now = [{ sig: MORE, rowText: PANEL_THEN, recordKey: "n-new", path: "row1" }];
    expect(pressTargetRecord({ liveRowText: PANEL_THEN, liveRecordKey: "n-new", meta, now }).verdict).toBe("gone");
  });

  it("the panel and every row carry data-record-id, and ENUMERATE reads it", () => {
    const panel = code("src/components/NotificationPanel.tsx");
    expect(panel).toMatch(/"data-record-id": n\.id,/);
    expect(panel).toMatch(/<div data-record-id="notifications-panel"/);
    const src = code("scripts/audit/press-every-control.mjs");
    expect(src).toMatch(/recordKey: el\.closest\(`\[\$\{recordKeyAttr\}\]`\)\?\.getAttribute\(recordKeyAttr\)/);
    expect(src).toMatch(/recordKeyAttr: RECORD_KEY_ATTR \}\)\)/);
    expect(src).toMatch(/pressTargetRecord\(\{ liveRowText, liveRecordKey, meta, now \}\)/);
  });
});

describe("2. Customize's section-order buttons are gated as an account setting", () => {
  it("a data-account-setting button is an account-setting toggle, and the gate skips it on /home", async () => {
    const meta = { tag: "button", role: "", accountSetting: true, inForm: false, rowText: "" };
    expect(isAccountSettingToggle({ persona: "customer", meta, label: "Move Jobs down" })).toBe(true);
    expect(isAccountSettingToggle({ persona: "customer", meta: { ...meta, accountSetting: false }, label: "Move Jobs down" })).toBe(false);
    const why = await mutationGate({
      label: "Move Jobs down", meta, chainOwned: false, persona: "customer", routeUrl: "/home",
      urlOwned: { owned: false, shared: false, id: null }, owners: { names: [] }, stripeMode: async () => ({ mode: "test" }),
    });
    expect(why).toBe(safety.SKIP_ACCOUNT_SETTING);
  });

  it("both Move buttons carry the marker and ENUMERATE reads it", () => {
    const sheet = code("src/components/sections/CustomizeSheet.tsx");
    const moves = sheet.match(/aria-label=\{`Move \$\{s\.label\} (?:up|down)`\}[^>]*/g) ?? [];
    expect(moves.length).toBe(2);
    for (const m of moves) expect(m).toContain("data-account-setting");
    expect(code("scripts/audit/press-every-control.mjs")).toMatch(/accountSetting: el\.hasAttribute\("data-account-setting"\)/);
  });
});

describe("3. /reset-password's own refusal of an empty form is not a failure", () => {
  const RULES = "Your password still needs 12 characters or more, a lowercase letter, an uppercase letter, a number and a symbol like ! ?";

  it("excuses the toast only when the noValidate form repeats it inline", () => {
    expect(isInlineValidationRefusal({ toast: RULES, selfValidated: true, formText: `New password Confirm ${RULES} Update password` })).toBe(true);
    expect(isInlineValidationRefusal({ toast: RULES, selfValidated: false, formText: RULES })).toBe(false);
    expect(isInlineValidationRefusal({ toast: "Couldn't update your password.", selfValidated: true, formText: RULES })).toBe(false);
    expect(isInlineValidationRefusal({ toast: "", selfValidated: true, formText: RULES })).toBe(false);
  });

  it("the form is still noValidate and names its error inline, and the press loop filters through the excuse", () => {
    const page = code("src/pages/auth/ResetPassword.tsx");
    expect(page).toMatch(/<form onSubmit=\{handleSubmit\} noValidate/);
    expect(page).toMatch(/id="reset-password-error"/);
    expect(code("scripts/audit/press-every-control.mjs")).toMatch(/!isInlineValidationRefusal\(\{ toast: t, selfValidated, formText \}\) &&/);
  });
});

describe("4. a11y-prod excuses the earnings error only when it aborted stripe-payouts", () => {
  const URL_ = "http://127.0.0.1:4843/profile?tab=earnings";
  const COPY = "We couldn't load your payout data.";

  it("keys on the abort, the route and the tab", () => {
    expect(ABORT_EXPLAINED_ERRORS.length).toBeGreaterThan(0);
    expect(abortExplainedError(URL_, new Set(["stripe-payouts"]))).toBe(COPY);
    expect(abortExplainedError(URL_, new Set())).toBeNull();
    expect(abortExplainedError("http://127.0.0.1:4843/profile?tab=account", new Set(["stripe-payouts"]))).toBeNull();
  });

  it("Money's other door (?tab=payment) and Payout history read the same stripe-payouts query (A11y 41598471444)", () => {
    const aborted = new Set(["stripe-payouts"]);
    expect(abortExplainedError("http://127.0.0.1:4843/profile?tab=payment", aborted)).toBe(COPY);
    expect(abortExplainedError("http://127.0.0.1:4843/profile?tab=payout_history", aborted)).toBe("We couldn't load your payouts.");
    expect(abortExplainedError("http://127.0.0.1:4843/profile?tab=payout_history", new Set())).toBeNull();
    // The excuse rests on these screens really calling stripe-payouts; if either stops, the entry must go.
    expect(code("src/pages/profile/ProfileTabPanels.tsx")).toMatch(/tab === "earnings" \|\| tab === "payment"\) && user/);
    expect(code("src/pages/profile/PayoutHistory.tsx")).toMatch(/useEarningsData\(/);
    expect(code("src/components/profile/earningsTab/useEarningsData.ts")).toMatch(/functions\.invoke<StripePayoutData>\("stripe-payouts"/);
    // And the copy excused is the copy the screen shows.
    expect(code("src/pages/profile/PayoutHistory.tsx")).toMatch(/title="We couldn't load your payouts\."/);
  });

  it("removes only that copy: another error on the same screen still fails", () => {
    const text = `Money Earned ${COPY} Your money is safe`;
    expect(errorScreenAfterExcuse({ text, quoted: [] }, [], null)?.name).toBe("section/data load failure");
    expect(errorScreenAfterExcuse({ text, quoted: [] }, [], COPY)).toBeNull();
    expect(errorScreenAfterExcuse({ text: `${text} Couldn't load your sales.`, quoted: [] }, [], COPY)?.name).toBe("section/data load failure");
  });

  it("stripe-payouts is still blocked (not on READ_ONLY_FUNCTIONS)", () => {
    expect(code("e2e/a11y-prod/abortProdWrites.ts")).toMatch(/READ_ONLY_FUNCTIONS: ReadonlySet<string> = new Set<string>\(\[\]\)/);
  });
});
