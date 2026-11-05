/**
 * Q2706 (lead decision 11-05, owner may override): You > Money's tile row never appears late or collapses. The
 * live lab (prod, helper, 375, Fast 4G + 4x) measured CLS 0.41-0.51 there, 0.385 of it the tiles landing at the
 * top after their reads (~2.2 s). On that page the row now holds one tile's shape while the reads are out, and a
 * member with nothing coming or held sees "Coming to you $0.00". A failed read still draws nothing (never $0 on a
 * guess). Home's strip is unchanged: hidden at $0 (its own hold, B98).
 *
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx |   if (placement === "money" && money.pending && !money.coming && !money.held) { |   if (false) {
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx |   if (placement === "money" && !money.failed && !money.coming && !money.held) { |   if (placement === "money" && !money.coming && !money.held) {
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx |   if (placement === "money" && !money.failed && !money.coming && !money.held) { |   if (false) {
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HomeMoneyTiles } from "./HomeMoneyTiles";
import type { HomeMoney } from "./homeMoney";

vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false }));

const draw = (money: HomeMoney, placement: "main" | "money") =>
  render(<MemoryRouter><HomeMoneyTiles money={money} placement={placement} /></MemoryRouter>).container;

const COMING: HomeMoney["coming"] = { cents: 12_500, at: null, overdue: false, severalDates: false, hasPayoutAccount: true };

describe("You > Money's tile row holds its place", () => {
  it("holds a tile's shape while the reads are out", () => {
    const c = draw({ coming: null, held: null, pending: true }, "money");
    const row = c.querySelector('[data-home-money="money"][data-money-loading]');
    expect(row).not.toBeNull();
    expect(row!.getAttribute("aria-hidden")).toBe("true");
    expect(row!.querySelectorAll("span")).toHaveLength(3);
  });

  it("shows Coming to you $0.00 when the reads answered with nothing", () => {
    const c = draw({ coming: null, held: null, pending: false }, "money");
    const tile = c.querySelector('[data-money-tile="coming"]');
    expect(tile?.textContent).toContain("Coming to you");
    expect(tile?.textContent).toContain("$0.00");
    expect(tile?.textContent).toContain("Nothing on its way yet");
  });

  it("draws nothing on a failed read, never $0.00", () => {
    expect(draw({ coming: null, held: null, pending: false, failed: true }, "money").textContent).toBe("");
  });

  it("the real tiles once they are known", () => {
    const c = draw({ coming: COMING, held: null, pending: false }, "money");
    expect(c.querySelector('[data-money-tile="coming"]')?.textContent).toContain("$125.00");
    expect(c.querySelector("[data-money-loading]")).toBeNull();
  });

  it("Home's strip is unchanged: hidden while loading and at $0", () => {
    expect(draw({ coming: null, held: null, pending: true }, "main").textContent).toBe("");
    expect(draw({ coming: null, held: null, pending: false }, "main").textContent).toBe("");
  });

  it("useHomeMoney reports a failed read", () => {
    const src = readFileSync("src/pages/home/homeDashboard/homeMoney.ts", "utf8");
    expect(src).toContain("return { coming, held, pending, failed };");
  });
});
