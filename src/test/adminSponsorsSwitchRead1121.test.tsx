/**
 * Holiday audit 1121 #82 (2026-11-21): /admin/sponsors told the admin "The 25 Days page is switched off" (turn it on) when
 * the switch read itself had failed, because a failed read and an off switch both gave on = false. A failed read now
 * says it could not check, with Try again; only a settled, answered "off" says switched off.
 *
 * @mutate src/pages/admin/sponsors/AdminSponsorsPage.tsx |         {!allowed && sw.settled && !sw.failed ? ( |         {!allowed && sw.settled ? (
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const sw = vi.hoisted(() => ({ value: { on: false, settled: true, lastAnswer: null as boolean | null, failed: true, retry: vi.fn() } }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false, useFeatureStatus: () => sw.value }));
vi.mock("@/pages/admin/sponsors/sponsorAdminApi", () => ({ sponsorAdminBackend: async () => ({ overview: async () => ({}) }) }));
vi.mock("@/pages/admin/sponsors/SbsReviewPanel", () => ({ SbsReviewPanel: () => null }));
import AdminSponsorsPage from "@/pages/admin/sponsors/AdminSponsorsPage";

afterEach(cleanup);
const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><AdminSponsorsPage /></MemoryRouter>
    </QueryClientProvider>,
  );

describe("admin sponsors: a failed switch read is not 'switched off' (holiday audit 1121 #82)", () => {
  it("a failed read says it couldn't check, with Try again, and never says switched off", () => {
    sw.value = { on: false, settled: true, lastAnswer: null, failed: true, retry: vi.fn() };
    draw();
    expect(screen.getByText("Couldn't check the switch")).toBeTruthy();
    expect(screen.queryByText("The 25 Days page is switched off")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(sw.value.retry).toHaveBeenCalledTimes(1);
  });
  it("an answered off still says switched off", () => {
    sw.value = { on: false, settled: true, lastAnswer: false, failed: false, retry: vi.fn() };
    draw();
    expect(screen.getByText("The 25 Days page is switched off")).toBeTruthy();
    expect(screen.queryByText("Couldn't check the switch")).toBeNull();
  });
});
