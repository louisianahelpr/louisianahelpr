/**
 * Audit 11-10 F347: after Post showed "Say what you want in 3 to 60 letters", "Pick a category." and "Set your highest
 * price", the lines stayed red under fields the member had since fixed, until the next Post. The sheet now re-checks
 * the form on every change and drops the line under a field that is right; the others stay, and no new line appears
 * for a field not yet touched.
 *
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | <WantedFormFields form={form} setForm={edit} problems={problems} | <WantedFormFields form={form} setForm={setForm} problems={problems}
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |       for (const k of keys) if (now[k]) kept[k] = now[k]; |       for (const k of keys) kept[k] = now[k] ?? shown[k];
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" } }) }));
vi.mock("@/components/declutter/useDeclutterOrigin", () => ({
  useDeclutterOrigin: () => ({ origin: { status: "ready", lat: 30, lng: -92, approximate: false }, askDevice: () => {}, asked: false, asking: false, deviceNote: null }),
}));
vi.mock("@/lib/declutter/wanted", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/wanted")>()),
  fetchMyWanted: async () => [],
  fetchWantedNear: async () => [],
  createWanted: async () => "w1",
}));

import { WantedView } from "@/components/declutter/DeclutterWantedViews";

const WHAT = /Say what you want in 3 to 60 letters/;
const CATEGORY = "Pick a category.";
const PRICE = /Set your highest price in whole dollars/;

afterEach(() => { cleanup(); localStorage.clear(); });

async function openForm() {
  localStorage.clear();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/declutter?tab=wanted&post=1"]}><WantedView /></MemoryRouter></QueryClientProvider>);
  await screen.findByRole("dialog");
}

async function postEmpty() {
  await openForm();
  fireEvent.click(screen.getByRole("button", { name: "Post wanted" }));
  await screen.findByText(WHAT);
  expect(screen.getByText(CATEGORY)).toBeInTheDocument();
  expect(screen.getByText(PRICE)).toBeInTheDocument();
}

describe("F347: a Wanted field's problem line goes as soon as the field is right", () => {
  it("typing a good 'what' drops its line; the category and price lines stay", async () => {
    await postEmpty();
    fireEvent.change(document.getElementById("wanted-what")!, { target: { value: "oak dresser" } });
    expect(screen.queryByText(WHAT)).toBeNull();
    expect(screen.getByText(CATEGORY)).toBeInTheDocument();
    expect(screen.getByText(PRICE)).toBeInTheDocument();
  });

  it("a price in whole dollars drops its line; too short a 'what' keeps its own", async () => {
    await postEmpty();
    fireEvent.change(document.getElementById("wanted-max")!, { target: { value: "30" } });
    expect(screen.queryByText(PRICE)).toBeNull();
    fireEvent.change(document.getElementById("wanted-what")!, { target: { value: "ab" } });
    expect(screen.getByText(WHAT)).toBeInTheDocument();
    expect(screen.getByText(CATEGORY)).toBeInTheDocument();
  });

  it("before Post is pressed, typing shows no problem lines at all", async () => {
    await openForm();
    fireEvent.change(document.getElementById("wanted-what")!, { target: { value: "ab" } });
    expect(screen.queryByText(WHAT)).toBeNull();
    expect(screen.queryByText(CATEGORY)).toBeNull();
  });
});
