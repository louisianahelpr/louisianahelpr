/**
 * press-every-control has been red since before 11-10. Runs 43007456468 (11-11) and 43584967592 (11-14) failed on
 * the same classes (the "vite preview did not answer" and "no SUPABASE_ACCESS_TOKEN" lines in those logs are the
 * workflow's own script text echoed into the log, not errors):
 *
 *  1. GATE MISS, /profile's Shops "Orders" / "My shop" tiles: they open /shops, whose custom-order list calls
 *     shops_my_custom_requests, a VOLATILE read that first expires the caller's own lapsed quotes. Read-only SQL on
 *     prod 2026-11-14: shop_custom_requests holds 0 rows. It passes like rpc_ensure_my_handle (PRESS_PASS_THROUGH_RPCS).
 *  2. GATE MISS, the "Español" language button (Log in, Forgot password, Settings, Instant book): a signed-in pick is
 *     saved to profiles.language, an account setting on a shared account. It now carries data-account-setting.
 *  3. "On its way $X / Approved, not sent yet" on You > Money, "no observable change": the tile opens the Earned half,
 *     which is the half already on screen. The tile for the open half is no longer a control there (disabled).
 *  4. Work record "Print", "no observable change": window.print() does nothing in a headless browser. The sweep
 *     counts each call as the outcome "opened the print dialog", as it does the OS file chooser.
 *  5. "Continue with Apple" on / (anon), "control not found" on the reload: the landing fetches it only once the page
 *     has settled (whenPageSettled, at most 10 s after load). The sweep waits that long before calling it gone.
 *
 * Not fixed here (reported): "Download my data" 500 for the customer account (export-my-data: export_my_data hit
 * the 8 s statement timeout; the account holds 9.4 MB of test history), and shard 12's 312 rows not reached.
 *
 * @mutate scripts/audit/pressProdSafety.mjs |   "/rest/v1/rpc/shops_my_custom_requests": | "/rest/v1/rpc/shops_my_custom_requestz":
 * @mutate src/components/LanguageToggle.tsx |             data-account-setting\n |
 * @mutate src/components/profile/EarningsTab.tsx |         openKind={view === "spent" ? "held" : money.coming && !money.coming.hasPayoutAccount ? undefined : "coming"} |
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx |       disabled={disabled}\n |
 * @mutate scripts/audit/press-every-control.mjs |             (after.prints ?? 0) > (before.prints ?? 0) ? "opened the print dialog" :\n |
 * @mutate scripts/audit/press-every-control.mjs |     prints: window.__lhPrints \|\| 0, |     prints: 0,
 * @mutate scripts/audit/press-every-control.mjs |             await target.first().waitFor({ state: "attached", timeout: SETTLED_MOUNT_MS }).catch(() => {}); |             void SETTLED_MOUNT_MS;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "@/test/helpers/blankNonCode";
import { pressWriteKind, PRESS_PASS_THROUGH_RPCS } from "../../scripts/audit/pressProdSafety.mjs";
import { SETTLED_MOUNT_MS } from "../../scripts/audit/press-every-control.mjs";
import { HomeMoneyTiles } from "@/pages/home/homeDashboard/HomeMoneyTiles";
import type { HomeMoney } from "@/pages/home/homeDashboard/homeMoney";

vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false }));

const S = "https://fncmgoasalhdgfwzhsqa.supabase.co";
const press = blankComments(readFileSync("scripts/audit/press-every-control.mjs", "utf8"));

const MONEY: HomeMoney = {
  coming: { cents: 317_400, at: null, overdue: true, severalDates: false, hasPayoutAccount: true },
  held: { cents: 2_606, jobs: 1, only: { title: "Yard", helper: "Sam" } },
  pending: false,
};
const tiles = (openKind?: "coming" | "held", money = true) =>
  render(<MemoryRouter><HomeMoneyTiles money={MONEY} placement="money" onOpen={money ? () => {} : undefined} openKind={openKind} /></MemoryRouter>).container;

describe("press-every-control run 43584967592's reds (each class)", () => {
  it("1. shops_my_custom_requests passes like a read, with its measured reason", () => {
    expect(pressWriteKind({ method: "POST", url: `${S}/rest/v1/rpc/shops_my_custom_requests`, body: "{}" })).toBe("read");
    expect(PRESS_PASS_THROUGH_RPCS["/rest/v1/rpc/shops_my_custom_requests"]).toMatch(/0 rows in shop_custom_requests on prod/);
    // Its neighbours still write.
    expect(pressWriteKind({ method: "POST", url: `${S}/rest/v1/rpc/shops_decline_custom_request`, body: "{}" })).toBe("write");
  });

  it("2. the language buttons say they write an account setting", () => {
    const src = blankComments(readFileSync("src/components/LanguageToggle.tsx", "utf8"));
    const button = src.slice(src.indexOf("<Button"), src.indexOf("</Button>"));
    expect(button).toContain("data-account-setting");
    expect(button).toContain("aria-pressed={lang === l}");
  });

  it("3. on You > Money the tile for the half already open is not a control; the other one is", () => {
    const earned = tiles("coming");
    expect((earned.querySelector('[data-money-tile="coming"]') as HTMLButtonElement).disabled).toBe(true);
    expect((earned.querySelector('[data-money-tile="held"]') as HTMLButtonElement).disabled).toBe(false);
    const spent = tiles("held");
    expect((spent.querySelector('[data-money-tile="coming"]') as HTMLButtonElement).disabled).toBe(false);
    expect((spent.querySelector('[data-money-tile="held"]') as HTMLButtonElement).disabled).toBe(true);
    // Home (no onOpen: each tile navigates away) never disables one.
    const home = tiles("coming", false);
    expect([...home.querySelectorAll("[data-money-tile]")].every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    const tab = blankComments(readFileSync("src/components/profile/EarningsTab.tsx", "utf8"));
    expect(tab).toContain('openKind={view === "spent" ? "held" : money.coming && !money.coming.hasPayoutAccount ? undefined : "coming"}');
  });

  it("4. a window.print() call is an outcome the sweep sees", () => {
    expect(press).toContain("await ctx.addInitScript(() => { window.print = () => { window.__lhPrints = (window.__lhPrints || 0) + 1; }; });");
    expect(press).toContain("prints: window.__lhPrints || 0,");
    expect(press).toContain('(after.prints ?? 0) > (before.prints ?? 0) ? "opened the print dialog" :');
  });

  it("5. a missing control gets whenPageSettled's whole cap to mount before it fails", () => {
    const cap = Number(/maxWaitMs = ([\d_]+)\)/.exec(readFileSync("src/lib/routePrefetch.ts", "utf8"))?.[1]?.replace(/_/g, "") ?? NaN);
    expect(cap).toBeGreaterThan(0);
    expect(SETTLED_MOUNT_MS).toBeGreaterThan(cap);
    const wait = press.indexOf('await target.first().waitFor({ state: "attached", timeout: SETTLED_MOUNT_MS })');
    const fail = press.indexOf('entry.why = "control not found on a freshly loaded page');
    expect(wait).toBeGreaterThan(-1);
    expect(fail).toBeGreaterThan(wait);
  });
});
